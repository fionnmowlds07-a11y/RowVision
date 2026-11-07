"""The worker's view of the queue."""

import json
from dataclasses import dataclass
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from rowvision_worker.engine import Setup, Tap
from rowvision_worker.media import SECTION_SECONDS, Facts

LEASE_SECONDS = 60
MAX_ATTEMPTS = 2


@dataclass(frozen=True)
class Job:
    id: str
    clip_id: str
    user_id: str
    email: str
    attempts: int
    source_path: str | None
    working_path: str | None
    section_start: float
    section_length: float
    setup: Setup
    fps: float | None
    frames: int | None
    width: int | None
    height: int | None


class Queue(Protocol):
    def next_job(self, worker: str) -> Job | None: ...
    def renew(self, job: Job, stage: str, progress: float | None) -> bool: ...
    def save_copy(self, job: Job, path: str, facts: Facts) -> None: ...
    def finish(
        self, job: Job, version: str, summary: dict[str, Any], frames_path: str | None,
        headline: tuple[float | None, str | None, float | None],
    ) -> None: ...  # fmt: skip
    def pause(self, job: Job, pause: dict[str, Any]) -> None: ...
    def cancelled(self, job: Job) -> None: ...
    def failed(self, job: Job, message: str) -> None: ...


def parse_job(row: dict[str, Any]) -> Job:
    tap = row["tap"]
    return Job(
        id=str(row["id"]),
        clip_id=str(row["clip_id"]),
        user_id=str(row["user_id"]),
        email=row["email"],
        attempts=row["attempts"],
        source_path=row["source_path"],
        working_path=row["working_path"],
        section_start=float(row["section_start_seconds"]),
        section_length=float(row.get("section_length_seconds") or SECTION_SECONDS),
        setup=Setup(
            row["boat_class"],
            row["side"],
            row["seat"],
            Tap(float(tap["t"]), float(tap["x"]), float(tap["y"])) if tap else None,
        ),
        fps=None if row["fps"] is None else float(row["fps"]),
        frames=row["frames"],
        width=row["width"],
        height=row["height"],
    )


class Database:
    def __init__(self, url: str) -> None:
        self._connection: psycopg.Connection[dict[str, Any]] = psycopg.connect(
            url, autocommit=True, row_factory=dict_row
        )

    def _one(self, sql: str, *values: Any) -> dict[str, Any] | None:
        return self._connection.execute(sql, values).fetchone()

    def heartbeat(self, worker: str, version: str, device: str) -> None:
        self._connection.execute(
            """insert into public.worker_status (worker_id, version, device, last_seen)
               values (%s, %s, %s, now())
               on conflict (worker_id) do update
               set version = excluded.version, device = excluded.device, last_seen = now()""",
            (worker, version, device),
        )

    def release_expired(self) -> None:
        self._connection.execute("select public.release_expired_jobs(%s)", (MAX_ATTEMPTS,))

    def next_job(self, worker: str) -> Job | None:
        claimed = self._one("select public.claim_job(%s, %s) as id", worker, LEASE_SECONDS)
        if claimed is None or claimed["id"] is None:
            return None
        row = self._one(
            """select j.id, j.clip_id, j.user_id, j.attempts, u.email, c.source_path, c.working_path,
                      c.section_start_seconds, c.section_length_seconds, c.boat_class, c.side, c.seat,
                      c.tap, c.fps, c.frames, c.width, c.height
               from public.jobs j
               join public.clips c on c.id = j.clip_id
               join auth.users u on u.id = j.user_id
               where j.id = %s""",
            claimed["id"],
        )
        assert row is not None
        return parse_job(row)

    def renew(self, job: Job, stage: str, progress: float | None) -> bool:
        """Keep the lease, report progress, and return whether the athlete asked to stop."""
        row = self._one(
            """update public.jobs
               set locked_until = now() + make_interval(secs => %s), stage = %s, progress = %s
               where id = %s returning cancel_requested""",
            LEASE_SECONDS, stage, progress, job.id,
        )  # fmt: skip
        return bool(row and row["cancel_requested"])

    def save_copy(self, job: Job, path: str, facts: Facts) -> None:
        self._connection.execute(
            """update public.clips set working_path = %s, source_path = null, fps = %s, frames = %s,
                 width = %s, height = %s, duration_seconds = %s,
                 filmed_at = coalesce(%s, filmed_at), video_expires_at = now() + interval '30 days'
               where id = %s""",
            (path, float(facts.fps), facts.frames, facts.width, facts.height, facts.duration,
             facts.filmed_at, job.clip_id),
        )  # fmt: skip

    def finish(
        self, job: Job, version: str, summary: dict[str, Any], frames_path: str | None,
        headline: tuple[float | None, str | None, float | None],
    ) -> None:  # fmt: skip
        accuracy, band, overall = headline
        with self._connection.transaction():
            self._connection.execute(
                """insert into public.results
                     (clip_id, job_id, user_id, code_version, summary, accuracy, band, overall, frames_path)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (job.clip_id, job.id, job.user_id, version, json.dumps(summary), accuracy, band,
                 overall, frames_path),
            )  # fmt: skip
            self._end(job, "done")

    def pause(self, job: Job, pause: dict[str, Any]) -> None:
        self._connection.execute(
            """update public.jobs set state = 'needs_tap', pause = %s, locked_by = null,
               locked_until = null, progress = null where id = %s""",
            (json.dumps(pause), job.id),
        )

    def cancelled(self, job: Job) -> None:
        self._end(job, "cancelled")

    def failed(self, job: Job, message: str) -> None:
        if job.attempts < MAX_ATTEMPTS:
            self._connection.execute(
                """update public.jobs set state = 'queued', queued_at = now(), locked_by = null,
                   locked_until = null where id = %s""",
                (job.id,),
            )
            return
        self._end(job, "failed", message)

    def _end(self, job: Job, state: str, message: str | None = None) -> None:
        self._connection.execute(
            """update public.jobs set state = %s::public.job_state, error = %s, finished_at = now(),
               locked_by = null, locked_until = null, cancel_requested = false where id = %s""",
            (state, message, job.id),
        )


