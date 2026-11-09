import hashlib
import io
import json
import os
import sys
import threading
import zipfile
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from rowvision_worker import desktop, models
from rowvision_worker.models import Model


def zipped(content: bytes, name: str = "inner/end2end.onnx") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, content)
    return buffer.getvalue()


def model_for(stem: str, content: bytes) -> tuple[Model, bytes]:
    archive = zipped(content)
    model = Model(f"{stem}.zip", len(archive), f"{stem}.onnx", len(content), hashlib.sha256(content).hexdigest())
    return model, archive


REAL = models.MODELS
CONTENT = {"alpha": b"a" * 700_000, "beta": b"b" * 300_000}
BUILT = {stem: model_for(stem, content) for stem, content in CONTENT.items()}
FAKES = tuple(model for model, _ in BUILT.values())


class Site:
    """A web server on this computer, serving whatever the test puts in `files`."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.hits: list[str] = []
        site = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                site.hits.append(self.path)
                body = site.files.get(self.path)
                if body is None:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def serve_all(self, prefix: str = "") -> None:
        for model, archive in BUILT.values():
            self.files[f"{prefix}/{model.zip_name}"] = archive


@pytest.fixture
def site() -> Iterator[Site]:
    running = Site()
    yield running
    running.server.shutdown()
    running.server.server_close()


@pytest.fixture(autouse=True)
def small_models(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(models, "MODELS", FAKES)
    monkeypatch.setattr(models, "PROGRESS_STEP", 1)
    monkeypatch.setattr(models, "CHUNK", 100_000)


def never() -> bool:
    return False


def test_the_folder_follows_the_cache_settings_rtmlib_uses(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("TORCH_HOME", raising=False)
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    assert models.checkpoints_dir() == tmp_path / "rtmlib" / "hub" / "checkpoints"
    monkeypatch.setenv("TORCH_HOME", str(tmp_path / "torch"))
    assert models.checkpoints_dir() == tmp_path / "torch" / "hub" / "checkpoints"


def test_the_real_models_are_listed_with_the_names_rtmlib_gives_them() -> None:
    # The list in use, not the stand-ins. rtmlib names the file after its zip.
    assert [m.zip_name.removesuffix(".zip") for m in REAL] == [m.file.removesuffix(".onnx") for m in REAL]
    assert all(len(m.sha256) == 64 for m in REAL)
    assert 140e6 < sum(m.zip_bytes for m in REAL) < 150e6


def test_status_says_what_is_missing_and_how_much_to_download(tmp_path: Path) -> None:
    first = models.status(tmp_path)
    assert first["ready"] is False
    assert first["download_bytes"] == first["total_bytes"] == sum(m.zip_bytes for m in FAKES)
    (tmp_path / FAKES[0].file).write_bytes(CONTENT["alpha"])
    (tmp_path / FAKES[1].file).write_bytes(b"cut short")
    second = models.status(tmp_path)
    assert second["ready"] is False
    assert second["download_bytes"] == FAKES[1].zip_bytes
    (tmp_path / FAKES[1].file).write_bytes(CONTENT["beta"])
    assert models.status(tmp_path)["ready"] is True


def test_fetching_gets_every_model_and_reports_steady_progress(site: Site, tmp_path: Path) -> None:
    site.serve_all()
    events: list[dict[str, Any]] = []
    models.fetch(tmp_path, events.append, never, site.base)
    assert models.status(tmp_path)["ready"] is True
    for stem, content in CONTENT.items():
        assert (tmp_path / f"{stem}.onnx").read_bytes() == content
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(m.file for m in FAKES)
    total = sum(m.zip_bytes for m in FAKES)
    shown = [event["downloaded"] for event in events]
    assert shown[0] == 0 and shown[-1] == total
    assert shown == sorted(shown)
    assert all(event["total"] == total for event in events)


def test_only_what_is_missing_is_fetched(site: Site, tmp_path: Path) -> None:
    site.serve_all()
    (tmp_path / FAKES[0].file).write_bytes(CONTENT["alpha"])
    events: list[dict[str, Any]] = []
    models.fetch(tmp_path, events.append, never, site.base)
    assert site.hits == [f"/{FAKES[1].zip_name}"]
    assert events[-1]["total"] == FAKES[1].zip_bytes


def test_a_model_with_the_wrong_contents_is_never_put_in_place(site: Site, tmp_path: Path) -> None:
    site.serve_all()
    site.files[f"/{FAKES[0].zip_name}"] = zipped(b"x" * (len(CONTENT["alpha"]) + 50_000))
    # The zip is a different size from the one expected, so it is caught before it is opened.
    with pytest.raises(models.ModelError, match="cut short"):
        models.fetch(tmp_path, lambda event: None, never, site.base)
    assert list(tmp_path.iterdir()) == []


def test_the_right_size_but_the_wrong_bytes_is_called_damaged(monkeypatch: pytest.MonkeyPatch, site: Site, tmp_path: Path) -> None:
    other = zipped(b"x" * len(CONTENT["alpha"]))
    model = Model(FAKES[0].zip_name, len(other), FAKES[0].file, FAKES[0].file_bytes, FAKES[0].sha256)
    monkeypatch.setattr(models, "MODELS", (model,))
    site.files[f"/{model.zip_name}"] = other
    with pytest.raises(models.ModelError, match="damaged"):
        models.fetch(tmp_path, lambda event: None, never, site.base)
    assert list(tmp_path.iterdir()) == []


def test_a_zip_without_the_model_inside_is_refused(monkeypatch: pytest.MonkeyPatch, site: Site, tmp_path: Path) -> None:
    wrong = zipped(CONTENT["alpha"], name="readme.txt")
    model = Model(FAKES[0].zip_name, len(wrong), FAKES[0].file, FAKES[0].file_bytes, FAKES[0].sha256)
    monkeypatch.setattr(models, "MODELS", (model,))
    site.files[f"/{model.zip_name}"] = wrong
    with pytest.raises(models.ModelError, match="did not hold"):
        models.fetch(tmp_path, lambda event: None, never, site.base)
    assert list(tmp_path.iterdir()) == []


def test_something_that_is_not_a_zip_is_called_damaged(monkeypatch: pytest.MonkeyPatch, site: Site, tmp_path: Path) -> None:
    junk = b"not a zip at all" * 10
    model = Model(FAKES[0].zip_name, len(junk), FAKES[0].file, FAKES[0].file_bytes, FAKES[0].sha256)
    monkeypatch.setattr(models, "MODELS", (model,))
    site.files[f"/{model.zip_name}"] = junk
    with pytest.raises(models.ModelError, match="damaged"):
        models.fetch(tmp_path, lambda event: None, never, site.base)
    assert list(tmp_path.iterdir()) == []


def test_the_mirror_is_used_when_the_first_address_fails(monkeypatch: pytest.MonkeyPatch, site: Site, tmp_path: Path) -> None:
    site.serve_all("/mirror")
    monkeypatch.setattr(models, "OPENMMLAB", site.base + "/gone/")
    monkeypatch.setattr(models, "MIRROR", site.base + "/mirror/")
    models.fetch(tmp_path, lambda event: None, never)
    assert models.status(tmp_path)["ready"] is True
    assert any(hit.startswith("/gone/") for hit in site.hits)


def test_no_connection_gives_a_plain_message(tmp_path: Path) -> None:
    with pytest.raises(models.ModelError, match="internet connection"):
        models.fetch(tmp_path, lambda event: None, never, "http://127.0.0.1:9")
    assert list(tmp_path.iterdir()) == []


def test_stopping_part_way_leaves_nothing_behind(site: Site, tmp_path: Path) -> None:
    site.serve_all()
    calls = {"n": 0}

    def stopped() -> bool:
        calls["n"] += 1
        return calls["n"] > 3

    with pytest.raises(models.Cancelled):
        models.fetch(tmp_path, lambda event: None, stopped, site.base)
    assert list(tmp_path.iterdir()) == []


@pytest.fixture
def standard_input(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """A standard input that stays open and says nothing, as the app's does."""
    read, write = os.pipe()
    monkeypatch.setattr(sys, "stdin", os.fdopen(read))
    yield
    os.close(write)


