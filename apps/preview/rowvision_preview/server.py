"""Serve the preview page and its small JSON API."""

import argparse
import json
from dataclasses import asdict
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from rowvision.pose import RtmBackend
from rowvision.reference_pose import Style, pose_at
from rowvision.video import VideoReader

from rowvision_preview.clips import ClipLibrary
from rowvision_preview.jobs import BOAT_SEATS, SIDE_NAMES, Runner, Settings, sides_for
from rowvision_preview.labels import LabelStore

STATIC = Path(__file__).parent / "static"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
    "/logic.mjs": ("logic.mjs", "text/javascript; charset=utf-8"),
    "/panel.mjs": ("panel.mjs", "text/javascript; charset=utf-8"),
    "/model.mjs": ("model.mjs", "text/javascript; charset=utf-8"),
    "/vendor/three.module.min.js": ("vendor/three.module.min.js", "text/javascript; charset=utf-8"),
    "/vendor/OrbitControls.js": ("vendor/OrbitControls.js", "text/javascript; charset=utf-8"),
    "/vendor/rubik.woff2": ("vendor/rubik.woff2", "font/woff2"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/label": ("label.html", "text/html; charset=utf-8"),
    "/label.mjs": ("label.mjs", "text/javascript; charset=utf-8"),
}
MAX_BODY_BYTES = 10_000
FRAME_CACHE = "private, max-age=3600"


