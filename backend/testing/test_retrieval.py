
import math
import pytest
from retrieval import retrieve, collection


# Test 1: Check that our books are indexed
def test_database_not_empty():
    assert collection.count() > 0


# Test 2: Check that k controls the number of results
@pytest.mark.parametrize("k", [1, 3, 5])
def test_top_k(k):
    question = "How should infants be fed?"

    results = retrieve(question, k=k)

    assert len(results) == min(k, collection.count())


# Test 3: Check that every result has the correct structure
def test_result_structure():
    results = retrieve("How should newborns be cared for?", k=3)

    assert len(results) > 0

    for result in results:
        assert "chunk_id" in result
        assert "text" in result
        assert "metadata" in result
        assert "distance" in result

        assert isinstance(result["text"], str)
        assert len(result["text"]) > 0

        assert isinstance(result["metadata"], dict)
        assert result["metadata"].get("title") or result["metadata"].get("book_id")

        assert math.isfinite(result["distance"])


# Test 4: Check that results are ranked by distance
def test_similarity_order():
    results = retrieve("What is proper infant nutrition?", k=5)

    distances = [result["distance"] for result in results]

    assert distances == sorted(distances)


# Test 5: Check that retrieval finds relevant topics
@pytest.mark.parametrize(
    "question, keywords",
    [
        (
            "How should infants be fed?",
            ["feed", "milk", "nurs", "diet"]
        ),
        (
            "How should babies be bathed?",
            ["bath", "wash", "clean"]
        ),
        (
            "What advice is given about infant sleep?",
            ["sleep", "bed", "night", "rest"]
        ),
    ]
)
def test_relevant_passages(question, keywords):
    results = retrieve(question, k=5)

    passages = " ".join(
        result["text"].lower()
        for result in results
    )

    assert any(word in passages for word in keywords)


# Test 6: Check that empty questions return no results
def test_empty_question():
    results = retrieve("")

    assert results == []


# Test 7: Check that invalid k values are rejected
@pytest.mark.parametrize("k", [0, -1, -5])
def test_invalid_k(k):
    with pytest.raises(ValueError):
        retrieve("How should infants be fed?", k=k)


# Test 8: Multi-book retrieval
from retrieval import list_books, retrieve_across_books


def test_list_books():
    books = list_books()

    assert len(books) >= 2
    assert [b["book_id"] for b in books] == sorted(b["book_id"] for b in books)
    assert sum(b["chunks"] for b in books) == collection.count()
    for book in books:
        assert book["title"] and book["author"] and book["year"]


def test_across_books_covers_every_book_that_discusses_the_topic():
    # Every book in the library discusses infant feeding
    results = retrieve_across_books("How should infants be fed?")

    books_found = {r["metadata"]["book_id"] for r in results}
    assert books_found == {b["book_id"] for b in list_books()}
    assert len({r["chunk_id"] for r in results}) == len(results)
    distances = [r["distance"] for r in results]
    assert distances == sorted(distances)


def test_across_books_finds_more_books_than_global_top_k():
    question = "Is it good to rock a baby to sleep?"

    global_books = {r["metadata"]["book_id"] for r in retrieve(question, k=3)}
    across_books = {r["metadata"]["book_id"] for r in retrieve_across_books(question, k=3)}

    assert global_books < across_books


def test_across_books_respects_limits():
    results = retrieve_across_books("How should infants be fed?", k=3, per_book=3, max_passages=6)

    assert len(results) <= 6
    # Trimming keeps at least one passage from each book
    assert len({r["metadata"]["book_id"] for r in results}) == len(list_books())


def test_across_books_drops_off_topic_questions():
    assert retrieve_across_books("What is the best car seat?") == []
    # With the distance limit disabled, the nearest passages come back anyway
    assert retrieve_across_books("What is the best car seat?", max_distance=None, margin=None)


def test_book_filter():
    results = retrieve_across_books("How should infants be fed?", book_ids=["holt_1894"])

    assert results
    assert {r["metadata"]["book_id"] for r in results} == {"holt_1894"}


def test_unknown_book_is_rejected():
    with pytest.raises(ValueError, match="Unknown book_ids"):
        retrieve_across_books("How should infants be fed?", book_ids=["not_a_book"])


def test_across_books_empty_and_invalid():
    assert retrieve_across_books("   ") == []
    with pytest.raises(ValueError):
        retrieve_across_books("How should infants be fed?", per_book=0)
