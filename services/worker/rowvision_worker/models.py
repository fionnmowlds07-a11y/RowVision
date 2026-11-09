"""The measuring models the engine needs, and how to fetch them once.

The engine uses the "balanced" pair from rtmlib: a person detector and a pose model. rtmlib looks for
them in its cache folder and downloads them silently when they are missing. The desktop app does not want
that: it fetches them here, with real progress and a check of every file, and the engine only runs once
they are in place. The file names, sizes and checksums are those of the files rtmlib itself produces.
"""

import hashlib
import os
import ssl
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

OPENMMLAB = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"
MIRROR = "https://huggingface.co/Tau-J/RTMPose/resolve/main/rtmposev1/onnx_sdk/"
CHUNK = 256 * 1024
TIMEOUT = 30
NO_CONNECTION = "Couldn't reach the download. Check your internet connection and try again."
PROGRESS_STEP = 512 * 1024
"""Smallest amount downloaded worth telling the app about."""

Send = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class Model:
    zip_name: str
    zip_bytes: int
    file: str
    file_bytes: int
    sha256: str


MODELS = (
    Model(
        "yolox_m_8xb8-300e_humanart-c2c7a14a.zip",
        94_223_081,
        "yolox_m_8xb8-300e_humanart-c2c7a14a.onnx",
        101_400_344,
        "3dea6513388889f0fff4b77bf7a26013600321b9eb9ceb0e9a400a82572f5f23",
    ),
    Model(
        "rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip",
        50_799_818,
        "rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.onnx",
        54_330_655,
        "5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c",
    ),
)


class ModelError(Exception):
    """Something went wrong fetching the models. The message is for the person using the app."""


class Cancelled(Exception):
    pass


def checkpoints_dir() -> Path:
    """Where rtmlib looks, which follows TORCH_HOME and XDG_CACHE_HOME as rtmlib does."""
    cache = os.getenv("XDG_CACHE_HOME", os.path.join("~", ".cache"))
    home = os.path.expanduser(os.getenv("TORCH_HOME", os.path.join(cache, "rtmlib")))
    return Path(home) / "hub" / "checkpoints"


def missing(folder: Path) -> list[Model]:
    """Models not there, or the wrong size. A full check of the contents happens when they are fetched."""
    found = []
    for model in MODELS:
        path = folder / model.file
        if not path.is_file() or path.stat().st_size != model.file_bytes:
            found.append(model)
    return found


def status(folder: Path) -> dict[str, Any]:
    absent = missing(folder)
    return {
        "event": "status",
        "ready": not absent,
        "download_bytes": sum(model.zip_bytes for model in absent),
        "total_bytes": sum(model.zip_bytes for model in MODELS),
    }


def secure_context() -> ssl.SSLContext:
    """Use certifi's list when it is there, so a bundled program does not rely on the system's own."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover - certifi comes with the engine
        return ssl.create_default_context()


def sources(model: Model, base: str | None) -> list[str]:
    if base:
        return [base.rstrip("/") + "/" + model.zip_name]
    return [OPENMMLAB + model.zip_name, MIRROR + model.zip_name]


def download(
    url: str, target: Path, expected: int, report: Callable[[int], None], stopped: Callable[[], bool]
) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "RowVision"})
    context = secure_context() if url.startswith("https:") else None
    opened = urllib.request.urlopen(request, timeout=TIMEOUT, context=context)  # noqa: S310
    with opened as reply, target.open("wb") as out:
        while True:
            if stopped():
                raise Cancelled
            chunk = reply.read(CHUNK)
            if not chunk:
                break
            out.write(chunk)
            report(len(chunk))
    if target.stat().st_size != expected:
        raise ModelError("The download was cut short.")


def install(archive: Path, model: Model, folder: Path) -> None:
    """Take the model out of its zip, check it is the one expected, and only then put it in place."""
    stem = model.file.removesuffix(".onnx")
    part = folder / f".{stem}.part"
    try:
        with zipfile.ZipFile(archive) as zipped:
            names = [name for name in zipped.namelist() if name.endswith("end2end.onnx")]
            if len(names) != 1:
                raise ModelError("The download did not hold the model it should.")
            digest = hashlib.sha256()
            with zipped.open(names[0]) as source, part.open("wb") as out:
                while chunk := source.read(CHUNK):
                    digest.update(chunk)
                    out.write(chunk)
        if part.stat().st_size != model.file_bytes or digest.hexdigest() != model.sha256:
            raise ModelError("The download was damaged.")
        part.replace(folder / model.file)
    except zipfile.BadZipFile as error:
        raise ModelError("The download was damaged.") from error
    finally:
        part.unlink(missing_ok=True)


def fetch(folder: Path, send: Send, stopped: Callable[[], bool], base: str | None = None) -> None:
    """Get whatever is missing, telling the app how far along it is. Raises ModelError with plain words."""
    folder.mkdir(parents=True, exist_ok=True)
    todo = missing(folder)
    total = sum(model.zip_bytes for model in todo)
    done = 0
    last = -PROGRESS_STEP
    send({"event": "models", "downloaded": 0, "total": total})

    def report(count: int) -> None:
        nonlocal done, last
        done += count
        if done - last >= PROGRESS_STEP:
            last = done
            send({"event": "models", "downloaded": done, "total": total})

    for model in todo:
        archive = folder / f".{model.zip_name}.part"
        counted = done
        failure: ModelError | None = None
        try:
            for url in sources(model, base):
                done = counted
                try:
                    download(url, archive, model.zip_bytes, report, stopped)
                    failure = None
                    break
                except Cancelled:
                    raise
                except ModelError as error:
                    failure = error
                except OSError:
                    failure = ModelError(NO_CONNECTION)
            if failure is not None:
                raise failure
            install(archive, model, folder)
        finally:
            archive.unlink(missing_ok=True)
    send({"event": "models", "downloaded": total, "total": total})
