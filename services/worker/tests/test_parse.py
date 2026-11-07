from rowvision_worker.db import parse_job


def row(**values: object) -> dict[str, object]:
    base = {
        "id": "j", "clip_id": "c", "user_id": "u", "email": "a@example.com", "attempts": 1,
        "source_path": "s", "working_path": None, "section_start_seconds": "8", "section_length_seconds": "20", "boat_class": "8+",
        "side": "bow", "seat": 3, "tap": {"t": 1, "x": 0.5, "y": 0.25}, "fps": None, "frames": None,
        "width": None, "height": None,
    }  # fmt: skip
    return {**base, **values}


def test_a_job_reads_its_tap() -> None:
    job = parse_job(row())
    assert job.section_start == 8
    assert job.section_length == 20
    assert job.setup.tap is not None and job.setup.tap.y == 0.25


def test_a_job_can_have_no_tap() -> None:
    assert parse_job(row(tap=None)).setup.tap is None
