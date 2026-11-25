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


# ffmpeg is GPL, so its licence and where to get its source go in the installer with it. The sources are copies of
# exactly these versions, kept in the site's bucket. Pin another build and they, licences.html and this change too.
SOURCES = "https://downloads.rowvision.app/sources"
NOTICE = f"""ffmpeg and ffprobe, in this folder, are unmodified builds by BtbN (https://github.com/BtbN/FFmpeg-Builds) of

    {LINUX}
    {WINDOWS}

They include x264 and x265 and are under the GNU General Public License, version 3, in ffmpeg-LICENSE.txt.
They come with no warranty. RowVision runs them as separate programs.

Source code:

    ffmpeg         {SOURCES}/ffmpeg-8dca1586f4.tar.gz
    build scripts  {SOURCES}/ffmpeg-builds-5031c6f.tar.gz
    x264           {SOURCES}/x264-0480cb05.tar.gz
    x265           {SOURCES}/x265-5143a2a0.tar.gz

Each file in scripts.d of the build scripts names the source and exact version of one of the other libraries inside.
If you can't get one, write to privacy@rowvision.app and we will send it. More at https://rowvision.app/licences
"""


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
                if base == "LICENSE.txt":
                    (target / "ffmpeg-LICENSE.txt").write_bytes(archive.read(member))
                    found.add(base)
                if base in wanted and "/bin/" in member:
                    (target / base).write_bytes(archive.read(member))
                    found.add(base)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as archive:
            for member in archive.getmembers():
                base = Path(member.name).name
                if base == "LICENSE.txt" and member.isfile():
                    text = archive.extractfile(member)
                    assert text is not None
                    (target / "ffmpeg-LICENSE.txt").write_bytes(text.read())
                    found.add(base)
                if base in wanted and "/bin/" in member.name and member.isfile():
                    file = archive.extractfile(member)
                    assert file is not None
                    (target / base).write_bytes(file.read())
                    (target / base).chmod(0o755)
                    found.add(base)
    missing = (wanted | {"LICENSE.txt"}) - found
    if missing:
        raise SystemExit(f"missing {sorted(missing)} in {name}")
    (target / "ffmpeg-SOURCE.txt").write_text(NOTICE, encoding="utf-8")

    # It must really make the video the engine asks for.
    encoders = subprocess.run([str(target / sorted(wanted)[0]), "-hide_banner", "-encoders"], capture_output=True, text=True, check=True).stdout
    if "libx264" not in encoders:
        raise SystemExit("this ffmpeg cannot make H.264 video")
    print(f"ffmpeg and ffprobe are in {target}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
