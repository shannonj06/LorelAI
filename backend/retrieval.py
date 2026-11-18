"""Retrieval stage of the RAG pipeline.

retrieve() returns the top-k passages for a question across the whole library.

retrieve_across_books() is what the answer pipeline uses. Global top-k often comes
from just one or two books, which hides how the other books answer the same
question. It adds each book's best passages to the global top-k, so when several
books cover a topic the model sees all of them and can compare where they agree
and where they differ.

Readers' own uploaded books (see ingest.py) live in a second vector store,
outside git, with every passage tagged by its owner. They are only searched when
the caller passes owner_id and upload_ids, and only that owner's passages match.

Works from any working directory; the vector store path is resolved from this file.
"""

import os
from functools import lru_cache
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

BACKEND = Path(__file__).resolve().parent
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
COLLECTION_NAME = "book_chunks"
# bge models expect this instruction in front of search queries (not in front of passages)
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

# Cosine distance, 0 = identical. On this library, passages that answer a question
# score about 0.17-0.30 and off-topic questions ("best car seat") score 0.44+.
# Nothing beyond MAX_DISTANCE is returned, so off-topic questions skip the model call.
MAX_DISTANCE = 0.40
# A passage must also be within this distance of the best passage found, so a book
# that barely touches the topic doesn't crowd the context.
RELATIVE_MARGIN = 0.10
MAX_PASSAGES = 10

model = SentenceTransformer(EMBEDDING_MODEL)

client = chromadb.PersistentClient(path=str(BACKEND / "chroma_db"))
# access the stored books and embeddings
collection = client.get_collection(name=COLLECTION_NAME)

# Readers' uploads: a separate store so private books never land in the git-tracked library
UPLOADS_DB = Path(os.environ.get("RAG_UPLOADS_DB") or BACKEND / "uploads_db")
UPLOADS_COLLECTION = "user_uploads"
uploads_client = chromadb.PersistentClient(path=str(UPLOADS_DB))
uploads = uploads_client.get_or_create_collection(
    name=UPLOADS_COLLECTION,
    embedding_function=None,
    configuration={"hnsw": {"space": "cosine"}},
)


def _check_positive_int(value, name):
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{name} must be a positive integer, got {value!r}")


def _book_filter(book_ids):
    if not book_ids:
        return None
    if len(book_ids) == 1:
        return {"book_id": book_ids[0]}
    return {"book_id": {"$in": list(book_ids)}}


def embed_question(question):
    return model.encode(QUERY_PREFIX + question, normalize_embeddings=True).tolist()


def upload_filter(owner_id, book_ids=None):
    """Chroma filter matching only this owner's uploads (optionally only some of them)."""
    conditions = [{"owner_id": str(owner_id)}]
    if book_ids:
        conditions.append({"book_id": book_ids[0]} if len(book_ids) == 1 else {"book_id": {"$in": list(book_ids)}})
    return conditions[0] if len(conditions) == 1 else {"$and": conditions}


def _query(embedding, n, where=None, store=None):
    store = collection if store is None else store
    n = min(n, store.count())
    if n < 1:
        return []
    kwargs = {"query_embeddings": [embedding], "n_results": n, "include": ["documents", "metadatas", "distances"]}
    if where:
        kwargs["where"] = where
    results = store.query(**kwargs)

    # organize the results
    return [
        {
            "chunk_id": results["ids"][0][i],
            "text": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
            "distance": results["distances"][0][i],
        }
        for i in range(len(results["ids"][0]))
    ]


@lru_cache(maxsize=1)
def _load_books():
    books = {}
    for metadata in collection.get(include=["metadatas"])["metadatas"]:
        book = books.setdefault(
            metadata["book_id"],
            {
                "book_id": metadata["book_id"],
                "title": metadata.get("title"),
                "author": metadata.get("author"),
                "year": metadata.get("year"),
                "chunks": 0,
            },
        )
        book["chunks"] += 1
    return tuple(sorted(books.values(), key=lambda book: book["book_id"]))


def list_books():
    """The books in the vector store with their chunk counts, sorted by book_id.

    Read once and cached; restart the process after re-indexing.
    """
    return [dict(book) for book in _load_books()]


