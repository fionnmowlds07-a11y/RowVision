"""Put ffmpeg and ffprobe next to the measuring program, for the installer.

The engine cuts every clip down with ffmpeg and reads it with ffprobe. The build is pinned to one
release and checked against the checksums below. It has to be a GPL build, as the
working copy is made with libx264.

    python scripts/fetch-ffmpeg.py engine
"""

import hashlib
import io
import platform
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

# Pin the last build of a month only: the others are deleted after two weeks, month ends after about two years.
RELEASE = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59"
LINUX = "ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz"
WINDOWS = "ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip"
CHECKSUMS = {
    LINUX: "41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380",
    WINDOWS: "401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f",
}


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=600) as reply:  # noqa: S310 - fixed https address above
        return reply.read()


def main(target: Path) -> None:
    windows = platform.system() == "Windows"
    name = WINDOWS if windows else LINUX
    wanted = {"ffmpeg.exe", "ffprobe.exe"} if windows else {"ffmpeg", "ffprobe"}

    data = download(f"{RELEASE}/{name}")
    if hashlib.sha256(data).hexdigest() != CHECKSUMS[name]:
        raise SystemExit(f"{name} does not match its checksum")

    target.mkdir(parents=True, exist_ok=True)
    found = set()
    if windows:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for member in archive.namelist():
                base = Path(member).name
                if base in wanted and "/bin/" in member:
                    (target / base).write_bytes(archive.read(member))
                    found.add(base)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as archive:
            for member in archive.getmembers():
                base = Path(member.name).name
                if base in wanted and "/bin/" in member.name and member.isfile():
                    file = archive.extractfile(member)
                    assert file is not None
                    (target / base).write_bytes(file.read())
                    (target / base).chmod(0o755)
                    found.add(base)
    if found != wanted:
        raise SystemExit(f"missing {sorted(wanted - found)} in {name}")

    # It must really make the video the engine asks for.
    encoders = subprocess.run([str(target / sorted(wanted)[0]), "-hide_banner", "-encoders"], capture_output=True, text=True, check=True).stdout
    if "libx264" not in encoders:
        raise SystemExit("this ffmpeg cannot make H.264 video")
    print(f"ffmpeg and ffprobe are in {target}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
