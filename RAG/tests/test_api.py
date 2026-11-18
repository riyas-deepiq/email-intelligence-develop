# tests/test_api.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """Create a test client with mocked DB and Qdrant."""
    # Patch heavy dependencies before importing the app
    with (
        patch("db.session.init_db"),
        patch("db.seed.seed"),
        patch("vector_store.qdrant_client.get_qdrant_client") as mock_q,
    ):
        mock_qdrant = MagicMock()
        mock_qdrant.get_collection.return_value = MagicMock(
            status=MagicMock(value="green"),
            points_count=42,
        )
        mock_q.return_value = mock_qdrant

        from api.main import app
        return TestClient(app)


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["status"] == "ok"


def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Insight Hub" in response.json().get("service", "")


def test_query_missing_body(client):
    response = client.post("/api/v1/query/ask", json={})
    assert response.status_code == 422  # Unprocessable Entity (missing required fields)


def test_ingest_status_not_found(client):
    response = client.get("/api/v1/ingest/status/99999")
    assert response.status_code == 404
