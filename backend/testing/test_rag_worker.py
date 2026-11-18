import json
import subprocess
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

import generation
import rag_worker
from rag_worker import Pipeline, RequestError
from test_generation import FEEDING, FEEDING_OTHER, FakeClient, raw_reply, reply

BACKEND = Path(__file__).resolve().parent.parent
BOOKS = [{"book_id": "holt_1894", "title": "The Care and Feeding of Children", "author": "L. Emmett Holt", "year": 1894, "chunks": 2}]


def fake_retrieval(passages, calls=None):
    def retrieve_across_books(question, k, per_book, book_ids, owner_id=None, upload_ids=None):
        if calls is not None:
            calls.append({"question": question, "k": k, "per_book": per_book, "book_ids": book_ids,
                          "owner_id": owner_id, "upload_ids": upload_ids})
        if book_ids == ["missing"]:
            raise ValueError("Unknown book_ids ['missing']")
        return passages

    return SimpleNamespace(retrieve_across_books=retrieve_across_books, list_books=lambda: BOOKS,
                           uploads="uploads-store", model="embedding-model")


def capture_sent(monkeypatch):
    sent = []
    monkeypatch.setattr(rag_worker, "send", sent.append)
    return sent


# Test 1: ask runs retrieval then generation and returns the API response
def test_ask_returns_answer_with_citations():
    calls = []
    client = FakeClient(reply(
        statements=[("Feed every three hours.", ["S1"]), ("Feed every two hours.", ["S2"])],
        conflicts=[("The books give different intervals.", ["S1", "S2"])],
    ))
    pipeline = Pipeline(fake_retrieval([FEEDING, FEEDING_OTHER], calls), generation, client)

    result = pipeline.handle({"op": "ask", "params": {"question": "How often should a baby eat?", "per_book": 3}})

    assert calls == [{"question": "How often should a baby eat?", "k": 5, "per_book": 3, "book_ids": None,
                      "owner_id": None, "upload_ids": []}]
    assert result["status"] == "answered"
    assert "[Holt 1894, p. 40]" in result["answer"]
    assert [c["label"] for c in result["citations"]] == ["Holt 1894, p. 40", "Chavasse 1878, p. 12"]
    assert result["retrieval"] == {"passages": 2, "books": ["chavasse_1878", "holt_1894"]}
    assert set(result["timing_ms"]) == {"retrieval", "generation"}
    assert result["cached"] is False
    json.dumps(result)


def test_uploads_and_history_are_passed_through():
    calls = []
    client = FakeClient(reply(statements=[("Feed every three hours.", ["S1"])]))
    pipeline = Pipeline(fake_retrieval([FEEDING], calls), generation, client)

    pipeline.handle({"op": "ask", "params": {
        "question": "And at night?", "book_ids": ["holt_1894"], "owner_id": 12,
        "upload_ids": ["up_ab12"], "history": ["How often should a baby eat?"],
    }})

    assert calls[0]["owner_id"] == "12"
    assert calls[0]["upload_ids"] == ["up_ab12"]
    assert calls[0]["book_ids"] == ["holt_1894"]
    # The short follow-up is searched together with the question before it...
    assert calls[0]["question"] == "How often should a baby eat? And at night?"
    # ...but the model is asked the follow-up itself, with the history as context
    assert "<question>\nAnd at night?\n</question>" in client.calls[0]["messages"][0]["content"]
    assert "<earlier_questions>\n- How often should a baby eat?\n</earlier_questions>" in client.calls[0]["messages"][0]["content"]


# Test 1b: identical questions are answered from the cache, errors are not cached
def test_repeat_question_is_served_from_cache():
    calls = []
    answer = reply(statements=[("Feed every three hours.", ["S1"])])
    client = FakeClient(answer, answer)
    pipeline = Pipeline(fake_retrieval([FEEDING], calls), generation, client)

    first = pipeline.handle({"op": "ask", "params": {"question": "How often should a baby eat?"}})
    second = pipeline.handle({"op": "ask", "params": {"question": "  how often should a  BABY eat? "}})
    other_books = pipeline.handle({"op": "ask", "params": {"question": "How often should a baby eat?",
                                                           "book_ids": ["holt_1894"]}})

    assert first["cached"] is False and second["cached"] is True
    assert second["answer"] == first["answer"]
    # A different set of books is a different question
    assert other_books["cached"] is False
    assert len(client.calls) == 2 and len(calls) == 2


