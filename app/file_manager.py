# app/file_manager.py
import os
from pathlib import Path
from typing import Optional

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

class FileManager:
    @staticmethod
    def save_file(file_content: bytes, filename: str) -> str:
        """Save uploaded file and return path"""
        safe_name = filename.replace("/", "_").replace("\\", "_")
        file_path = UPLOADS_DIR / safe_name
        file_path.write_bytes(file_content)
        return str(file_path)

    @staticmethod
    def get_file_path(filename: str) -> Optional[Path]:
        file_path = UPLOADS_DIR / filename
        if file_path.exists():
            return file_path
        return None

    @staticmethod
    def delete_file(filename: str) -> bool:
        file_path = UPLOADS_DIR / filename
        if file_path.exists():
            file_path.unlink()
            return True
        return False

    @staticmethod
    def list_files() -> list:
        if not UPLOADS_DIR.exists():
            return []
        return [f.name for f in UPLOADS_DIR.iterdir() if f.is_file()]