def run_models(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, list[dict[str, Any]]]:
    code = desktop.main(["--models", *args])
    return code, [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def test_the_engine_command_reports_status(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.delenv("TORCH_HOME", raising=False)
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    code, lines = run_models(capsys, "status")
    assert code == 0
    assert lines == [models.status(models.checkpoints_dir())]
    assert lines[0]["ready"] is False


def test_the_engine_command_fetches_then_says_done(
    monkeypatch: pytest.MonkeyPatch, site: Site, tmp_path: Path, capsys: pytest.CaptureFixture[str], standard_input: None
) -> None:
    site.serve_all()
    monkeypatch.delenv("TORCH_HOME", raising=False)
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.setenv("ROWVISION_MODELS_BASE", site.base)
    code, lines = run_models(capsys, "fetch")
    assert code == 0
    assert lines[-1] == {"event": "done"}
    assert models.status(models.checkpoints_dir())["ready"] is True


def test_the_engine_command_says_why_it_failed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str], standard_input: None
) -> None:
    monkeypatch.delenv("TORCH_HOME", raising=False)
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.setenv("ROWVISION_MODELS_BASE", "http://127.0.0.1:9")
    code, lines = run_models(capsys, "fetch")
    assert code == desktop.FAILED
    assert lines[-1]["event"] == "failed"
    assert "internet connection" in lines[-1]["message"]


def test_an_unknown_models_command_fails_cleanly(capsys: pytest.CaptureFixture[str]) -> None:
    code, lines = run_models(capsys, "delete-everything")
    assert code == desktop.FAILED
    assert lines[0]["event"] == "failed"
