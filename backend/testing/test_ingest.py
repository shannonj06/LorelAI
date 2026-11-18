import pytest

import ingest
import retrieval
from ingest import IngestError, extract_pages
from pdf_fixture import TEETHING_PAGES, make_pdf
from retrieval import retrieve_across_books

QUESTION = "How can I soothe my teething baby's sore gums?"


@pytest.fixture
def teething_pdf(tmp_path):
    path = tmp_path / "teething.pdf"
    path.write_bytes(make_pdf(TEETHING_PAGES))
    return str(path)


def ingest_teething(path, owner_id="u1", book_id="up_test01"):
    return ingest.ingest_pdf(
        path, book_id=book_id, title="Teething Without Tears", author="Jane Q. Writer", year=2004,
        owner_id=owner_id, store=retrieval.uploads, model=retrieval.model,
    )


@pytest.fixture
def cleanup():
    yield
    for book_id, owner in [("up_test01", "u1"), ("up_test02", "u2")]:
        ingest.delete_book(book_id, owner, retrieval.uploads)


# Test 1: text extraction keeps real page numbers and rejects scans
def test_extract_pages_from_a_text_pdf(teething_pdf):
    pages, page_count = extract_pages(teething_pdf)

    assert page_count == 3
    assert [number for number, _ in pages] == [1, 2, 3]
    assert "chilled in the refrigerator" in pages[0][1]
    assert "\n" not in pages[0][1]


def test_scanned_pdf_is_rejected(tmp_path):
    path = tmp_path / "scan.pdf"
    path.write_bytes(make_pdf(["", "", ""]))  # pages with no text layer

    with pytest.raises(IngestError) as error:
        extract_pages(str(path))

    assert error.value.code == "no_text"
    assert "OCR" in error.value.message


def test_mostly_blank_pdf_is_rejected(tmp_path):
    path = tmp_path / "mostly-blank.pdf"
    path.write_bytes(make_pdf([TEETHING_PAGES[0]] + [""] * 9))

    with pytest.raises(IngestError) as error:
        extract_pages(str(path))

    assert error.value.code == "no_text"


@pytest.mark.parametrize("content", [b"not a pdf at all", b"%PDF-1.4\ngarbage"])
def test_unreadable_file_is_rejected(tmp_path, content):
    path = tmp_path / "bad.pdf"
    path.write_bytes(content)

    with pytest.raises(IngestError) as error:
        extract_pages(str(path))

    assert error.value.code in {"unreadable_pdf", "empty"}


def test_clean_text_rejoins_hyphenated_words():
    assert ingest.clean_text("a well-\nknown fact\n\nabout  teeth") == "a wellknown fact about teeth"


def test_chunking_overlaps_long_pages():
    long_page = " ".join(f"word{i}" for i in range(900))

    chunks = ingest.chunk_pages([(7, long_page)], retrieval.model.tokenizer)

    assert len(chunks) > 1
    assert {page for page, _, _ in chunks} == {7}
    assert [index for _, index, _ in chunks] == list(range(len(chunks)))


# Test 2: an uploaded book is searchable by its owner only
def test_ingest_then_retrieve_for_the_owner_only(teething_pdf, cleanup):
    result = ingest_teething(teething_pdf)

    assert result["pages"] == 3
    assert result["chunks"] >= 3

    mine = retrieve_across_books(QUESTION, book_ids=[], owner_id="u1", upload_ids=["up_test01"])
    assert mine
    top = mine[0]
    assert top["metadata"]["book_id"] == "up_test01"
    assert top["metadata"]["source"] == "upload"
    assert top["metadata"]["owner_id"] == "u1"
    assert top["metadata"]["page"] == 1  # the page about sore gums
    assert top["metadata"]["year"] == 2004

    # Another reader naming the same book ID gets nothing
    assert retrieve_across_books(QUESTION, book_ids=[], owner_id="u2", upload_ids=["up_test01"]) == []
    # And the shared library never includes uploads
    library = retrieve_across_books(QUESTION)
    assert all(p["metadata"].get("source") != "upload" for p in library)


def test_uploads_and_library_are_searched_together(teething_pdf, cleanup):
    ingest_teething(teething_pdf)

    results = retrieve_across_books(QUESTION, owner_id="u1", upload_ids=["up_test01"])

    books = {p["metadata"]["book_id"] for p in results}
    assert "up_test01" in books


def test_upload_ids_need_an_owner():
    with pytest.raises(ValueError, match="owner_id"):
        retrieve_across_books(QUESTION, upload_ids=["up_test01"])


def test_empty_library_selection_searches_nothing_shared():
    assert retrieve_across_books("How should infants be fed?", book_ids=[]) == []


def test_reingest_replaces_and_delete_removes(teething_pdf, cleanup):
    first = ingest_teething(teething_pdf)
    second = ingest_teething(teething_pdf)
    stored = retrieval.uploads.get(where=ingest.book_filter("up_test01", "u1"), include=[])["ids"]
    assert len(stored) == first["chunks"] == second["chunks"]

    # Deleting with the wrong owner removes nothing
    assert ingest.delete_book("up_test01", "u2", retrieval.uploads) == 0
    assert ingest.delete_book("up_test01", "u1", retrieval.uploads) == first["chunks"]
    assert retrieve_across_books(QUESTION, book_ids=[], owner_id="u1", upload_ids=["up_test01"]) == []
