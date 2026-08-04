from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent

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
    return {
        "reply": (
            f"Backend connection is working! "
            f"You selected {request.language}. "
            f"Your question was: {request.message}"
        )
    }