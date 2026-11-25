"""Make the working copy: the one file that analysis and the viewer share.

Each decoded frame becomes exactly one output frame at a constant rate, so frame N of the analysis is
frame N in the browser, whatever the timing of the original. Short keyframe gaps keep stepping quick.
Measured in docs/spikes/working-copy.md.
"""

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime
from fractions import Fraction
from pathlib import Path

SECTION_SECONDS = 60
KEYFRAME_GAP = 15
QUALITY_CRF = 20
MAX_FPS = 120


@dataclass(frozen=True)
class Facts:
    width: int
    height: int
    fps: Fraction
    frames: int
    duration: float
    filmed_at: datetime | None


def _rate(text: str) -> Fraction | None:
    try:
        value = Fraction(text)
    except (ValueError, ZeroDivisionError):
        return None
    return value if 0 < value <= MAX_FPS else None


def parse_probe(report: dict[str, object]) -> Facts:
    """Read ffprobe's report. Average rate first, as the nominal one can be a timebase."""
    streams = report["streams"]
    assert isinstance(streams, list)
    video = next(item for item in streams if item.get("codec_type") == "video")
    container = report.get("format", {})
    assert isinstance(container, dict)
    fps = _rate(video.get("avg_frame_rate", "")) or _rate(video.get("r_frame_rate", ""))
    if fps is None:
        raise ValueError("no usable frame rate")
    fps = fps.limit_denominator(1001)
    duration = float(video.get("duration") or container.get("duration") or 0)
    frames = int(video.get("nb_frames") or round(duration * fps))
    tags = {**container.get("tags", {}), **video.get("tags", {})}
    stamp = tags.get("creation_time")
    return Facts(
        width=int(video["width"]),
        height=int(video["height"]),
        fps=fps,
        frames=frames,
        duration=duration,
        filmed_at=datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else None,
    )


# Both programs get an empty input. The engine is always waiting on its own for "cancel", and on
# Windows a program that shares that input can't start until the wait ends, so no clip would finish.


def probe(path: Path) -> Facts:
    output = subprocess.check_output(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        stdin=subprocess.DEVNULL,
        # Windows would otherwise read it in its own code page, and a tag with an accent could stop the clip.
        encoding="utf-8", errors="replace",
    )
    return parse_probe(json.loads(output))


def copy_command(source: Path, target: Path, start: float, length: float, fps: Fraction) -> list[str]:
    return [
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{start:.3f}", "-i", str(source), "-t", f"{length:.3f}", "-an",
        "-vf", f"settb=expr={fps.denominator}/{fps.numerator},setpts=N",
        "-fps_mode", "passthrough",
        # Without this a phone clip's nominal 30 fps sets the time base, frame times are rounded to
        # 1/60 s, and the viewer can read the wrong frame (#243).
        "-enc_time_base", f"{fps.denominator}/{fps.numerator}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(QUALITY_CRF),
        "-g", str(KEYFRAME_GAP), "-keyint_min", str(KEYFRAME_GAP), "-sc_threshold", "0", "-bf", "0",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(target),
    ]  # fmt: skip


def make_working_copy(
    source: Path, target: Path, start: float, length: float = SECTION_SECONDS
) -> Facts:
    """Cut the section and normalise it. Returns the facts of the copy, with the source's date."""
    original = probe(source)
    subprocess.check_call(
        copy_command(source, target, start, length, original.fps), stdin=subprocess.DEVNULL
    )
    copy = probe(target)
    return Facts(
        width=copy.width,
        height=copy.height,
        fps=original.fps,
        frames=copy.frames,
        duration=copy.duration,
        filmed_at=original.filmed_at,
    )
