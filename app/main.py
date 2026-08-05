import json
from pathlib import Path
from typing import AsyncGenerator

import httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "qwen2.5-coder:3b"

app = FastAPI(title="AI Coding Assistant")

app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR / "static"),
    name="static",
)


class ChatRequest(BaseModel):
    message: str
    language: str


@app.get("/", response_class=HTMLResponse)
async def home():
    page = BASE_DIR / "app" / "templates" / "index.html"
    return page.read_text(encoding="utf-8")


async def stream_ollama_response(
    request: ChatRequest,
) -> AsyncGenerator[str, None]:
    prompt = f"""
You are a concise coding assistant.

Answer the user's question in {request.language}.
Give a short explanation and one complete code example.
Keep the answer focused and correct.

User question:
{request.message}
"""

    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": 0.1
        }
    }

    timeout = httpx.Timeout(
        connect=15.0,
        read=None,
        write=30.0,
        pool=15.0
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                OLLAMA_URL,
                json=payload
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line:
                        continue

                    chunk = json.loads(line)
                    text = chunk.get("response", "")

                    if text:
                        yield text

    except httpx.ConnectError:
        yield "Cannot connect to Ollama. Make sure the Ollama application is running."

    except httpx.HTTPError as error:
        yield f"Ollama request failed: {error}"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    return StreamingResponse(
        stream_ollama_response(request),
        media_type="text/plain; charset=utf-8"
    )