def test_errors_are_not_cached():
    client = FakeClient(raw_reply("", stop_reason="refusal"), reply(status="insufficient"))
    pipeline = Pipeline(fake_retrieval([FEEDING]), generation, client)

    first = pipeline.handle({"op": "ask", "params": {"question": "Q?"}})
    second = pipeline.handle({"op": "ask", "params": {"question": "Q?"}})

    assert first["status"] == "error"
    assert second["cached"] is False


def test_answer_cache_expires_and_evicts():
    now = [0.0]
    cache = rag_worker.AnswerCache(size=2, ttl_s=10, clock=lambda: now[0])
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")  # a is now most recently used
    cache.put("c", 3)  # evicts b

    assert cache.get("b") is None and cache.get("a") == 1 and cache.get("c") == 3
    now[0] = 11
    assert cache.get("a") is None


# Test 1c: ingest and delete go through the ingest module with the shared store and lock
class FakeIngest:
    class IngestError(Exception):
        def __init__(self, code, message):
            super().__init__(message)
            self.code, self.message = code, message

    def __init__(self):
        self.calls = []

    def ingest_pdf(self, path, **kwargs):
        self.calls.append(("ingest", path, kwargs))
        if kwargs["title"] == "Scanned":
            raise self.IngestError("no_text", "It looks like a scan.")
        return {"book_id": kwargs["book_id"], "pages": 3, "text_pages": 3, "chunks": 9}

    def delete_book(self, book_id, owner_id, store):
        self.calls.append(("delete", book_id, owner_id, store))
        return 9


def test_ingest_and_delete(tmp_path):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    fake = FakeIngest()
    pipeline = Pipeline(fake_retrieval([]), generation, FakeClient(), ingest=fake)
    pipeline.cache.put("stale", {"answer": "old"})

    result = pipeline.handle({"op": "ingest", "params": {
        "path": str(pdf), "book_id": "up_ab12", "title": "My Book", "author": "A. Writer", "year": 2004, "owner_id": 7,
    }})
    deleted = pipeline.handle({"op": "delete_book", "params": {"book_id": "up_ab12", "owner_id": 7}})

    assert result["chunks"] == 9 and "took_ms" in result
    _, path, kwargs = fake.calls[0]
    assert path == str(pdf)
    assert kwargs["owner_id"] == "7" and kwargs["store"] == "uploads-store" and kwargs["lock"] is pipeline.retrieval_lock
    assert deleted == {"book_id": "up_ab12", "deleted_passages": 9}
    assert fake.calls[1] == ("delete", "up_ab12", "7", "uploads-store")
    assert len(pipeline.cache) == 0  # the reader's library changed


def test_unprocessable_pdf_reports_the_reason(tmp_path, monkeypatch):
    pdf = tmp_path / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    sent = capture_sent(monkeypatch)
    pipeline = Pipeline(fake_retrieval([]), generation, FakeClient(), ingest=FakeIngest())

    pipeline.respond({"id": "9", "op": "ingest", "params": {
        "path": str(pdf), "book_id": "up_x", "title": "Scanned", "owner_id": "7"}})

    assert sent == [{"id": "9", "ok": False,
                     "error": {"code": "unprocessable", "message": "It looks like a scan.", "reason": "no_text"}}]


@pytest.mark.parametrize(
    "params",
    [
        {"book_id": "up_x", "title": "T", "owner_id": "7"},                          # no path
        {"path": "missing.pdf", "book_id": "up_x", "title": "T", "owner_id": "7"},   # file doesn't exist
        {"path": "PDF", "book_id": "../etc", "title": "T", "owner_id": "7"},         # bad book ID
        {"path": "PDF", "book_id": "up_x", "title": "", "owner_id": "7"},            # empty title
        {"path": "PDF", "book_id": "up_x", "title": "T"},                            # no owner
        {"path": "PDF", "book_id": "up_x", "title": "T", "owner_id": "7", "year": "1990"},
    ],
)
def test_bad_ingest_params(tmp_path, params):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    params = {**params, "path": str(pdf)} if params.get("path") == "PDF" else params
    pipeline = Pipeline(fake_retrieval([]), generation, FakeClient(), ingest=FakeIngest())

    with pytest.raises(RequestError) as error:
        pipeline.handle({"op": "ingest", "params": params})

    assert error.value.code == "bad_request"


