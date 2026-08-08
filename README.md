# CodePilot — Local AI Coding Assistant

A fully local AI coding assistant with a FastAPI backend, a streaming chat UI, a programming-language picker, and support for uploading text/PDF/image files as context. You can paste a screenshot of a coding problem (e.g. a LeetCode question) and get back working code. No paid APIs — everything runs against a local Ollama model.

---

## Features

- FastAPI backend with streaming responses from a local Ollama model (`qwen2.5-coder:3b` by default)
- Clean single-page chat UI with a language dropdown (20+ languages)
- Upload PDFs, `.txt`, `.docx`, or images as context
  - Multiple images/files can be attached to a single question
  - Images are OCR'd locally with Tesseract
- Copy / download generated code blocks
- Syntax highlighting via highlight.js
- Per-browser chat history (stored in `localStorage`, auto-expires after 10 days, capped at 50 sessions)
- Semantic RAG: uploaded documents are chunked, embedded with `sentence-transformers` (`all-MiniLM-L6-v2`), and indexed in FAISS for cosine-similarity retrieval
- Direct `doc_id` lookup for attached files plus a substring-search fallback if the embedding stack is unavailable

---

## Architecture & Data Flow

### Components

| Layer | File / Tool | Purpose |
|---|---|---|
| Frontend | `static/js/app.js` | Chat UI, streaming, localStorage history, file previews, copy/download |
| HTML | `app/templates/index.html` | Single-page layout |
| Styles | `static/css/style.css` | UI theming |
| Backend | `app/main.py` | FastAPI routes: `/api/upload`, `/api/chat`, `/api/documents` |
| Extraction | `app/document_processor.py` | OCR/extract text from images, PDFs, `.docx`, `.txt` and chunk it |
| File I/O | `app/file_manager.py` | Saves uploaded files to disk and deletes them |
| Vector Store | `app/vector_db.py` | File-backed JSON metadata + FAISS embedding index |
| LLM | Local Ollama | Runs `qwen2.5-coder:3b` via `localhost:11434` |

### Request Flow

1. User opens `http://127.0.0.1:8000`. FastAPI returns `app/templates/index.html`.
2. The browser loads `static/js/app.js`, which renders the chat interface.
3. User types a question and/or selects one or more files.
4. On submit:
   - For each selected file, the frontend calls `POST /api/upload`.
   - `FileManager` saves the file to disk.
   - `DocumentProcessor` extracts text (OCR for images, PDF parser for PDFs, `python-docx` for `.docx`, plain text for `.txt`).
   - `DocumentProcessor.chunk_text()` splits the extracted text into chunks.
   - `VectorDB.add_document()` stores the full text and chunks, embeds the chunks with `sentence-transformers`, and adds them to a FAISS `IndexFlatIP` index.
   - The upload endpoint returns a generated `doc_id` for each file.
   - The frontend collects all `doc_ids`.
5. The frontend sends `POST /api/chat` with `message`, `language`, `use_documents: true`, and `doc_ids: [...]`.
6. The `chat()` handler:
   - Fetches each referenced document from `VectorDB` and concatenates the full text as context.
   - If no `doc_ids` are provided, it falls back to semantic search across all indexed documents.
   - Chunks below `MIN_SIMILARITY_SCORE` (0.35) are filtered out to avoid injecting irrelevant context.
7. `stream_ollama_response()` builds the prompt and streams it to `http://localhost:11434/api/generate`.
8. Ollama generates and streams the response back.
9. FastAPI forwards the stream to the browser.
10. `app.js` reads chunks and renders them as text and syntax-highlighted code blocks.

### Storage

- `data/vector_store.json` — persisted document metadata and full text/chunks
- `faiss_db/index.faiss` — persisted FAISS vector index
- `faiss_db/metadata.json` — FAISS chunk metadata aligned to the index rows
- `uploads/` — raw uploaded files saved by `FileManager`

These directories are ignored by git so that uploaded user data is never committed.

---

## Project Structure

