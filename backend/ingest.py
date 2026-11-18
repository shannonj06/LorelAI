"""Turn a reader's own PDF into searchable passages. Work in progress.

What works today: PDFs with a real text layer (born-digital books, exported
ebooks, Word/Docs exports). Each PDF page keeps its page number, so citations
point at real pages.

What doesn't yet: scanned books. Their pages are images, so there is no text to
extract without OCR. They are rejected with code "no_text" instead of being
indexed as empty pages that could never be cited.

Passages go into the uploads vector store (retrieval.uploads), tagged with the
owner's ID; retrieval only ever searches a reader's own uploads.
"""

import re
from contextlib import nullcontext

from pypdf import PdfReader
from pypdf.errors import PdfReadError

# Same chunking as the library (text_embedding.py) so uploads and books retrieve alike
CHUNK_SIZE = 300
OVERLAP = 40
EMBED_BATCH = 32

MAX_PAGES = 2000
# A page with less text than this is treated as blank or an image
MIN_PAGE_CHARS = 40
# The whole document must have at least this much text...
MIN_TOTAL_CHARS = 1500
# ...and text on at least this share of its pages, or it's probably scanned
MIN_TEXT_PAGE_SHARE = 0.3


class IngestError(Exception):
    """A PDF that can't be ingested. code is stable; message is safe to show to the reader."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def clean_text(text):
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # re-join words hyphenated across lines
    return re.sub(r"\s+", " ", text).strip()


def extract_pages(path):
    """Returns ([(page_number, text), ...] for pages with text, total page count)."""
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            # Many PDFs are "encrypted" with an empty password just to set permissions
            try:
                reader.decrypt("")
                _ = reader.pages[0]
            except Exception as e:
                raise IngestError("encrypted", "This PDF is password-protected. Remove the password and upload it again.") from e
        page_count = len(reader.pages)
    except IngestError:
        raise
    except (PdfReadError, ValueError, OSError, KeyError) as e:
        raise IngestError("unreadable_pdf", "This file couldn't be read as a PDF.") from e

    if page_count == 0:
        raise IngestError("empty", "This PDF has no pages.")
    if page_count > MAX_PAGES:
        raise IngestError("too_many_pages", f"This PDF has {page_count} pages; the limit is {MAX_PAGES}.")

    pages = []
    for number, page in enumerate(reader.pages, 1):
        try:
            text = clean_text(page.extract_text() or "")
        except Exception:  # one malformed page shouldn't sink the book
            text = ""
        if len(text) >= MIN_PAGE_CHARS:
            pages.append((number, text))

    total_chars = sum(len(text) for _, text in pages)
    if total_chars < MIN_TOTAL_CHARS or len(pages) < MIN_TEXT_PAGE_SHARE * page_count:
        raise IngestError(
            "no_text",
            "We couldn't find enough text in this PDF. It looks like a scan (pages saved as images). "
            "Scanned books need OCR, which isn't supported yet. Text-based PDFs work.",
        )
    return pages, page_count


def chunk_pages(pages, tokenizer, chunk_size=CHUNK_SIZE, overlap=OVERLAP):
    """Split each page into overlapping ~300-token passages: [(page_number, index, text), ...]."""
    chunks = []
    step = chunk_size - overlap
    for page_number, text in pages:
        tokens = tokenizer.encode(text, add_special_tokens=False)
        index = 0
        for start in range(0, len(tokens), step):
            piece = tokenizer.decode(tokens[start:start + chunk_size], skip_special_tokens=True).strip()
            if piece:
                chunks.append((page_number, index, piece))
                index += 1
            if start + chunk_size >= len(tokens):
                break
    return chunks


def book_filter(book_id, owner_id):
    return {"$and": [{"book_id": book_id}, {"owner_id": str(owner_id)}]}


def ingest_pdf(path, *, book_id, title, owner_id, store, model, author=None, year=None, lock=None):
    """Extract, chunk, embed and store one uploaded book. Re-ingesting replaces the old copy.

    lock (optional) is held only while embedding each batch, so questions can be
    answered between batches of a long book.
    """
    pages, page_count = extract_pages(path)
    chunks = chunk_pages(pages, model.tokenizer)
    if not chunks:
        raise IngestError("no_text", "We couldn't find any text to index in this PDF.")

    base = {"book_id": book_id, "title": title, "owner_id": str(owner_id), "source": "upload"}
    if author:
        base["author"] = author
    if year:
        base["year"] = int(year)

    store.delete(where=book_filter(book_id, owner_id))
    for start in range(0, len(chunks), EMBED_BATCH):
        batch = chunks[start:start + EMBED_BATCH]
        texts = [text for _, _, text in batch]
        with lock or nullcontext():
            embeddings = model.encode(texts, normalize_embeddings=True).tolist()
        store.upsert(
            ids=[f"{book_id}_p{page}_c{index}" for page, index, _ in batch],
            documents=texts,
            embeddings=embeddings,
            metadatas=[{**base, "page": page} for page, _, _ in batch],
        )
    return {"book_id": book_id, "pages": page_count, "text_pages": len(pages), "chunks": len(chunks)}


def delete_book(book_id, owner_id, store):
    """Remove an uploaded book's passages. Returns how many were removed."""
    where = book_filter(book_id, owner_id)
    count = len(store.get(where=where, include=[])["ids"])
    if count:
        store.delete(where=where)
    return count