# Test 2: bad parameters are rejected before any work is done
@pytest.mark.parametrize(
    "params",
    [
        {},
        {"question": "   "},
        {"question": 42},
        {"question": "x" * (rag_worker.MAX_QUESTION_CHARS + 1)},
        {"question": "ok", "k": 0},
        {"question": "ok", "k": True},
        {"question": "ok", "per_book": 99},
        {"question": "ok", "book_ids": ["missing"]},
    ],
)
def test_bad_ask_params(params):
    pipeline = Pipeline(fake_retrieval([]), generation, FakeClient())

    with pytest.raises(RequestError) as error:
        pipeline.handle({"op": "ask", "params": params})

    assert error.value.code == "bad_request"


def test_books_and_ping_and_unknown_op():
    pipeline = Pipeline(fake_retrieval([]), generation, FakeClient())

    assert pipeline.handle({"op": "books"}) == BOOKS
    assert pipeline.handle({"op": "ping"})["pong"] is True
    with pytest.raises(RequestError):
        pipeline.handle({"op": "bogus"})


# Test 3: respond() always answers with the request ID, even on unexpected errors
def test_respond_wraps_results_and_errors(monkeypatch):
    sent = capture_sent(monkeypatch)
    broken = SimpleNamespace(list_books=lambda: 1 / 0)
    pipeline = Pipeline(broken, generation, FakeClient())

    pipeline.respond({"id": "1", "op": "ping"})
    pipeline.respond({"id": "2", "op": "bogus"})
    pipeline.respond({"id": "3", "op": "books"})
    pipeline.respond(["not", "an", "object"])

    assert sent[0]["id"] == "1" and sent[0]["ok"] is True
    assert sent[1] == {"id": "2", "ok": False, "error": {"code": "bad_request", "message": "Unknown op 'bogus'"}}
    assert sent[2]["id"] == "3" and sent[2]["error"]["code"] == "internal_error"
    assert sent[3]["id"] is None and sent[3]["error"]["code"] == "bad_request"
    assert pipeline.in_flight == 0


# Test 4: the real worker process speaks the protocol (loads the embedding model)
def test_worker_process_protocol():
    requests = [
        {"id": "1", "op": "ping"},
        {"id": "2", "op": "books"},
        # Off-topic: retrieval returns nothing, so no model call is made
        {"id": "3", "op": "ask", "params": {"question": "What is the best car seat?"}},
        {"id": "4", "op": "ask", "params": {"question": "feeding", "book_ids": ["nope"]}},
    ]
    process = subprocess.Popen(
        [sys.executable, str(BACKEND / "rag_worker.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
        cwd=BACKEND.parent,  # not backend/, to check paths don't depend on the working directory
    )
    watchdog = threading.Timer(300, process.kill)
    watchdog.start()
    try:
        # Like the API: keep stdin open and read every response before closing it
        for request in requests:
            process.stdin.write(json.dumps(request) + "\n")
        process.stdin.write("this is not json\n")
        process.stdin.flush()
        messages = [json.loads(process.stdout.readline()) for _ in range(len(requests) + 2)]
        process.stdin.close()
        assert process.wait(timeout=60) == 0
    finally:
        watchdog.cancel()
        process.kill()

    assert messages[0]["event"] == "ready"
    assert messages[0]["chunks"] > 0
    by_id = {m["id"]: m for m in messages[1:]}
    assert set(by_id) == {"1", "2", "3", "4", None}
    assert by_id["1"]["result"]["pong"] is True
    assert {b["book_id"] for b in by_id["2"]["result"]} >= {"holt_1894"}
    assert by_id["3"]["result"]["status"] == "insufficient"
    assert by_id["3"]["result"]["citations"] == []
    assert by_id["4"]["error"]["code"] == "bad_request"
    assert by_id[None]["error"]["message"] == "Invalid JSON"


@pytest.mark.parametrize(
    "question, history, expected",
    [
        ("And at night?", ["How often should a baby eat?"], "How often should a baby eat? And at night?"),
        ("And at night?", [], "And at night?"),
        ("What do the books say about weaning a baby who is teething in summer?", ["Earlier?"],
         "What do the books say about weaning a baby who is teething in summer?"),
        ("What about twins?", ["First?", "When should a baby be weaned?"], "When should a baby be weaned? What about twins?"),
    ],
)
def test_retrieval_query_for_follow_ups(question, history, expected):
    assert rag_worker.retrieval_query(question, history) == expected
