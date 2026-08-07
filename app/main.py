# app/main.py
import json
from pathlib import Path
from typing import AsyncGenerator, Optional
import uuid
import httpx
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from .file_manager import FileManager
from .document_processor import DocumentProcessor
from .vector_db import VectorDB

BASE_DIR = Path(__file__).resolve().parent.parent
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "qwen2.5-coder:3b"

app = FastAPI(title="AI Coding Assistant with RAG")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


class ChatRequest(BaseModel):
    message: str
    language: str
    use_documents: bool = False
    doc_id: Optional[str] = None


@app.get("/", response_class=HTMLResponse)
async def home():
    page = BASE_DIR / "app" / "templates" / "index.html"
    return page.read_text(encoding="utf-8")


MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)):
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Uploaded file has no filename")

        allowed_extensions = [
            ".pdf",
            ".txt",
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".bmp",
            ".docx",
        ]
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Supported: {', '.join(allowed_extensions)}",
            )

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(content) > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Max size is {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB",
            )

        file_path = FileManager.save_file(content, file.filename)
        extracted_text = DocumentProcessor.process_document(file_path)
        chunks = DocumentProcessor.chunk_text(extracted_text)
        doc_id = str(uuid.uuid4())
        VectorDB.add_document(doc_id, extracted_text, chunks, file.filename)

        return {
            "status": "success",
            "filename": file.filename,
            "message": "Document uploaded and indexed successfully",
            "characters": len(extracted_text),
            "chunks": len(chunks),
            "doc_id": doc_id,
            "extracted_text": extracted_text[:500],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/documents")
async def list_documents():
    try:
        documents = VectorDB.list_documents()
        return {"status": "success", "documents": documents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/documents/{filename}")
async def delete_document(filename: str):
    try:
        VectorDB.delete_document(filename)
        FileManager.delete_file(filename)
        return {"status": "success", "message": f"Document {filename} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def stream_ollama_response(request: ChatRequest, context: str = "") -> AsyncGenerator[str, None]:
    """
    Builds the prompt and streams responses from Ollama.
    Uses the provided `context` string (documents) when available.
    """
    if request.use_documents and context:
        prompt = f"""You are an expert AI coding assistant with access to uploaded documents, images, and code references. Your primary task: Analyze the user's question along with the provided document/image context and generate complete, working code. --- DOCUMENT/IMAGE CONTEXT --- {context} --- END CONTEXT --- Instructions for Code Generation: 1. If the context contains code, algorithm, or problem description, generate a complete working solution 2. Use {request.language} as the programming language 3. Include detailed comments explaining each part 4. Format all code with triple backticks and language name: ```{request.language} your complete code here ``` 5. Provide clear explanations alongside the code 6. Make sure code is production-ready and handles edge cases 7. Include example usage if applicable User Request: {request.message}"""
    else:
        prompt = f"""You are an expert AI coding assistant. Your primary task: Answer the user's question and provide complete, working code examples when requested. Instructions for Code Generation: 1. Generate complete, working code examples in {request.language} 2. Include detailed comments explaining the logic 3. Format code with triple backticks and language name: ```{request.language} your complete code here ``` 4. Provide clear explanations with the code 5. Make code production-ready and handle edge cases 6. Be natural, conversational, and helpful 7. Include example usage when relevant User Request: {request.message}"""

    payload = {"model": MODEL_NAME, "prompt": prompt, "stream": True, "options": {"temperature": 0.3, "top_p": 0.9, "top_k": 40}}
    timeout = httpx.Timeout(connect=15.0, read=None, write=30.0, pool=15.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", OLLAMA_URL, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        text = chunk.get("response", "")
                        if text:
                            yield text
                    except json.JSONDecodeError:
                        continue
    except httpx.ConnectError:
        yield "❌ Cannot connect to Ollama. Make sure: 1. Ollama is running 2. Run: ollama serve 3. Model 'qwen2.5-coder:3b' is installed"
    except httpx.TimeoutException:
        yield "❌ Request timeout. Ollama is taking too long to respond."
    except httpx.HTTPError as error:
        yield f"❌ Ollama error: {str(error)}"
    except Exception as error:
        yield f"❌ Unexpected error: {str(error)}"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """
    Build document context (prefer direct doc_id lookup), then stream response.
    """
    context = ""
    if request.use_documents:
        try:
            # 1) If frontend provided a doc_id, prefer direct lookup
            if request.doc_id:
                try:
                    doc = VectorDB.get_document(request.doc_id)
                    if doc:
                        filename = doc.get("filename", "Unknown")
                        text = doc.get("text") or "\n\n".join(doc.get("chunks", []))
                        context = f"[From: {filename}]\n{text}"
                except Exception as e:
                    print(f"VectorDB.get_document error: {e}")
                    context = ""

            # 2) Fallback: semantic search using the message
            if not context:
                try:
                    search_results = VectorDB.search(request.message, top_k=5)
                    if search_results:
                        context_parts = []
                        for result in search_results:
                            filename = result.get("filename", "Unknown")
                            text = result.get("text", "")
                            context_parts.append(f"[From: {filename}]\n{text}")
                        context = "\n\n---\n\n".join(context_parts)
                except Exception as e:
                    print(f"Error searching documents: {str(e)}")
                    context = ""
        except Exception as e:
            print(f"Unexpected error building context: {str(e)}")
            context = ""

    return StreamingResponse(stream_ollama_response(request, context), media_type="text/plain; charset=utf-8")