def _resolve_book_ids(book_ids):
    """Validate a book filter. Returns the list of book IDs to search."""
    known = [book["book_id"] for book in _load_books()]
    if book_ids is None:
        return known
    if not isinstance(book_ids, (list, tuple)) or not all(isinstance(b, str) for b in book_ids):
        raise ValueError("book_ids must be a list of book ID strings")
    unknown = sorted(set(book_ids) - set(known))
    if unknown:
        raise ValueError(f"Unknown book_ids {unknown}; known books are {known}")
    return [book_id for book_id in known if book_id in set(book_ids)]


# this function embeds the question and responds with K matching passages
def retrieve(question, k=3, book_ids=None):
    """Top-k passages for a question, most similar first. Empty question -> []."""
    _check_positive_int(k, "k")
    if not isinstance(question, str) or not question.strip():
        return []
    books = _resolve_book_ids(book_ids) if book_ids is not None else None
    return _query(embed_question(question.strip()), k, _book_filter(books))


def retrieve_across_books(
    question,
    k=5,
    per_book=2,
    book_ids=None,
    max_distance=MAX_DISTANCE,
    margin=RELATIVE_MARGIN,
    max_passages=MAX_PASSAGES,
    owner_id=None,
    upload_ids=None,
):
    """Global top-k passages plus each book's best per_book passages.

    book_ids limits the shared library (None = every library book, [] = none).
    upload_ids adds that owner's uploaded books (requires owner_id); passages from
    anyone else's uploads can never match.

    A passage is kept only if its distance is at most max_distance and within
    margin of the best passage found (pass None to disable either check). Each
    book's best surviving passage is always kept, so trimming to max_passages
    never removes a book's view entirely. Results are deduplicated and sorted
    most similar first, so source IDs S1, S2, ... follow relevance.
    """
    _check_positive_int(k, "k")
    _check_positive_int(per_book, "per_book")
    _check_positive_int(max_passages, "max_passages")
    if not isinstance(question, str) or not question.strip():
        return []
    books = _resolve_book_ids(book_ids)
    upload_ids = list(upload_ids or [])
    if upload_ids and owner_id is None:
        raise ValueError("upload_ids requires owner_id")
    if not all(isinstance(b, str) for b in upload_ids):
        raise ValueError("upload_ids must be a list of book ID strings")
    embedding = embed_question(question.strip())

    candidates = {}
    if books:
        for passage in _query(embedding, k, _book_filter(books if book_ids is not None else None)):
            candidates[passage["chunk_id"]] = passage
        for book_id in books:
            for passage in _query(embedding, per_book, {"book_id": book_id}):
                candidates.setdefault(passage["chunk_id"], passage)
    if upload_ids:
        for passage in _query(embedding, k, upload_filter(owner_id, upload_ids), uploads):
            candidates.setdefault(passage["chunk_id"], passage)
        for book_id in upload_ids:
            for passage in _query(embedding, per_book, upload_filter(owner_id, [book_id]), uploads):
                candidates.setdefault(passage["chunk_id"], passage)

    ranked = sorted(candidates.values(), key=lambda p: p["distance"])
    if not ranked:
        return []
    cutoff = float("inf")
    if margin is not None:
        cutoff = ranked[0]["distance"] + margin
    if max_distance is not None:
        cutoff = min(cutoff, max_distance)
    kept = [p for p in ranked if p["distance"] <= cutoff]

    # Each book's best passage first, then fill the remaining slots by similarity
    chosen, chosen_ids, seen_books = [], set(), set()
    for passage in kept:
        book_id = passage["metadata"].get("book_id")
        if book_id not in seen_books:
            seen_books.add(book_id)
            chosen.append(passage)
            chosen_ids.add(passage["chunk_id"])
    for passage in kept:
        if len(chosen) >= max_passages:
            break
        if passage["chunk_id"] not in chosen_ids:
            chosen.append(passage)
            chosen_ids.add(passage["chunk_id"])

    return sorted(chosen, key=lambda p: p["distance"])[:max_passages]


if __name__ == "__main__":
    question = "How should infants be fed?"

    results = retrieve_across_books(question)

    for i, result in enumerate(results):
        print(f"\nResult {i + 1}")
        print("Text:", result["text"])
        print("Metadata:", result["metadata"])
        print("Distance:", result["distance"])
        print("-" * 50)
