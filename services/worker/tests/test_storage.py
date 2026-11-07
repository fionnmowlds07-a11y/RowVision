from pathlib import Path

import httpx
import pytest

from rowvision_worker.config import Config
from rowvision_worker.storage import Storage


def storage(handler: object) -> Storage:
    return Storage("http://x", "key", httpx.MockTransport(handler))  # type: ignore[arg-type]


def test_a_download_is_written_to_disk(tmp_path: Path) -> None:
    target = tmp_path / "file"
    storage(lambda request: httpx.Response(200, content=b"video")).download("working", "a/b", target)
    assert target.read_bytes() == b"video"


def test_a_failed_download_raises(tmp_path: Path) -> None:
    with pytest.raises(httpx.HTTPStatusError):
        storage(lambda request: httpx.Response(404)).download("working", "a/b", tmp_path / "file")


def test_an_upload_replaces_and_sends_the_key(tmp_path: Path) -> None:
    source = tmp_path / "file"
    source.write_bytes(b"video")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    storage(handler).upload("frames", "a/b.json", source, "application/json")
    assert seen[0].url.path == "/storage/v1/object/frames/a/b.json"
    assert seen[0].headers["x-upsert"] == "true"
    assert seen[0].headers["authorization"] == "Bearer key"


def test_a_delete_hits_the_object() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.method)
        return httpx.Response(200)

    storage(handler).delete("uploads", "a/source")
    assert seen == ["DELETE"]


def test_settings_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://x")
    monkeypatch.setenv("SUPABASE_URL", "http://x/")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "k")
    config = Config.load()
    assert config.supabase_url == "http://x"
    assert config.device == "cpu"
    assert config.engine == "real"
