"""Analyse a real clip with a built engine, from folders named the way people's names are.

Usage: check-installed.py ENGINE_FOLDER MODELS_FOLDER

ENGINE_FOLDER holds rowvision-engine and ffmpeg, and MODELS_FOLDER is what the app uses as TORCH_HOME.
The clip is the sculler on the public site. The app writes job.json in UTF-8 with the accents as they are,
so this does the same: on Windows a program that reads it in the system's own encoding can't find the video.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

CLIP = "https://downloads.rowvision.app/media/single-a.mp4"
LIMIT_SECONDS = 600
"""An engine that hangs is ended here, so the check fails with its log."""
NAME = "Seán Ó Briain – Áine"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    engine_folder, models = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    engine = engine_folder / ("rowvision-engine.exe" if os.name == "nt" else "rowvision-engine")
    home = Path(tempfile.mkdtemp()) / NAME
    clip, source = home / "clips" / "one", home / "Vídeo.mp4"
    clip.mkdir(parents=True)
    shutil.copytree(models, home / "models")
    request = urllib.request.Request(CLIP, headers={"User-Agent": "RowVision"})
    with urllib.request.urlopen(request, timeout=120) as reply:
        source.write_bytes(reply.read())
    job = {
        "folder": str(clip), "source": str(source), "start": 0, "length": 10, "boat_class": "1x",
        "side": "scull", "seat": 1, "engine": "real", "device": "cpu", "scope": "seat",
    }
    (clip / "job.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")

    path = os.pathsep.join([str(engine_folder), os.environ["PATH"]])
    env = {**os.environ, "PATH": path, "TORCH_HOME": str(home / "models")}
    started = time.monotonic()
    # Closing its input stops the engine, so the input stays open until it has finished.
    child = subprocess.Popen([str(engine), str(clip / "job.json")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
    assert child.stdout is not None
    killer = threading.Timer(LIMIT_SECONDS, child.kill)
    killer.start()
    # The model library prints lines of its own, which the app skips too.
    events = [json.loads(line) for line in child.stdout if line.startswith(b"{")]
    code = child.wait()
    killer.cancel()
    print(f"{os.cpu_count()} cores, {time.monotonic() - started:.0f} s for a 10 s clip, exit code {code}: {events[-1]}")
    assert code == 0 and events[-1]["event"] == "done"
    for name in ("working.mp4", "summary.json", "frames.json"):
        assert (clip / name).stat().st_size > 0
    again = subprocess.run([str(engine), "--remeasure", str(clip)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, env=env, check=True)
    assert b'"event": "done"' in again.stdout
    # Nothing is left holding the folder open, or the app could not delete the clip.
    shutil.rmtree(home)


main()
