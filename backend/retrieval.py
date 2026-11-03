import chromadb
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-small-en-v1.5")

client = chromadb.PersistentClient(path="./chroma_db")
#access the stored books and embeddings
collection = client.get_collection(name="book_chunks")

#this function embeds the question and responds with K matching passages
def retrieve(question, k = 3):
    query_text = (
    "Represent this sentence for searching relevant passages: "
    + question
)

    query_embedding = model.encode(
        query_text,
        normalize_embeddings=True
    ).tolist()

    results = collection.query(
    query_embeddings=[query_embedding],
    n_results=min(k, collection.count()),
    include=["documents", "metadatas", "distances"]

)
    #organize the results
    passages = []

    for i in range(len(results["ids"][0])):
        passages.append({
            "chunk_id": results["ids"][0][i],
            "text": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
            "distance": results["distances"][0][i]
        })

    return passages

if __name__ == "__main__":
    question = "How should infants be fed?"

    results = retrieve(question, k=3)

    for i, result in enumerate(results):
        print(f"\nResult {i + 1}")
        print("Text:", result["text"])
        print("Metadata:", result["metadata"])
        print("Distance:", result["distance"])
        print("-" * 50)