"""Long-running worker that serves the RAG pipeline to the Express API over stdio.

The API (api/src/services/rag/worker.js) starts this process once and keeps it
running, so the embedding model and vector stores load once instead of per question.

Protocol: one JSON object per line, UTF-8.
  requests   {"id": "7", "op": "ask", "params": {"question": "...", "k": 5, "per_book": 2,
                "book_ids": null, "owner_id": "12", "upload_ids": ["up_ab12"], "history": ["..."]}}
             {"id": "8", "op": "ingest", "params": {"path": ".../up_ab12.pdf", "book_id": "up_ab12",
                "title": "...", "author": "...", "year": 2004, "owner_id": "12"}}
             {"id": "9", "op": "delete_book", "params": {"book_id": "up_ab12", "owner_id": "12"}}
             {"id": "10", "op": "books"}      the shared library
             {"id": "11", "op": "ping"}
  responses  {"id": "7", "ok": true, "result": {...}}
             {"id": "7", "ok": false, "error": {"code": "...", "message": "...", "reason"?: "..."}}
               codes: bad_request | unprocessable (a PDF that can't be ingested; reason says why)
                      | internal_error | shutting_down
  events     {"event": "ready", "books": [...], "chunks": 2832, "pid": 123, "llm": {...}}  once, after loading
             {"event": "fatal", "message": "..."}  if loading fails, just before exiting with status 1

stdout carries protocol messages only; logs and library output go to stderr.
Requests run concurrently on a thread pool. Embedding (fast, CPU-bound) is
serialized with a lock; generation (slow, waiting on the model API) runs in parallel.
The process exits when stdin closes.

Manual check, from backend/:
  echo {"id":"1","op":"ping"} | py rag_worker.py
"""

import functools
import json
import logging
import os
import re
import sys
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

# Keep the real stdout for protocol messages; anything a library prints goes to stderr
PROTOCOL_OUT = sys.stdout
sys.stdout = sys.stderr

logger = logging.getLogger("rag_worker")

MAX_QUESTION_CHARS = 2000
MAX_K = 20
MAX_PER_BOOK = 5
DEFAULT_K = 5
DEFAULT_PER_BOOK = 2
MAX_HISTORY = 4
MAX_BOOK_IDS = 50
BOOK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Identical questions (same books, same conversation) are answered from memory for a while:
# the demo's suggested questions come back instantly and don't spend free-tier model quota.
CACHE_SIZE = int(os.environ.get("RAG_CACHE_SIZE", "256"))
CACHE_TTL_S = int(os.environ.get("RAG_CACHE_TTL_S", str(6 * 60 * 60)))
CACHEABLE = {"answered", "partial", "insufficient"}

_send_lock = threading.Lock()


def send(message):
    # ASCII-only JSON, so the pipe's encoding never matters
    line = json.dumps(message, ensure_ascii=True)
    with _send_lock:
        try:
            PROTOCOL_OUT.write(line + "\n")
            PROTOCOL_OUT.flush()
        except (BrokenPipeError, OSError, ValueError):
            # The API went away; nothing to report to
            pass