class Handler(BaseHTTPRequestHandler):
    server_version = "RowVisionPreview"

    def __init__(
        self,
        *args: Any,
        clips: ClipLibrary,
        runner: Runner,
        labels: LabelStore,
        allowed_hosts: set[str],
    ) -> None:
        self.clips = clips
        self.runner = runner
        self.labels = labels
        self.allowed_hosts = allowed_hosts
        super().__init__(*args)

    def log_message(self, format: str, *args: Any) -> None:
        """Keep the terminal clear of a line for every frame."""

    def _send(
        self, status: HTTPStatus, body: bytes, content_type: str, cache: str = "no-store"
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, value: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(value, allow_nan=False).encode()
        self._send(status, body, "application/json")

    def _error(self, status: HTTPStatus, message: str) -> None:
        self._json({"error": message}, status)

    def _host_allowed(self) -> bool:
        """Refuse other hostnames, so a website cannot reach this page by DNS rebinding."""
        if self.headers.get("Host") in self.allowed_hosts:
            return True
        self._error(HTTPStatus.FORBIDDEN, "Open this page at its 127.0.0.1 address.")
        return False

    def _body(self) -> dict[str, Any] | None:
        """Read a JSON body. Requiring the JSON type stops other sites posting by plain form."""
        length = int(self.headers.get("Content-Length") or 0)
        if self.headers.get("Content-Type") != "application/json" or length > MAX_BODY_BYTES:
            self._error(HTTPStatus.BAD_REQUEST, "Send a small JSON body.")
            return None
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            body = None
        if not isinstance(body, dict):
            self._error(HTTPStatus.BAD_REQUEST, "Send a small JSON body.")
            return None
        return body

    def _upload(self) -> None:
        """Save a video sent as the raw body. The binary type stops other sites posting by form."""
        self.close_connection = True  # A refused body is left unread.
        names = parse_qs(urlsplit(self.path).query).get("name")
        if self.headers.get("Content-Type") != "application/octet-stream" or not names:
            self._error(HTTPStatus.BAD_REQUEST, "Send the video as a file with its name.")
            return
        try:
            clip = self.clips.add(names[0], self.rfile, int(self.headers.get("Content-Length") or 0))
        except ValueError as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        except OSError:
            self._error(HTTPStatus.INSUFFICIENT_STORAGE, "The video could not be saved. Check disk space.")
        else:
            self._json({"clip": clip})

    def do_GET(self) -> None:
        if not self._host_allowed():
            return
        path = urlsplit(self.path).path
        if path in STATIC_FILES:
            name, content_type = STATIC_FILES[path]
            self._send(HTTPStatus.OK, (STATIC / name).read_bytes(), content_type)
        elif path == "/api/clips":
            self._json(
                {
                    "clips": self.clips.names(),
                    "boats": BOAT_SEATS,
                    "sides": {boat: sides_for(boat) for boat in BOAT_SEATS},
                    "side_names": SIDE_NAMES,
                }
            )
        elif path == "/api/job":
            self._json(self.runner.status())
        elif path == "/api/labels/next":
            self._json({"item": self.labels.next_item()})
        elif path == "/api/labels/summary":
            self._json(self.labels.summary())
        elif path == "/api/results":
            self._json({"results": self.runner.saved()})
        elif path.startswith("/api/results/"):
            self._saved(unquote(path.removeprefix("/api/results/")))
        elif path == "/api/reference":
            self._reference(urlsplit(self.path).query)
        elif path.startswith("/api/clips/"):
            self._clip(path.removeprefix("/api/clips/").split("/"))
        else:
            self._error(HTTPStatus.NOT_FOUND, "Not found.")

    def _saved(self, name: str) -> None:
        try:
            self._json(self.runner.saved_result(name))
        except KeyError:
            self._error(HTTPStatus.NOT_FOUND, "No such saved result.")

    def _reference(self, query: str) -> None:
        """Return joint positions in metres for a body angle and knee angle."""
        values = parse_qs(query)
        try:
            pose = pose_at(
                float(values["lean"][0]),
                float(values["knee"][0]),
                float(values["reach"][0]),
                Style(values["style"][0]),
            )
        except (KeyError, ValueError):
            self._error(HTTPStatus.BAD_REQUEST, "Send lean, knee, reach and style within normal ranges.")
        else:
            self._json(pose)

    def _clip(self, parts: list[str]) -> None:
        name = unquote(parts[0])
        try:
            if len(parts) == 1:
                self._json(asdict(self.clips.info(name)))
            elif len(parts) == 3 and parts[1] == "frames" and parts[2].endswith(".jpg"):
                index = int(parts[2].removesuffix(".jpg"))
                jpeg = self.clips.frame_jpeg(name, index)
                self._send(HTTPStatus.OK, jpeg, "image/jpeg", FRAME_CACHE)
            else:
                self._error(HTTPStatus.NOT_FOUND, "Not found.")
        except (KeyError, ValueError):
            self._error(HTTPStatus.NOT_FOUND, "No such clip or frame.")

    def do_POST(self) -> None:
        if not self._host_allowed():
            return
        path = urlsplit(self.path).path
        if path == "/api/clips":
            self._upload()
            return
        body = self._body()
        if body is None:
            return
        try:
            if path == "/api/job":
                self.runner.start(Settings.parse(body, self.clips.names()))
            elif path == "/api/job/boat":
                self.runner.choose_boat(float(body["x"]), float(body["y"]))
            elif path == "/api/job/cancel":
                self.runner.cancel()
            elif path == "/api/labels":
                self.labels.save(str(body["id"]), body["joints"])
                self._json(self.labels.summary())
                return
            elif path == "/api/labels/undo":
                self._json({"undone": self.labels.undo()})
                return
            else:
                self._error(HTTPStatus.NOT_FOUND, "Not found.")
                return
        except (KeyError, TypeError) as error:
            self._error(HTTPStatus.BAD_REQUEST, f"Missing or bad field: {error}")
        except ValueError as error:
            self._error(HTTPStatus.BAD_REQUEST, str(error))
        else:
            self._json(self.runner.status())


def make_server(
    host: str, port: int, clips: ClipLibrary, runner: Runner, labels: LabelStore
) -> ThreadingHTTPServer:
    allowed: set[str] = set()
    handler = partial(Handler, clips=clips, runner=runner, labels=labels, allowed_hosts=allowed)
    server = ThreadingHTTPServer((host, port), handler)
    bound = server.server_address[1]
    allowed |= {f"127.0.0.1:{bound}", f"localhost:{bound}"}
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--videos", type=Path, required=True)
    parser.add_argument("--private", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    clips = ClipLibrary(args.videos, args.private / "uploads")
    runner = Runner(
        clips, args.private / "preview" / "results", args.private / "detections",
        VideoReader, RtmBackend,
    )  # fmt: skip
    labels = LabelStore(args.private / "preview" / "results", args.private / "labels" / "labels.json")
    server = make_server(args.host, args.port, clips, runner, labels)
    print(f"Serving on port {args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
