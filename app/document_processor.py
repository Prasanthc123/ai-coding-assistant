# app/document_processor.py
import shutil
from pathlib import Path
from typing import List
import pdfplumber
from PIL import Image

class DocumentProcessor:
    @staticmethod
    def _locate_tesseract() -> str | None:
        """
        Try to find the tesseract binary on the system.
        Returns full path to tesseract executable or None.
        """
        # 1) check if already on PATH
        path = shutil.which("tesseract")
        if path:
            return path

        # 2) common Windows install location
        win_path = Path("C:/Program Files/Tesseract-OCR/tesseract.exe")
        if win_path.exists():
            return str(win_path)

        # 3) another common path (x86)
        win_path_x86 = Path("C:/Program Files (x86)/Tesseract-OCR/tesseract.exe")
        if win_path_x86.exists():
            return str(win_path_x86)

        return None

    @staticmethod
    def extract_text_from_pdf(file_path: str) -> str:
        text = ""
        try:
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text() or ""
                    text += page_text + "\n"
            return text
        except Exception as e:
            return f"[PDF file: {Path(file_path).name}]\n[Error extracting text: {str(e)}]"

    @staticmethod
    def extract_text_from_image(file_path: str) -> str:
        """
        Use pytesseract to OCR the image. If pytesseract or the tesseract
        binary is missing, return a clear message that will appear in
        the upload response so you can debug from the UI.
        """
        try:
            import pytesseract
        except Exception:
            return (
                f"[Image file: {Path(file_path).name}]\n"
                "[Note: Python package 'pytesseract' not available in the environment. "
                "Run: pip install pytesseract]\n"
                "Please install pytesseract and Tesseract binary or describe what you need."
            )

        # Ensure tesseract binary is available and pytesseract points to it
        tesseract_cmd = DocumentProcessor._locate_tesseract()
        if not tesseract_cmd:
            return (
                f"[Image file: {Path(file_path).name}]\n"
                "[Note: Tesseract binary not found on PATH. "
                "Install Tesseract OCR (https://github.com/tesseract-ocr/tesseract) "
                "or set the path manually.]\n"
                "Please install Tesseract or describe what you need."
            )

        # set pytesseract path explicitly (works even if not on PATH)
        try:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        except Exception:
            # older pytesseract layouts might need different attribute access, but this usually works
            try:
                pytesseract.tesseract_cmd = tesseract_cmd
            except Exception:
                # not critical, continue and let pytesseract attempt default
                pass

        # perform OCR
        try:
            image = Image.open(file_path)
            text = pytesseract.image_to_string(image)
            if text and text.strip():
                return text
            else:
                return (
                    f"[Image file: {Path(file_path).name}]\n"
                    "[Note: OCR succeeded but no readable text was extracted. "
                    "This can happen for low-contrast images, screenshots with small fonts, or non-text images.]\n"
                    "Please describe what you need from this image."
                )
        except Exception as e:
            return f"[Image file: {Path(file_path).name}]\n[Error running OCR: {str(e)}]"

    @staticmethod
    def extract_text_from_txt(file_path: str) -> str:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            return f"[Text file: {Path(file_path).name}]\n[Error reading file: {str(e)}]"

    @staticmethod
    def extract_text_from_docx(file_path: str) -> str:
        try:
            from docx import Document
        except Exception:
            return f"[DOCX file: {Path(file_path).name}]\n[python-docx not installed. Install python-docx to extract DOCX text.]"
        try:
            doc = Document(file_path)
            text = "\n".join([p.text for p in doc.paragraphs])
            return text
        except Exception as e:
            return f"[DOCX file: {Path(file_path).name}]\n[Error reading DOCX: {str(e)}]"

    @staticmethod
    def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
        if not text:
            return []
        words = text.split()
        chunks: List[str] = []
        cur: List[str] = []
        cur_len = 0
        for w in words:
            cur.append(w)
            cur_len += len(w) + 1
            if cur_len >= chunk_size:
                chunks.append(" ".join(cur))
                cur = cur[-(overlap // 5) :] if overlap > 0 else []
                cur_len = sum(len(x) + 1 for x in cur)
        if cur:
            chunks.append(" ".join(cur))
        return chunks

    @staticmethod
    def process_document(file_path: str) -> str:
        file_ext = Path(file_path).suffix.lower()
        if file_ext == ".pdf":
            return DocumentProcessor.extract_text_from_pdf(file_path)
        if file_ext in [".png", ".jpg", ".jpeg", ".gif", ".bmp"]:
            return DocumentProcessor.extract_text_from_image(file_path)
        if file_ext == ".txt":
            return DocumentProcessor.extract_text_from_txt(file_path)
        if file_ext == ".docx":
            return DocumentProcessor.extract_text_from_docx(file_path)
        return f"[File: {Path(file_path).name}]\n[Unsupported file extension: {file_ext}]"