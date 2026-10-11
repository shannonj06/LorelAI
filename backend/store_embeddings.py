import json
from pathlib import Path
import chromadb
from sentence_transformers import SentenceTransformer
BACKEND = Path(__file__).resolve().parent

# Load your embedding model
model = SentenceTransformer("BAAI/bge-small-en-v1.5")

# Connect to a persistent local database
client = chromadb.PersistentClient(
    path=str(BACKEND / "chroma_db")
)

collection = client.get_or_create_collection(
    name="book_chunks",
    embedding_function=None,
    configuration={"hnsw": {"space": "cosine"}}
)

# Read your saved chunks
with open(BACKEND / "chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

BATCH_SIZE = 32
#batch size is the number of text chunks you process at a time
for start in range(0, len(chunks), BATCH_SIZE):
    batch = chunks[start:start + BATCH_SIZE]

    texts = [record["text"] for record in batch]
    ids = [record["chunk_id"] for record in batch]

    metadata = [
        {
            "book_id": record["book_id"],
            "title": record["title"],
            "author": record["Author"],
            "year": record["year"],
            "page": record["page"]
        }
        for record in batch
    ]

    # Generate embeddings using Hugging Face
    embeddings = model.encode(
        texts,
        normalize_embeddings=True
    ).tolist()

    # Save the vectors, text, and metadata
    collection.upsert(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=metadata
    )

    print(f"Stored {min(start + BATCH_SIZE, len(chunks))} chunks")

print("Finished! Total stored:", collection.count())