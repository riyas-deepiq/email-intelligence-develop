# =============================================================================
# ingestion/attachment_parser.py — Extract text from email attachments
# =============================================================================
"""
AttachmentParser dispatches to the best available library for each file type:

  .pdf          → pdfplumber (primary) → pdfminer.six (fallback)
  .docx         → python-docx
  .xlsx / .xls  → openpyxl + pandas
  .pptx         → python-pptx
  .txt / .md    → plain decode
  .csv          → pandas
  .png/.jpg/... → pytesseract OCR (skipped gracefully if Tesseract not installed)

All methods return plain UTF-8 text.
Extracted files are optionally saved under data/attachments/<type>/.
"""
from __future__ import annotations

import io
import importlib.util
import logging
import shutil
from pathlib import Path
from typing import Optional

from ingestion.eml_parser import ParsedAttachment

logger = logging.getLogger(__name__)


class AttachmentParser:
    """Parse raw attachment bytes into plain text."""

    # Map of extension → parser method name
    _EXT_MAP = {
        ".pdf":  "_parse_pdf",
        ".docx": "_parse_docx",
        ".doc":  "_parse_docx",
        ".xlsx": "_parse_xlsx",
        ".xls":  "_parse_xlsx",
        ".pptx": "_parse_pptx",
        ".ppt":  "_parse_pptx",
        ".txt":  "_parse_text",
        ".md":   "_parse_text",
        ".csv":  "_parse_csv",
        ".png":  "_parse_image",
        ".jpg":  "_parse_image",
        ".jpeg": "_parse_image",
        ".tiff": "_parse_image",
        ".tif":  "_parse_image",
        ".bmp":  "_parse_image",
        ".gif":  "_parse_image",
        ".webp": "_parse_image",
    }

    IMAGE_EXTENSIONS = frozenset(
        ext for ext, parser in _EXT_MAP.items() if parser == "_parse_image"
    )

    def __init__(self, save_dir: Optional[str] = None):
        """
        Args:
            save_dir: If set, extracted attachment files are saved here
                      under sub-dirs pdfs/, docx/, xlsx/, images/.
        """
        self.save_dir = Path(save_dir) if save_dir else None

    # ── Public API ─────────────────────────────────────────────────────────────

    @classmethod
    def is_image(cls, filename: str) -> bool:
        """Return whether a file is handled by the image OCR path."""
        return Path(filename).suffix.lower() in cls.IMAGE_EXTENSIONS

    @staticmethod
    def ocr_available() -> bool:
        """Return whether both the native OCR engine and Python adapters exist."""
        return bool(
            shutil.which("tesseract")
            and importlib.util.find_spec("pytesseract")
            and importlib.util.find_spec("PIL")
        )

    def parse(self, attachment: ParsedAttachment, save: bool = True) -> str:
        """
        Extract text from a ParsedAttachment.  Returns empty string on failure.

        save: whether to also write a local copy under save_dir (only takes
        effect when save_dir was set). Every extractor below reads from
        attachment.data in memory — the disk copy is never needed for
        parsing itself, only kept for the manual .eml-upload debug path.
        Postgres-sourced bulk ingestion passes save=False so downloaded
        attachment bytes never touch local disk at all.
        """
        ext = Path(attachment.filename).suffix.lower()
        method_name = self._EXT_MAP.get(ext)

        if method_name is None:
            logger.debug("No parser for extension '%s' (%s)", ext, attachment.filename)
            return ""

        if self.save_dir and save:
            self._save_attachment(attachment)

        try:
            method = getattr(self, method_name)
            return method(attachment.data, attachment.filename) or ""
        except Exception as exc:
            logger.warning(
                "Failed to parse attachment '%s': %s", attachment.filename, exc
            )
            return ""

    # ── Save helper ────────────────────────────────────────────────────────────

    def _save_attachment(self, att: ParsedAttachment) -> None:
        ext = Path(att.filename).suffix.lower()
        subdir_map = {
            ".pdf": "pdfs", ".docx": "docx", ".doc": "docx",
            ".xlsx": "xlsx", ".xls": "xlsx",
            ".pptx": "docx", ".ppt": "docx",
            ".png": "images", ".jpg": "images", ".jpeg": "images",
            ".tiff": "images", ".tif": "images", ".bmp": "images",
            ".gif": "images", ".webp": "images",
        }
        subdir = subdir_map.get(ext, "misc")
        dest_dir = self.save_dir / subdir
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / att.filename
        try:
            dest.write_bytes(att.data)
        except OSError as exc:
            logger.debug("Could not save attachment %s: %s", att.filename, exc)

    # ── PDF ───────────────────────────────────────────────────────────────────

    def _parse_pdf(self, data: bytes, filename: str) -> str:
        # Primary: pdfplumber (better table/layout handling)
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                pages = []
                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        pages.append(text.strip())
                if pages:
                    return "\n\n".join(pages)
        except Exception as exc:
            logger.debug("pdfplumber failed for %s: %s — trying pdfminer", filename, exc)

        # Fallback: pdfminer.six
        try:
            from pdfminer.high_level import extract_text as pdfminer_extract
            text = pdfminer_extract(io.BytesIO(data))
            return (text or "").strip()
        except Exception as exc:
            logger.debug("pdfminer fallback also failed for %s: %s", filename, exc)

        # Last resort: pypdf
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(data))
            parts = [p.extract_text() for p in reader.pages if p.extract_text()]
            return "\n".join(parts)
        except Exception as exc:
            logger.warning("All PDF parsers failed for %s: %s", filename, exc)
            return ""

    # ── DOCX ──────────────────────────────────────────────────────────────────

    def _parse_docx(self, data: bytes, filename: str) -> str:
        try:
            import docx
            doc = docx.Document(io.BytesIO(data))
            paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            # Also extract table cells
            for table in doc.tables:
                for row in table.rows:
                    row_texts = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if row_texts:
                        paragraphs.append(" | ".join(row_texts))
            return "\n".join(paragraphs)
        except Exception as exc:
            logger.warning("DOCX parse failed for %s: %s", filename, exc)
            return ""

    # ── XLSX ──────────────────────────────────────────────────────────────────

    def _parse_xlsx(self, data: bytes, filename: str) -> str:
        # Primary: openpyxl
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
            lines = []
            for sheet in wb.worksheets:
                lines.append(f"[Sheet: {sheet.title}]")
                for row in sheet.iter_rows(values_only=True):
                    row_text = " | ".join(
                        str(cell) for cell in row if cell is not None
                    )
                    if row_text.strip():
                        lines.append(row_text.strip())
            wb.close()
            return "\n".join(lines)
        except Exception as exc:
            logger.debug("openpyxl failed for %s: %s — trying pandas", filename, exc)

        # Fallback: pandas
        try:
            import pandas as pd
            dfs = pd.read_excel(io.BytesIO(data), sheet_name=None)
            parts = []
            for sheet_name, df in dfs.items():
                parts.append(f"[Sheet: {sheet_name}]")
                parts.append(df.to_string(index=False))
            return "\n\n".join(parts)
        except Exception as exc:
            logger.warning("All XLSX parsers failed for %s: %s", filename, exc)
            return ""

    # ── PPTX ──────────────────────────────────────────────────────────────────

    def _parse_pptx(self, data: bytes, filename: str) -> str:
        try:
            from pptx import Presentation
            prs = Presentation(io.BytesIO(data))
            lines = []
            for slide_num, slide in enumerate(prs.slides, 1):
                lines.append(f"[Slide {slide_num}]")
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text.strip():
                        lines.append(shape.text.strip())
            return "\n".join(lines)
        except Exception as exc:
            logger.warning("PPTX parse failed for %s: %s", filename, exc)
            return ""

    # ── Plain text / Markdown ─────────────────────────────────────────────────

    def _parse_text(self, data: bytes, filename: str) -> str:
        for charset in ("utf-8", "latin-1", "cp1252"):
            try:
                return data.decode(charset, errors="strict")
            except (UnicodeDecodeError, LookupError):
                continue
        return data.decode("utf-8", errors="replace")

    # ── CSV ───────────────────────────────────────────────────────────────────

    def _parse_csv(self, data: bytes, filename: str) -> str:
        try:
            import pandas as pd
            df = pd.read_csv(io.BytesIO(data))
            return df.to_string(index=False)
        except Exception:
            # Fallback: raw text
            return self._parse_text(data, filename)

    # ── Image (OCR) ───────────────────────────────────────────────────────────

    def _parse_image(self, data: bytes, filename: str) -> str:
        try:
            import pytesseract
            from PIL import Image
            img = Image.open(io.BytesIO(data))
            text = pytesseract.image_to_string(img)
            return (text or "").strip()
        except ImportError:
            logger.debug(
                "pytesseract / Pillow not available — skipping OCR for %s", filename
            )
            return ""
        except Exception as exc:
            logger.warning("OCR failed for %s: %s", filename, exc)
            return ""
