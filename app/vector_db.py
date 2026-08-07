# vector_db.py
import json
from pathlib import Path
from typing import List, Optional, Dict

STORE_PATH = Path(__file__).resolve().parent.parent / "data" / "vector_store.json"
STORE_PATH.parent.mkdir(parents=True, exist_ok=True)

class VectorDB:
    """
    Minimal file-backed vector DB replacement for local testing.
    - add_document(doc_id, text, chunks, filename)
    - get_document(doc_id)
    - list_documents()
    - delete_document(filename)
    - search(query, top_k=5)
    Note: search does simple substring matching on text and chunks.
    Replace with your real vector DB later (Chroma/FAISS etc).
    """
    _store: Dict[str, Dict] = {}

    @classmethod
    def _load(cls):
        if cls._store:
            return
        if STORE_PATH.exists():
            try:
                cls._store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
            except Exception:
                cls._store = {}
        else:
            cls._store = {}

    @classmethod
    def _save(cls):
        try:
            STORE_PATH.write_text(json.dumps(cls._store, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    @classmethod
    def add_document(cls, doc_id: str, text: str, chunks: List[str], filename: str):
        cls._load()
        cls._store[doc_id] = {
            "filename": filename,
            "text": text,
            "chunks": chunks
        }
        cls._save()

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

    @classmethod
    def search(cls, query: str, top_k: int = 5) -> List[Dict]:
        """
        Very simple search: substring match in the full text, or in chunk text.
        Returns list of dicts: {doc_id, filename, text, score}
        """
        cls._load()
        if not query:
            # return recent documents if query empty
            results = []
            for doc_id, v in cls._store.items():
                results.append({"doc_id": doc_id, "filename": v["filename"], "text": v["text"], "score": 0})
            # sort by no particular order but return top_k
            return results[:top_k]

        q = query.lower()
        results = []
        for doc_id, v in cls._store.items():
            text = (v.get("text") or "").lower()
            score = 0
            if q in text:
                score += 10
            # check chunks for partial matches
            for chunk in v.get("chunks", []):
                if q in (chunk or "").lower():
                    score += 1
            if score > 0:
                results.append({"doc_id": doc_id, "filename": v["filename"], "text": v.get("text", ""), "score": score})

        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:top_k]