class RequestError(Exception):
    def __init__(self, code, message, reason=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.reason = reason


def _int_param(params, name, default, maximum, minimum=1):
    value = params.get(name, default)
    if value is None:
        return default
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise RequestError("bad_request", f"{name} must be an integer from {minimum} to {maximum}")
    return value


def _book_ids(params, name):
    value = params.get(name)
    if value is None:
        return None
    if (
        not isinstance(value, list)
        or len(value) > MAX_BOOK_IDS
        or not all(isinstance(b, str) and BOOK_ID.match(b) for b in value)
    ):
        raise RequestError("bad_request", f"{name} must be a list of book IDs")
    return value


def _owner(params, required):
    owner = params.get("owner_id")
    if owner is None:
        if required:
            raise RequestError("bad_request", "owner_id is required")
        return None
    if isinstance(owner, bool) or not isinstance(owner, (str, int)) or not str(owner).strip():
        raise RequestError("bad_request", "owner_id must be a string or integer")
    return str(owner)


def _text(params, name, maximum, required=True):
    value = params.get(name)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise RequestError("bad_request", f"{name} must be a non-empty string of at most {maximum} characters")
    return value.strip()


# A question this short with earlier questions before it is usually a follow-up
# ("and at night?") that means nothing to retrieval on its own.
FOLLOW_UP_MAX_WORDS = 8


def retrieval_query(question, history):
    """What to search for: short follow-ups are searched together with the previous question."""
    if history and len(question.split()) <= FOLLOW_UP_MAX_WORDS:
        return f"{history[-1]} {question}"
    return question


class AnswerCache:
    """A small thread-safe LRU of finished answers with an expiry."""

    def __init__(self, size=CACHE_SIZE, ttl_s=CACHE_TTL_S, clock=time.monotonic):
        self.size, self.ttl_s, self.clock = size, ttl_s, clock
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            stored_at, value = item
            if self.clock() - stored_at > self.ttl_s:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return value

    def put(self, key, value):
        if self.size <= 0:
            return
        with self._lock:
            self._items[key] = (self.clock(), value)
            self._items.move_to_end(key)
            while len(self._items) > self.size:
                self._items.popitem(last=False)

    def clear(self):
        with self._lock:
            self._items.clear()

    def __len__(self):
        return len(self._items)


class Pipeline:
    """Handles protocol requests using the retrieval, generation and ingest modules."""

    def __init__(self, retrieval, generation, client, ingest=None, cache=None):
        self.retrieval = retrieval
        self.generation = generation
        self.client = client
        self.ingest = ingest
        self.cache = cache if cache is not None else AnswerCache()
        # The embedding model is shared by retrieval and ingest; one encode at a time
        self.retrieval_lock = threading.Lock()
        self.started = time.monotonic()
        self.in_flight = 0
        self._count_lock = threading.Lock()

    def handle(self, message):
        op = message.get("op")
        params = message.get("params") or {}
        if not isinstance(params, dict):
            raise RequestError("bad_request", "params must be an object")
        if op == "ping":
            return {"pong": True, "uptime_s": round(time.monotonic() - self.started, 1),
                    "in_flight": self.in_flight, "cached_answers": len(self.cache)}
        if op == "books":
            return self.retrieval.list_books()
        if op == "ask":
            return self.ask(params)
        if op == "ingest":
            return self.ingest_book(params)
        if op == "delete_book":
            return self.delete_book(params)
        raise RequestError("bad_request", f"Unknown op {op!r}")

    def ask(self, params):
        question = params.get("question")
        if not isinstance(question, str) or not question.strip():
            raise RequestError("bad_request", "question must be a non-empty string")
        if len(question) > MAX_QUESTION_CHARS:
            raise RequestError("bad_request", f"question must be at most {MAX_QUESTION_CHARS} characters")
        question = question.strip()
        k = _int_param(params, "k", DEFAULT_K, MAX_K)
        per_book = _int_param(params, "per_book", DEFAULT_PER_BOOK, MAX_PER_BOOK)
        book_ids = _book_ids(params, "book_ids")
        upload_ids = _book_ids(params, "upload_ids") or []
        owner_id = _owner(params, required=bool(upload_ids))
        history = params.get("history") or []
        if (
            not isinstance(history, list)
            or len(history) > MAX_HISTORY
            or not all(isinstance(q, str) and len(q) <= MAX_QUESTION_CHARS for q in history)
        ):
            raise RequestError("bad_request", f"history must be a list of at most {MAX_HISTORY} earlier questions")

        cache_key = json.dumps([
            " ".join(question.lower().split()), k, per_book,
            sorted(book_ids) if book_ids is not None else None,
            owner_id if upload_ids else None, sorted(upload_ids), history,
        ])
        cached = self.cache.get(cache_key)
        if cached is not None:
            return {**cached, "cached": True, "timing_ms": {"retrieval": 0, "generation": 0}}

        started = time.perf_counter()
        try:
            with self.retrieval_lock:
                passages = self.retrieval.retrieve_across_books(
                    retrieval_query(question, history), k=k, per_book=per_book,
                    book_ids=book_ids, owner_id=owner_id, upload_ids=upload_ids,
                )
        except ValueError as e:
            raise RequestError("bad_request", str(e)) from e
        retrieved = time.perf_counter()

        result = self.generation.generate_answer(question, passages, client=self.client, earlier_questions=history)
        finished = time.perf_counter()

        response = self.generation.to_api_response(result)
        response["retrieval"] = {
            "passages": len(passages),
            "books": sorted({p["metadata"].get("book_id") for p in passages if p.get("metadata")}),
        }
        if response["status"] in CACHEABLE:
            self.cache.put(cache_key, response)
        return {
            **response,
            "cached": False,
            "timing_ms": {
                "retrieval": round((retrieved - started) * 1000),
                "generation": round((finished - retrieved) * 1000),
            },
        }

    def ingest_book(self, params):
        if self.ingest is None:
            raise RequestError("bad_request", "Uploads are not available in this worker")
        path = _text(params, "path", 1024)
        if not path.lower().endswith(".pdf") or not os.path.isfile(path):
            raise RequestError("bad_request", "path must point to an existing .pdf file")
        book_id = _text(params, "book_id", 64)
        if not BOOK_ID.match(book_id):
            raise RequestError("bad_request", "book_id may only contain letters, digits, _ and -")
        title = _text(params, "title", 300)
        author = _text(params, "author", 200, required=False)
        year = params.get("year")
        if year is not None and (not isinstance(year, int) or isinstance(year, bool) or not 0 < year < 3000):
            raise RequestError("bad_request", "year must be a positive integer")
        owner_id = _owner(params, required=True)

        started = time.perf_counter()
        try:
            result = self.ingest.ingest_pdf(
                path, book_id=book_id, title=title, author=author, year=year, owner_id=owner_id,
                store=self.retrieval.uploads, model=self.retrieval.model, lock=self.retrieval_lock,
            )
        except self.ingest.IngestError as e:
            raise RequestError("unprocessable", e.message, reason=e.code) from e
        self.cache.clear()  # a reader's library changed
        return {**result, "took_ms": round((time.perf_counter() - started) * 1000)}

    def delete_book(self, params):
        if self.ingest is None:
            raise RequestError("bad_request", "Uploads are not available in this worker")
        book_id = _text(params, "book_id", 64)
        owner_id = _owner(params, required=True)
        deleted = self.ingest.delete_book(book_id, owner_id, self.retrieval.uploads)
        self.cache.clear()
        return {"book_id": book_id, "deleted_passages": deleted}

    def respond(self, message):
        request_id = message.get("id") if isinstance(message, dict) else None
        with self._count_lock:
            self.in_flight += 1
        try:
            if not isinstance(message, dict):
                raise RequestError("bad_request", "Each request must be a JSON object")
            send({"id": request_id, "ok": True, "result": self.handle(message)})
        except RequestError as e:
            error = {"code": e.code, "message": e.message}
            if e.reason:
                error["reason"] = e.reason
            send({"id": request_id, "ok": False, "error": error})
        except Exception as e:  # never let one request take the worker down
            logger.exception("Request %s failed", request_id)
            send({"id": request_id, "ok": False, "error": {"code": "internal_error", "message": f"{type(e).__name__}: {e}"}})
        finally:
            with self._count_lock:
                self.in_flight -= 1


def report_if_cancelled(future, request_id):
    # Queued requests are cancelled when stdin closes; answer them so no caller waits forever
    if future.cancelled():
        send({
            "id": request_id,
            "ok": False,
            "error": {"code": "shutting_down", "message": "The worker stopped before this request ran"},
        })


def load_pipeline():
    # Imported here so load errors are reported as a "fatal" event
    import generation
    import ingest
    import llm
    import retrieval

    books = retrieval.list_books()
    try:
        # Building a provider makes no network call; a missing key surfaces per request as service_error
        client = llm.default_provider()
    except ValueError as e:
        logger.warning("Model provider misconfigured (%s); answers will fail until it is fixed", e)
        client = None
    return Pipeline(retrieval, generation, client, ingest=ingest), books, llm.describe()


def main():
    logging.basicConfig(
        level=os.environ.get("RAG_LOG_LEVEL", "INFO").upper(),
        stream=sys.stderr,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # These log every HTTP request at INFO, and sentence-transformers shows a progress bar per query at INFO
    for name in ("httpx", "httpx2", "sentence_transformers", "chromadb", "urllib3", "pypdf"):
        logging.getLogger(name).setLevel(logging.WARNING)
    # Warns about anonymous Hub access on every start; set HF_TOKEN or RAG_HF_OFFLINE instead
    logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
    sys.stdin.reconfigure(encoding="utf-8")
    # Make sibling modules importable when started from another directory
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    try:
        pipeline, books, model_info = load_pipeline()
    except Exception as e:
        logger.exception("Failed to load the RAG pipeline")
        send({"event": "fatal", "message": f"{type(e).__name__}: {e}"})
        return 1

    if not model_info.get("key_set"):
        logger.warning("No API key for the %s model provider; answers will fail until one is set",
                       model_info.get("provider"))
    send({
        "event": "ready",
        "pid": os.getpid(),
        "books": books,
        "chunks": sum(b["chunks"] for b in books),
        "llm": model_info,
    })
    logger.info("Ready: %d books, %d chunks, model %s via %s", len(books), sum(b["chunks"] for b in books),
                model_info.get("model"), model_info.get("provider"))

    workers = int(os.environ.get("RAG_CONCURRENCY", "4"))
    pool = ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="ask")
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                send({"id": None, "ok": False, "error": {"code": "bad_request", "message": "Invalid JSON"}})
                continue
            future = pool.submit(pipeline.respond, message)
            request_id = message.get("id") if isinstance(message, dict) else None
            future.add_done_callback(functools.partial(report_if_cancelled, request_id=request_id))
    finally:
        # stdin closed: the API is shutting down or restarting us. Drop queued work,
        # let in-flight requests finish, then exit.
        pool.shutdown(wait=True, cancel_futures=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
