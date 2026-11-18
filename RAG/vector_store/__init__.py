# vector_store/__init__.py
from vector_store.collections import setup_collections
from vector_store.qdrant_client import EmailQdrantClient

__all__ = ["setup_collections", "EmailQdrantClient"]
