from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
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


@app.post("/api/chat")
async def chat(request: ChatRequest):
    prompt = f"""
You are a helpful coding assistant.

Answer the user's question about {request.language}.
Give clear explanations and code examples when useful.
Use Markdown code blocks for code.

User question:
{request.message}
"""

    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2
        }
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(OLLAMA_URL, json=payload)
            response.raise_for_status()

        data = response.json()
        return {"reply": data["response"].strip()}

    except httpx.ConnectError:
        return {
            "reply": "Cannot connect to Ollama. Make sure the Ollama application is running."
        }

    except httpx.HTTPError as error:
        return {"reply": f"Ollama request failed: {error}"}