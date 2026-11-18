# tests/test_eml_parser.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import tempfile
from pathlib import Path
from ingestion.eml_parser import EmlParser


SAMPLE_EML = """\
From: alice@example.com
To: bob@example.com
Cc: carol@example.com
Subject: Test Email
Date: Mon, 23 Jun 2025 09:00:00 +0000
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Message-ID: <test-001@example.com>

Hello Bob,

This is a test email body with some content.
Please review the attached document.

Best,
Alice
"""

@pytest.fixture
def sample_eml_file(tmp_path):
    eml_file = tmp_path / "test_001.eml"
    eml_file.write_text(SAMPLE_EML, encoding="utf-8")
    return str(eml_file)


def test_parse_file_returns_parsed_email(sample_eml_file):
    parser = EmlParser()
    result = parser.parse_file(sample_eml_file)

    assert result is not None
    assert result.email_id == "test_001"
    assert "alice@example.com" in result.from_addr
    assert "Test Email" in result.subject
    assert "Hello Bob" in result.body_text


def test_parse_file_extracts_addresses(sample_eml_file):
    parser = EmlParser()
    result = parser.parse_file(sample_eml_file)
    assert "bob@example.com" in result.to_addrs
    assert "carol@example.com" in result.cc_addrs


def test_parse_nonexistent_file():
    parser = EmlParser()
    result = parser.parse_file("/nonexistent/path/to/email.eml")
    assert result is None
