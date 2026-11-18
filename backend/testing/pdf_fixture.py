"""Builds small, valid PDFs in memory for tests (no PDF library needed).

make_pdf(["page one text", "page two text"]) gives a text-based PDF, one string
per page (newlines become lines). make_pdf(["", ""]) gives pages with no text
layer, like a scanned book.
"""


def _escape(line):
    return line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(page_texts):
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    page_ids = []
    next_id = 4
    for text in page_texts:
        page_id, content_id = next_id, next_id + 1
        next_id += 2
        commands = ["BT", "/F1 10 Tf", "13 TL", "40 760 Td"]
        commands += [f"({_escape(line)}) Tj T*" for line in text.split("\n") if line]
        commands.append("ET")
        stream = "\n".join(commands).encode("latin-1")
        objects[content_id] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode()
        page_ids.append(page_id)
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode()

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for number in range(1, next_id):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {next_id}\n0000000000 65535 f \n".encode()
    for number in range(1, next_id):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {next_id} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


TEETHING_PAGES = [
    "\n".join([
        "Chapter 4. Teething without tears.",
        "Most babies cut their first tooth between four and seven months of age.",
        "Sore, swollen gums make a teething baby fussy, wakeful and eager to chew.",
        "A clean teething ring chilled in the refrigerator soothes sore gums well.",
        "Never freeze the ring solid, because a frozen ring can bruise tender gums.",
        "Rubbing the gums gently with a clean finger for a minute also brings relief.",
        "Drooling and a mild rash on the chin are common while teeth come through.",
        "Wipe the chin often with a soft cloth to keep the skin dry and comfortable.",
    ]),
    "\n".join([
        "Chapter 5. When to call the doctor.",
        "Teething does not cause high fever, and a baby with a fever should be seen.",
        "Teething gels that numb the gums are not recommended for young babies.",
        "Amber necklaces sold for teething are a choking and strangling hazard.",
        "A teething baby may want to nurse more often, which is perfectly normal.",
        "Offer a cool, wet washcloth to chew on during the worst of the soreness.",
        "Keep a regular bedtime routine even when teething disturbs sleep for a while.",
        "Most of the discomfort passes within a few days of each tooth coming through.",
    ]),
    "\n".join([
        "Chapter 6. Caring for the first teeth.",
        "Clean the first teeth twice a day with a soft infant toothbrush and water.",
        "A smear of fluoride toothpaste the size of a grain of rice is enough at first.",
        "Avoid putting a baby to bed with a bottle of milk or juice, which harms teeth.",
        "Book a first dental visit around the first birthday or after the first tooth.",
        "Let the baby hold a toothbrush during bath time so brushing becomes familiar.",
        "Praise and a cheerful song make tooth brushing a pleasant part of the evening.",
        "Healthy first teeth hold space in the jaw for the permanent teeth that follow.",
    ]),
]
