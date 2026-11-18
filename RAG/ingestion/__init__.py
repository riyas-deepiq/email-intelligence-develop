# ingestion/__init__.py
from ingestion.eml_parser import EmlParser, ParsedEmail, ParsedAttachment
from ingestion.chunker import EmailChunker, TextChunk
from ingestion.pipeline import IngestionPipeline

__all__ = [
    "EmlParser",
    "ParsedEmail",
    "ParsedAttachment",
    "EmailChunker",
    "TextChunk",
    "IngestionPipeline",
]
