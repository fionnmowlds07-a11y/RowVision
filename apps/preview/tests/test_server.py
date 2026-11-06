import http.client
import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from crew import crew_detections
from fakes import FakeBackend, FakeSource, write_video

from rowvision_preview.blades import BladeStore
from rowvision_preview.clips import ClipLibrary
from rowvision_preview.jobs import Runner
from rowvision_preview.labels import LabelStore
from rowvision_preview.server import make_server

CLIP = "clip (1).avi"


@dataclass
class Reply:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)


class Client:
    def __init__(self, port: int) -> None:
        self.port = port

    def call(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Reply:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        reply = Reply(response.status, dict(response.getheaders()), response.read())
        connection.close()
        return reply

    def post(self, path: str, value: Any) -> Reply:
        body = json.dumps(value).encode()
        return self.call("POST", path, body, {"Content-Type": "application/json"})


@pytest.fixture
def client(tmp_path: Path) -> Iterator[Client]:
    videos = tmp_path / "videos"
    videos.mkdir()
    write_video(videos / CLIP)
    points, scores = crew_detections(4)
    clips = ClipLibrary(videos, tmp_path / "uploads")
    runner = Runner(
        clips,
        tmp_path / "results",
        tmp_path / "detections",
        lambda path: FakeSource(len(points)),
        lambda: FakeBackend(points, scores),
    )
    labels = LabelStore(tmp_path / "results", tmp_path / "labels.json")
    blades = BladeStore(tmp_path / "results", tmp_path / "blades.json")
    server = make_server("127.0.0.1", 0, clips, runner, labels, blades)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield Client(server.server_address[1])
    server.shutdown()
    server.server_close()
    thread.join()


def test_server_listens_on_loopback_by_default(client: Client) -> None:
    assert client.call("GET", "/").status == 200


@pytest.mark.parametrize(
    ("path", "kind"),
    [
        ("/", "text/html"),
        ("/app.mjs", "text/javascript"),
        ("/logic.mjs", "text/javascript"),
        ("/style.css", "text/css"),
    ],
)
def test_page_files_are_served(client: Client, path: str, kind: str) -> None:
    reply = client.call("GET", path)
    assert reply.status == 200
    assert reply.headers["Content-Type"].startswith(kind)


@pytest.mark.parametrize("path", ["/panel.mjs", "/model.mjs", "/vendor/three.module.min.js"])
def test_new_page_files_are_served(client: Client, path: str) -> None:
    assert client.call("GET", path).status == 200


def test_only_listed_files_are_served(client: Client) -> None:
    assert client.call("GET", "/server.py").status == 404
    assert client.call("GET", "/../jobs.py").status == 404


def test_clips_and_boat_classes_are_listed(client: Client) -> None:
    reply = client.call("GET", "/api/clips").json()
    assert reply["clips"] == [CLIP]
    assert reply["boats"]["8+"] == 8


def test_clip_details_and_frames(client: Client) -> None:
    base = f"/api/clips/{quote(CLIP)}"
    assert client.call("GET", base).json()["frames"] == 12
    frame = client.call("GET", f"{base}/frames/3.jpg")
    assert frame.status == 200
    assert frame.headers["Content-Type"] == "image/jpeg"
    assert frame.body.startswith(b"\xff\xd8")


@pytest.mark.parametrize(
    "path",
    [
        "/api/clips/missing.avi",
        "/api/clips/..%2F..%2Fetc%2Fpasswd",
        f"/api/clips/{quote(CLIP)}/frames/999.jpg",
        f"/api/clips/{quote(CLIP)}/frames/abc.jpg",
        f"/api/clips/{quote(CLIP)}/other",
        "/api/nothing",
    ],
)
def test_bad_paths_are_not_found(client: Client, path: str) -> None:
    assert client.call("GET", path).status == 404


def test_other_hostnames_are_refused(client: Client) -> None:
    assert client.call("GET", "/api/clips", headers={"Host": "evil.example"}).status == 403
    reply = client.call(
        "POST",
        "/api/job/cancel",
        b"{}",
        {"Host": "evil.example", "Content-Type": "application/json"},
    )
    assert reply.status == 403


def test_localhost_name_is_allowed(client: Client) -> None:
    headers = {"Host": f"localhost:{client.port}"}
    assert client.call("GET", "/api/clips", headers=headers).status == 200


def test_form_posts_are_refused(client: Client) -> None:
    reply = client.call(
        "POST", "/api/job", b"clip=a", {"Content-Type": "application/x-www-form-urlencoded"}
    )
    assert reply.status == 400


@pytest.mark.parametrize("body", [b"not json", b"[1]"])
def test_bad_json_is_refused(client: Client, body: bytes) -> None:
    headers = {"Content-Type": "application/json"}
    assert client.call("POST", "/api/job", body, headers).status == 400


def test_bad_settings_return_a_message(client: Client) -> None:
    reply = client.post("/api/job", {"clip": CLIP, "boat_class": "4x"})
    assert reply.status == 400
    assert "Boats" in reply.json()["error"]


def test_boat_tap_needs_a_waiting_job_and_coordinates(client: Client) -> None:
    assert client.post("/api/job/boat", {}).status == 400
    reply = client.post("/api/job/boat", {"x": 1, "y": 2})
    assert reply.status == 400
    assert "waiting" in reply.json()["error"]


def test_unknown_post_is_not_found(client: Client) -> None:
    assert client.post("/api/nothing", {}).status == 404


def test_a_job_runs_from_start_to_result(client: Client) -> None:
    settings = {"clip": CLIP, "boat_class": "4x", "boats_in_video": 1, "seat": 2, "side": "scull"}
    assert client.post("/api/job", settings).status == 200
    for _ in range(3000):
        status = client.call("GET", "/api/job").json()
        if status["state"] != "running":
            break
    assert status["state"] == "done"
    assert status["result"]["rower"]["seat"] == 2

    saved = client.call("GET", "/api/results").json()["results"]
    assert [item["settings"]["clip"] for item in saved] == [CLIP]
    assert saved[0]["band"] == status["result"]["rower"]["rating"]["band"]
    reopened = client.call("GET", f"/api/results/{quote(saved[0]['name'])}").json()
    assert reopened["rower"]["card"] == status["result"]["rower"]["card"]


def test_cancel_with_no_job_is_harmless(client: Client) -> None:
    assert client.post("/api/job/cancel", {}).json() == {"state": "idle"}


@pytest.mark.parametrize(("style", "oars"), [("scull", 2), ("stroke", 1), ("bow", 1)])
def test_each_rowing_side_has_its_own_model(client: Client, style: str, oars: int) -> None:
    reply = client.call("GET", f"/api/reference?lean=28&knee=52&reach=0.58&style={style}")
    assert reply.status == 200
    pose = json.loads(reply.body)
    assert pose["style"] == style
    assert len(pose["oars"]) == oars
    assert {"heel", "toe", "knee", "hip", "shoulder", "elbow", "hand"} <= set(pose["left"])


@pytest.mark.parametrize(
    "query",
    [
        "",
        "lean=28",
        "lean=x&knee=50&reach=0.5&style=scull",
        "lean=28&knee=5&reach=0.5&style=scull",
        "lean=28&knee=50&reach=0.5&style=port",
    ],
)
def test_bad_reference_requests_are_refused(client: Client, query: str) -> None:
    assert client.call("GET", f"/api/reference?{query}").status == 400


def test_page_is_told_which_sides_each_boat_allows(client: Client) -> None:
    data = client.call("GET", "/api/clips").json()
    assert data["sides"]["1x"] == ["scull"]
    assert data["sides"]["8+"] == ["stroke", "bow"]
    assert data["side_names"]["bow"] == "Bow side"


def test_saved_results_start_empty(client: Client) -> None:
    reply = client.call("GET", "/api/results")
    assert reply.status == 200
    assert json.loads(reply.body) == {"results": []}


@pytest.mark.parametrize("name", ["missing.json", "..%2F..%2Fetc%2Fpasswd"])
def test_only_saved_results_can_be_read(client: Client, name: str) -> None:
    assert client.call("GET", f"/api/results/{name}").status == 404


def test_labelling_page_is_served(client: Client) -> None:
    assert client.call("GET", "/label").status == 200
    assert client.call("GET", "/label.mjs").status == 200


def test_labelling_with_no_analysed_clips_says_so(client: Client) -> None:
    assert client.call("GET", "/api/labels/next").json() == {"item": None}
    assert client.call("GET", "/api/labels/summary").json()["available"] == 0


def test_a_label_for_an_unknown_frame_is_refused(client: Client) -> None:
    joints = dict.fromkeys(["shoulder", "elbow", "wrist", "hip", "knee", "ankle"])
    assert client.post("/api/labels", {"id": "nope", "joints": joints}).status == 400


def test_undo_with_no_labels_is_harmless(client: Client) -> None:
    assert client.post("/api/labels/undo", {}).json() == {"undone": None}


def upload(client: Client, name: str, body: bytes, kind: str = "application/octet-stream") -> Reply:
    return client.call("POST", f"/api/clips?name={quote(name)}", body, {"Content-Type": kind})


@pytest.fixture
def video_bytes(tmp_path: Path) -> bytes:
    path = tmp_path / "source.avi"
    write_video(path, frames=5)
    return path.read_bytes()


def test_an_added_video_can_be_opened(client: Client, video_bytes: bytes) -> None:
    reply = upload(client, "launch one.avi", video_bytes)
    assert reply.status == 200
    assert reply.json() == {"clip": "launch one.avi"}
    assert "launch one.avi" in client.call("GET", "/api/clips").json()["clips"]
    assert client.call("GET", f"/api/clips/{quote('launch one.avi')}").json()["frames"] == 5


def test_a_file_that_is_not_a_video_is_refused(client: Client, tmp_path: Path) -> None:
    reply = upload(client, "fake.avi", b"not a video at all")
    assert reply.status == 400
    assert "could not be read" in reply.json()["error"]
    assert list((tmp_path / "uploads").iterdir()) == []


def test_a_video_cannot_be_posted_by_a_plain_form(client: Client, video_bytes: bytes) -> None:
    kind = "application/x-www-form-urlencoded"
    assert upload(client, "a.avi", video_bytes, kind).status == 400


def test_an_upload_needs_a_name(client: Client, video_bytes: bytes) -> None:
    headers = {"Content-Type": "application/octet-stream"}
    assert client.call("POST", "/api/clips", video_bytes, headers).status == 400


def test_the_blade_page_is_served(client: Client) -> None:
    assert client.call("GET", "/blades").status == 200
    assert client.call("GET", "/blades.mjs").status == 200


def test_blade_labelling_starts_empty(client: Client) -> None:
    assert client.call("GET", "/api/blades/next").json() == {"item": None}
    assert client.call("GET", "/api/blades/summary").json()["labelled"] == 0


def test_a_blade_label_for_an_unknown_frame_is_refused(client: Client) -> None:
    reply = client.post("/api/blades", {"id": "nope", "blade": [1, 2], "state": "air"})
    assert reply.status == 400
