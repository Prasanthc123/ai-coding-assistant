# vector_db.py
import json
from pathlib import Path
from typing import List, Optional, Dict

import numpy as np

STORE_PATH = Path(__file__).resolve().parent.parent / "data" / "vector_store.json"
STORE_PATH.parent.mkdir(parents=True, exist_ok=True)

FAISS_DIR = Path(__file__).resolve().parent.parent / "faiss_db"
FAISS_DIR.mkdir(parents=True, exist_ok=True)
FAISS_INDEX_PATH = FAISS_DIR / "index.faiss"
FAISS_METADATA_PATH = FAISS_DIR / "metadata.json"

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"

# Embeddings/FAISS are optional heavy dependencies. If they aren't
# installed (or fail to load, e.g. no internet to download the model on
# first run), VectorDB transparently falls back to substring search so the
# app keeps working.
try:
    import faiss  # type: ignore
    from sentence_transformers import SentenceTransformer  # type: ignore

    EMBEDDINGS_AVAILABLE = True
except Exception:
    EMBEDDINGS_AVAILABLE = False


class VectorDB:
    """
    File-backed document store with semantic search.

    - add_document(doc_id, text, chunks, filename)
    - get_document(doc_id)
    - list_documents()
    - delete_document(filename)
    - search(query, top_k=5)

    Semantic search: chunks are embedded with sentence-transformers and
    indexed in a FAISS flat index (cosine similarity via normalized inner
    product). If sentence-transformers/faiss aren't available, `search`
    falls back to substring matching so the app still works without the
    heavier ML dependencies installed.
    """

    _store: Dict[str, Dict] = {}
    _loaded = False

    _embedder = None
    _index = None
    _chunk_records: List[Dict] = []  # aligned with FAISS index rows

    # ---------------------------------------------------------------- IO --
    @classmethod
    def _load(cls):
        if cls._loaded:
            return
        cls._loaded = True

        if STORE_PATH.exists():
            try:
                cls._store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
            except Exception:
                cls._store = {}
        else:
            cls._store = {}

        if EMBEDDINGS_AVAILABLE:
            cls._load_faiss_index()

    @classmethod
    def _save(cls):
        try:
            STORE_PATH.write_text(json.dumps(cls._store, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    # ------------------------------------------------------------ FAISS --
    @classmethod
    def _get_embedder(cls):
        if cls._embedder is None:
            cls._embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)
        return cls._embedder

    @classmethod
    def _load_faiss_index(cls):
        try:
            if FAISS_METADATA_PATH.exists():
                cls._chunk_records = json.loads(FAISS_METADATA_PATH.read_text(encoding="utf-8"))
            else:
                cls._chunk_records = []

            if FAISS_INDEX_PATH.exists() and cls._chunk_records:
                cls._index = faiss.read_index(str(FAISS_INDEX_PATH))
            else:
                cls._index = None
        except Exception:
            cls._chunk_records = []
            cls._index = None

    @classmethod
    def _save_faiss_index(cls):
        try:
            FAISS_METADATA_PATH.write_text(
                json.dumps(cls._chunk_records, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            if cls._index is not None:
                faiss.write_index(cls._index, str(FAISS_INDEX_PATH))
        except Exception:
            pass

    @classmethod
    def _embed(cls, texts: List[str]) -> "np.ndarray":
        embedder = cls._get_embedder()
        vectors = embedder.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return np.asarray(vectors, dtype="float32")

    @classmethod
    def _rebuild_faiss_index(cls):
        """Rebuild the FAISS index from cls._chunk_records (used after deletes)."""
        if not cls._chunk_records:
            cls._index = None
            cls._save_faiss_index()
            return

        try:
            texts = [record["text"] for record in cls._chunk_records]
            vectors = cls._embed(texts)
            dimension = vectors.shape[1]
            index = faiss.IndexFlatIP(dimension)
            index.add(vectors)
            cls._index = index
            cls._save_faiss_index()
        except Exception:
            cls._index = None

    # -------------------------------------------------------------- API --
    @classmethod
    def add_document(cls, doc_id: str, text: str, chunks: List[str], filename: str):
        cls._load()
        cls._store[doc_id] = {
            "filename": filename,
            "text": text,
            "chunks": chunks,
        }
        cls._save()

        if EMBEDDINGS_AVAILABLE and chunks:
            try:
                vectors = cls._embed(chunks)
                if cls._index is None:
                    cls._index = faiss.IndexFlatIP(vectors.shape[1])
                cls._index.add(vectors)
                for i, chunk_text in enumerate(chunks):
                    cls._chunk_records.append(
                        {"doc_id": doc_id, "filename": filename, "chunk_index": i, "text": chunk_text}
                    )
                cls._save_faiss_index()
            except Exception as e:
                print(f"VectorDB: failed to embed/index document {filename}: {e}")

    @classmethod
    def get_document(cls, doc_id: str) -> Optional[Dict]:
        cls._load()
        return cls._store.get(doc_id)

    @classmethod
    def list_documents(cls) -> List[Dict]:
        cls._load()
        return [{"doc_id": k, "filename": v["filename"]} for k, v in cls._store.items()]

    @classmethod
    def delete_document(cls, filename: str):
        cls._load()
        to_delete = [k for k, v in cls._store.items() if v.get("filename") == filename]
        for k in to_delete:
            cls._store.pop(k, None)
        cls._save()

        if EMBEDDINGS_AVAILABLE:
            cls._chunk_records = [r for r in cls._chunk_records if r.get("filename") != filename]
            cls._rebuild_faiss_index()

    @classmethod
    def search(cls, query: str, top_k: int = 5) -> List[Dict]:
        """
        Semantic search over chunk embeddings when available, falling back
        to substring matching otherwise. Returns a list of dicts:
        {doc_id, filename, text, score}
        """
        cls._load()

        if not query:
            results = []
            for doc_id, v in cls._store.items():
                results.append({"doc_id": doc_id, "filename": v["filename"], "text": v["text"], "score": 0})
            return results[:top_k]

        if EMBEDDINGS_AVAILABLE and cls._index is not None and cls._index.ntotal > 0:
            try:
                query_vector = cls._embed([query])
                k = min(top_k, cls._index.ntotal)
                scores, indices = cls._index.search(query_vector, k)
                results = []
                for score, idx in zip(scores[0], indices[0]):
                    if idx < 0 or idx >= len(cls._chunk_records):
                        continue
                    record = cls._chunk_records[idx]
                    results.append(
                        {
                            "doc_id": record["doc_id"],
                            "filename": record["filename"],
                            "text": record["text"],
                            "score": float(score),
                        }
                    )
                if results:
                    return results
            except Exception as e:
                print(f"VectorDB: semantic search failed, falling back to substring search: {e}")

        return cls._substring_search(query, top_k)

    @classmethod
    def _substring_search(cls, query: str, top_k: int = 5) -> List[Dict]:
        q = query.lower()
        results = []
        for doc_id, v in cls._store.items():
            text = (v.get("text") or "").lower()
            score = 0
            if q in text:
                score += 10
            for chunk in v.get("chunks", []):
                if q in (chunk or "").lower():
                    score += 1
            if score > 0:
                results.append({"doc_id": doc_id, "filename": v["filename"], "text": v.get("text", ""), "score": score})

        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:top_k]
