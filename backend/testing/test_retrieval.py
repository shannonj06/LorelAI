
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