```
ai-coding-assistant/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI routes, chat/upload logic, Ollama streaming
│   ├── document_processor.py    # OCR, PDF/txt/docx extraction, chunking
│   ├── file_manager.py          # Uploaded file save/read/delete helpers
│   ├── vector_db.py             # FAISS + sentence-transformers RAG store
│   └── templates/
│       └── index.html           # Chat UI shell
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js               # Chat frontend, file handling, streaming, history
├── tests/
│   └── test_api.py              # API tests with mocked Ollama
├── data/                        # Persisted vector store JSON (gitignored)
├── faiss_db/                    # Persisted FAISS index (gitignored)
├── uploads/                     # Saved uploaded files (gitignored)
├── requirements.txt
└── README.md
```

---

## Prerequisites

1. **Python 3.10+**
2. **[Ollama](https://ollama.com/download)** installed and running, with the coding model pulled:
   ```bash
   ollama serve
   ollama pull qwen2.5-coder:3b
   ```
3. **Tesseract OCR binary** (required for image uploads — `pytesseract` is only a Python wrapper):
   - Windows: [UB Mannheim build](https://github.com/UB-Mannheim/tesseract/wiki) or `choco install -y tesseract`. The default install path `C:\Program Files\Tesseract-OCR\tesseract.exe` is auto-detected.
   - macOS: `brew install tesseract`
   - Linux: `sudo apt install -y tesseract-ocr`

   Without Tesseract, image uploads still work but return a note saying OCR is unavailable instead of extracted text.

---

## Setup

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

---

## Run

```bash
uvicorn app.main:app --reload
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

After code changes, restart `uvicorn` and hard-refresh the browser (`Ctrl + Shift + R` or `Ctrl + F5`).

---

## Running Tests

Tests run fully offline — the Ollama call is mocked, so you don't need Ollama running:

```bash
pytest -v
```

---

## Sharing a Live Demo

To let a recruiter or friend try the app from their device while your laptop is running it, use a tunnel:

```bash
# Option A: ngrok
ngrok http 8000

# Option B: Cloudflare Tunnel
cloudflared tunnel --url http://localhost:8000
```

Both give a temporary public URL. Your laptop must stay on, and `ollama serve` plus `uvicorn` must keep running.

---

## Known Limitations / Next Steps

- **First run downloads the embedding model.** `sentence-transformers` fetches `all-MiniLM-L6-v2` (~90MB) from Hugging Face the first time `VectorDB` embeds anything. The machine needs internet access once. After that the model is cached locally (`~/.cache/torch/sentence_transformers`) and the app works fully offline.
- **If `sentence-transformers`/`faiss-cpu` fail to import or load** (no internet for the first-run download, or platform install issues), `VectorDB` automatically falls back to substring search so the app still works. Check server logs for `VectorDB: failed to embed/index document ...` if search results seem off.
- **Deletes are O(n) rebuilds.** Deleting a document re-embeds all remaining chunks to rebuild the FAISS index. This is fine for a handful of local documents; a proper `IndexIDMap` would be needed to scale further.
- **OCR accuracy** depends on the locally installed Tesseract binary/version. Noisy or low-contrast screenshots may need cropping for best results.
- **highlight.js is loaded from a CDN** (`cdnjs.cloudflare.com`), so syntax highlighting requires internet access. For a fully offline setup, download `highlight.min.js` + a CSS theme into `static/` and update the `<script>`/`<link>` tags in `app/templates/index.html` to point at local files.
- **Chat history is per-browser** (`localStorage` only) — it is not synced across devices or persisted server-side.

---

## Troubleshooting

- **"Cannot connect to Ollama" in chat**: make sure `ollama serve` is running and `ollama pull qwen2.5-coder:3b` has completed.
- **Send button does nothing when only a file is attached**: this is fixed — attaching a file alone now sends a default "analyze this file" instruction to the model.
- **Image uploads return a note instead of real text**: Tesseract binary isn't installed/found. Verify with `tesseract --version`, then restart `uvicorn`.
- **Old uploaded document appears in unrelated questions**: the chat endpoint only injects document context for files attached in the current message. Follow-up messages without a new attachment use semantic search with a similarity threshold, so unrelated questions should not pull in old files.
