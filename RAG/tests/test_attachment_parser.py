from ingestion.attachment_parser import AttachmentParser
from ingestion.eml_parser import ParsedAttachment


def _text_attachment() -> ParsedAttachment:
    return ParsedAttachment(
        filename="notes.txt",
        content_type="text/plain",
        data=b"attachment text",
        size_bytes=15,
    )


def test_parse_does_not_save_when_save_is_false(tmp_path):
    parser = AttachmentParser(save_dir=str(tmp_path))

    assert parser.parse(_text_attachment(), save=False) == "attachment text"
    assert list(tmp_path.rglob("*")) == []


def test_parse_saves_by_default_when_save_dir_is_configured(tmp_path):
    parser = AttachmentParser(save_dir=str(tmp_path))

    assert parser.parse(_text_attachment()) == "attachment text"
    assert (tmp_path / "misc" / "notes.txt").read_bytes() == b"attachment text"
