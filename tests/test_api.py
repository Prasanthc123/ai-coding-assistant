# tests/test_api.py
"""
Basic API tests for the AI Coding Assistant backend.

These tests do NOT require Ollama to be running: the /api/chat streaming
call to Ollama is monkeypatched so the test suite can run fully offline.

Run with:
    pytest -v
"""
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import main  # noqa: E402
from app.vector_db import VectorDB  # noqa: E402

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def isolate_vector_store(tmp_path, monkeypatch):
    """Point VectorDB at throwaway files/state so tests don't pollute real data."""
    import app.vector_db as vdb_module

    monkeypatch.setattr(VectorDB, "_store", {})
    monkeypatch.setattr(VectorDB, "_loaded", False)
    monkeypatch.setattr(VectorDB, "_index", None)
    monkeypatch.setattr(VectorDB, "_chunk_records", [])
    monkeypatch.setattr(vdb_module, "STORE_PATH", tmp_path / "vector_store.json")
    monkeypatch.setattr(vdb_module, "FAISS_INDEX_PATH", tmp_path / "index.faiss")
    monkeypatch.setattr(vdb_module, "FAISS_METADATA_PATH", tmp_path / "metadata.json")

    # Avoid downloading/loading the real sentence-transformers model in tests:
    # use a cheap deterministic fake embedding based on text hashing instead.
    if vdb_module.EMBEDDINGS_AVAILABLE:
        import numpy as np

        def fake_embed(texts):
            vectors = []
            for text in texts:
                seed = abs(hash(text)) % (2**32)
                rng = np.random.RandomState(seed)
                vector = rng.rand(384).astype("float32")
                vector /= np.linalg.norm(vector)
                vectors.append(vector)
            return np.asarray(vectors, dtype="float32")

        monkeypatch.setattr(VectorDB, "_embed", staticmethod(fake_embed))

    yield


@pytest.fixture(autouse=True)
def isolate_uploads(tmp_path, monkeypatch):
    """Point FileManager at a throwaway uploads dir."""
    import app.file_manager as fm_module
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(fm_module, "UPLOADS_DIR", upload_dir)
    yield


def test_home_page_loads():
    response = client.get("/")
    assert response.status_code == 200
    assert "AI Coding Assistant" in response.text


def test_upload_rejects_unsupported_extension():
    response = client.post(
        "/api/upload",
        files={"file": ("test.exe", io.BytesIO(b"fake binary"), "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "not allowed" in response.json()["detail"]


def test_upload_rejects_empty_file():
    response = client.post(
        "/api/upload",
        files={"file": ("test.txt", io.BytesIO(b""), "text/plain")},
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_upload_txt_file_succeeds():
    content = b"def add(a, b):\n    return a + b\n"
    response = client.post(
        "/api/upload",
        files={"file": ("snippet.txt", io.BytesIO(content), "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["filename"] == "snippet.txt"
    assert "doc_id" in body
    assert body["characters"] == len(content.decode())


def test_list_documents_after_upload():
    content = b"hello world"
    upload_response = client.post(
        "/api/upload",
        files={"file": ("hello.txt", io.BytesIO(content), "text/plain")},
    )
    assert upload_response.status_code == 200

    list_response = client.get("/api/documents")
    assert list_response.status_code == 200
    documents = list_response.json()["documents"]
    assert any(doc["filename"] == "hello.txt" for doc in documents)


def test_delete_document():
    content = b"to be deleted"
    client.post(
        "/api/upload",
        files={"file": ("delete_me.txt", io.BytesIO(content), "text/plain")},
    )

    delete_response = client.delete("/api/documents/delete_me.txt")
    assert delete_response.status_code == 200

    list_response = client.get("/api/documents")
    documents = list_response.json()["documents"]
    assert not any(doc["filename"] == "delete_me.txt" for doc in documents)


def test_chat_streams_response(monkeypatch):
    """Mock the Ollama call so this test runs without a live Ollama server."""

    async def fake_stream(request, context=""):
        yield "Here is your "
        yield "code."

    monkeypatch.setattr(main, "stream_ollama_response", fake_stream)

    response = client.post(
        "/api/chat",
        json={"message": "write a hello world", "language": "Python", "use_documents": False},
    )
    assert response.status_code == 200
    assert response.text == "Here is your code."


def test_search_falls_back_without_doc_id(monkeypatch):
    """When no doc_id is given, /api/chat should still find relevant context via search()."""
    client.post(
        "/api/upload",
        files={"file": ("armstrong.txt", io.BytesIO(b"Armstrong number algorithm in Python"), "text/plain")},
    )

    captured_context = {}

    async def fake_stream(request, context=""):
        captured_context["context"] = context
        yield "ok"

    monkeypatch.setattr(main, "stream_ollama_response", fake_stream)

    response = client.post(
        "/api/chat",
        json={
            "message": "Armstrong number algorithm in Python",
            "language": "Python",
            "use_documents": True,
        },
    )
    assert response.status_code == 200
    assert "armstrong.txt" in captured_context["context"]


def test_chat_uses_doc_id_context(monkeypatch):
    """Chat should look up the exact document when doc_id is supplied."""
    upload_response = client.post(
        "/api/upload",
        files={"file": ("context.txt", io.BytesIO(b"some reference code"), "text/plain")},
    )
    doc_id = upload_response.json()["doc_id"]

    captured_context = {}

    async def fake_stream(request, context=""):
        captured_context["context"] = context
        yield "ok"

    monkeypatch.setattr(main, "stream_ollama_response", fake_stream)

    response = client.post(
        "/api/chat",
        json={
            "message": "explain this",
            "language": "Python",
            "use_documents": True,
            "doc_id": doc_id,
        },
    )
    assert response.status_code == 200
    assert "context.txt" in captured_context["context"]
    assert "some reference code" in captured_context["context"]
