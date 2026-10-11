"""Clean the Gutenberg-derived book records in books/ and write them to books_clean/.

Each input line is {"book_id", "title", "author", "year", "page", "text"}. The
same schema is written out. "page" is kept as the original record number so a
cleaned record can be traced back to its source; records that become empty
(title pages, tables of contents, indexes) are dropped, leaving gaps.

Run from anywhere:  py backend/text_extraction.py
"""

import json
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
SRC_DIR = BACKEND / "books"
OUT_DIR = BACKEND / "books_clean"

# Separator placed between records while cutting spans that cross record boundaries.
SEP = "\x00"

# Per-book spans to remove: (start_marker, keep_from_marker). Text from the first
# occurrence of start_marker up to (not including) keep_from_marker is deleted.
# None as start means "beginning of book"; None as keep_from means "end of book".
CUTS = {
    "chavasse_1878": [
        (None, "PREFACE."),                                         # scan credit + title page
        ("CONTENTS. PART I--INFANCY.", "PART I.--INFANCY _Infant"),  # table of contents
        ("INDEX. ABLUTION", None),                                  # index
    ],
    "holt_1894": [
        (None, "PART I THE CARE OF CHILDREN"),     # title page, transcriber note, added TOC
        ("End of Project Gutenberg", None),        # Gutenberg footer
    ],
    "read_1916": [
        (None, "INTRODUCTION “Seventy"),      # transcriber note, title page, dedication
        ("CONTENTS PAGE INTRODUCTION", "CHAPTER I MOTHERCRAFT: ITS MEANING, SCOPE, AND SPIRIT “To know"),  # TOC + list of plates
        ("INDEX Accuracy,", None),                 # index + transcriber errata
    ],
    "sadler_1916": [
        (None, "PREFACE For many years"),          # transcriber notes, title page, dedication
        ("CONTENTS * * * * *", "CHAPTER I THE EXPECTANT MOTHER"),  # TOC + list of illustrations
        ("INDEX INDEX Abortion", None),            # index
    ],
}

# A [Footnote: ...] or [Illustration: ...] that starts in one record and closes in the next.
SPLIT_TAG = re.compile(r"\[(Footnote|Illustration):\s*([^\[\]]*%s[^\[\]]*)\]" % SEP)
FOOTNOTE_BLOCK = re.compile(r"\[Footnote:\s*((?:[^\[\]]|\[[^\]]*\])*)\]")
INLINE_REPLACEMENTS = [
    (re.compile(r"\[Illustration(?::\s*Decoration)?\]"), ""),        # decorative / captionless
    (re.compile(r"\[Illustration:\s*([^\]]*)\]"), r"[Figure: \1]"),
    (re.compile(r"\[Footnote:\s*"), "Footnote: "),                 # unclosed in source (typo'd bracket)
    (re.compile(r"FOOTNOTES:\s*"), ""),
    (re.compile(r"(?<=\S)\[\d+\]"), ""),                             # footnote reference: word[1]
    (re.compile(r"(?<!\S)\[\d+\]\s*"), "Footnote: "),                # footnote body: [1] Text...
    (re.compile(r"_\{(\w+)\}"), r"\1"),                              # CO_{2} -> CO2
    (re.compile(r"(?<![\w_])_(?=\S)([^_]+?)(?<=\S)_(?![\w_])"), r"\1"),  # _italic_
    (re.compile(r"(?<![=\w])=([A-Za-z][^=|+]*?)=(?![=\w])"), r"\1"),     # =bold= (skips ASCII tables)
    (re.compile(r"(?:\* ){4}\*"), ""),                               # * * * * * section breaks
    (re.compile(r"(?<!-)--(?!-)"), "—"),                        # -- -> em dash (not table rules)
    (re.compile(r"[“”]"), '"'),
    (re.compile(r"[‘’]"), "'"),
    (re.compile(r"\s+"), " "),
]


def apply_cuts(book_id, texts):
    """Remove the configured spans from a book's record texts."""
    joined = SEP.join(texts)
    for start, keep_from in CUTS.get(book_id, []):
        i = 0 if start is None else joined.find(start)
        if i == -1:
            raise ValueError(f"{book_id}: start marker not found: {start!r}")
        j = len(joined) if keep_from is None else joined.find(keep_from, i)
        if j == -1:
            raise ValueError(f"{book_id}: end marker not found: {keep_from!r}")
        # Keep record separators so the text still splits back into the same records.
        joined = joined[:i] + SEP * joined.count(SEP, i, j) + joined[j:]
    # Unbracket tags split across records so each half reads as plain text.
    joined = SPLIT_TAG.sub(lambda m: ("Footnote: " if m[1] == "Footnote" else "Figure: ") + m[2], joined)
    return joined.split(SEP)


def clean_text(text):
    # Pull Chavasse-style inline footnotes out of the sentence and append them.
    footnotes = [f"Footnote: {m.strip()}" for m in FOOTNOTE_BLOCK.findall(text)]
    text = FOOTNOTE_BLOCK.sub("", text)
    text = " ".join([text, *footnotes])
    for pattern, repl in INLINE_REPLACEMENTS:
        text = pattern.sub(repl, text)
    return text.strip()


def clean_book(path):
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    book_id = records[0]["book_id"]
    texts = apply_cuts(book_id, [r["text"] for r in records])
    cleaned = []
    for record, text in zip(records, texts):
        text = clean_text(text)
        if text:
            cleaned.append({**record, "text": text})
    return cleaned, len(records)


def main():
    OUT_DIR.mkdir(exist_ok=True)
    for path in sorted(SRC_DIR.glob("*.jsonl")):
        cleaned, original_count = clean_book(path)
        out_path = OUT_DIR / path.name
        with out_path.open("w", encoding="utf-8") as f:
            for record in cleaned:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        print(f"{path.name}: {original_count} -> {len(cleaned)} records")


if __name__ == "__main__":
    main()
