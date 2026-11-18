from unittest.mock import Mock, patch

from ingestion.attachment_downloader import fetch_attachment


def _response(status: int, body: dict) -> Mock:
    response = Mock()
    response.status_code = status
    response.ok = 200 <= status < 300
    response.json.return_value = body
    return response


@patch("ingestion.attachment_downloader.time.sleep")
@patch("ingestion.attachment_downloader.requests.get")
def test_retries_temporary_failure_then_returns_attachment(get, sleep):
    get.side_effect = [
        _response(502, {
            "error": {"message": "Graph throttled the request", "retryable": True},
        }),
        _response(200, {
            "data": {
                "name": "notes.txt",
                "contentType": "text/plain",
                "base64": "aGVsbG8=",
            },
        }),
    ]

    result = fetch_attachment("attachment-id")

    assert result.attachment is not None
    assert result.attachment.data == b"hello"
    assert result.retryable is False
    assert get.call_count == 2
    sleep.assert_called_once()


@patch("ingestion.attachment_downloader.time.sleep")
@patch("ingestion.attachment_downloader.requests.get")
def test_does_not_retry_permanently_unavailable_attachment(get, sleep):
    get.return_value = _response(422, {
        "error": {
            "message": "Attachment type itemAttachment has no downloadable file content",
            "retryable": False,
        },
    })

    result = fetch_attachment("attachment-id")

    assert result.attachment is None
    assert result.retryable is False
    assert "no downloadable file content" in result.reason
    get.assert_called_once()
    sleep.assert_not_called()


@patch("ingestion.attachment_downloader.time.sleep")
@patch("ingestion.attachment_downloader.requests.get")
def test_reports_temporary_failure_after_bounded_retries(get, sleep):
    get.return_value = _response(502, {
        "error": {"message": "Provider temporarily unavailable", "retryable": True},
    })

    result = fetch_attachment("attachment-id")

    assert result.attachment is None
    assert result.retryable is True
    assert result.reason == "Provider temporarily unavailable"
    assert get.call_count == 3
    assert sleep.call_count == 2


@patch("ingestion.attachment_downloader.time.sleep")
@patch("ingestion.attachment_downloader.requests.get")
def test_internal_auth_error_holds_cursor_instead_of_skipping(get, sleep):
    get.return_value = _response(401, {
        "error": {"message": "Invalid or missing internal secret"},
    })

    result = fetch_attachment("attachment-id")

    assert result.attachment is None
    assert result.retryable is True
    assert result.reason == "Invalid or missing internal secret"
    assert get.call_count == 3
    assert sleep.call_count == 2
