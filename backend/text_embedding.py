from sentence_transformers import SentenceTransformer
import json
from pathlib import Path
from transformers import AutoTokenizer

model = SentenceTransformer("BAAI/bge-small-en-v1.5")
tokenizer = AutoTokenizer.from_pretrained("BAAI/bge-small-en-v1.5")
CHUNK_SIZE = 300
OVERLAP = 40
BACKEND = Path(__file__).resolve().parent
SRC_DIR = BACKEND / "books_clean"

def chunk_text(text):
    tokens = tokenizer.encode(text, add_special_tokens=False)
    chunks = []
    step = CHUNK_SIZE - OVERLAP
    for start in range(0, len(tokens), step):
        chunk_tokens = tokens[start: start + CHUNK_SIZE]
        # coverts the ids back into actual words
        chunk = tokenizer.decode(chunk_tokens, skip_special_tokens = True)
        #checks if chunk contains actual text
        if chunk.strip():
            chunks.append(chunk)
        if start + CHUNK_SIZE >= len(tokens):
            break
    return chunks

def process_books(book_pages):
    all_chunks = []
    #loops through the records
    for page_data in book_pages:
        text = page_data['text']
        chunks = chunk_text(text)
        for i, chunk in enumerate(chunks):
            record = {
                "chunk_id": f"{page_data['book_id']}_p{page_data['page']}_c{i}",
                "book_id": page_data["book_id"],
                "title": page_data["title"],
                "Author": page_data["Author"],
                "year": page_data["year"],
                "page": page_data["page"],
                "text": chunk
            }
            all_chunks.append(record)

    return all_chunks

#now have to save the new records into a json file
if __name__ == "__main__":
    all_chunks = []
    #looks through every .jsonl file in books clean folder
    for book_path in SRC_DIR.glob("*.jsnol"):
        book_pages = []
        with open(book_path, "r", encoding="utf-8") as f:
            #goes record by record
            for line in f:
                if line.strip():
                    page_data = json.loads(line)
                    book_pages.append(page_data)
                book_chunks = process_books(book_pages)

        # Add this book's chunks to the full collection
        all_chunks.extend(book_chunks)

        print(f"{book_path.name}: {len(book_chunks)} chunks")

    # Save the processed chunks
    output_path = BACKEND / "chunks.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            all_chunks,
            f,
            indent=2,
            ensure_ascii=False
        )

    print(f"Total chunks created: {len(all_chunks)}")