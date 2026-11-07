"""Run the worker. It only ever connects outward, so it needs no open ports."""

import logging
import time
from functools import partial

from rowvision.version import code_version

from rowvision_worker import mail
from rowvision_worker.config import Config
from rowvision_worker.db import Database, Job
from rowvision_worker.engine import make_engine
from rowvision_worker.storage import Storage
from rowvision_worker.worker import run_job

IDLE_SECONDS = 5

log = logging.getLogger(__name__)


def notify(config: Config, job: Job, outcome: str) -> None:
    """A failed email must not lose a finished result."""
    link = f"{config.app_url}/clips/{job.clip_id}"
    build = mail.result_ready if outcome == "done" else mail.needs_tap
    try:
        mail.send(build(job.email, config.mail_from, link), config.smtp_host, config.smtp_port)
    except OSError:
        log.exception("could not email about job %s", job.id)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    config = Config.load()
    database = Database(config.database_url)
    files = Storage(config.supabase_url, config.service_key)
    engine = make_engine(config.engine, config.device)
    log.info("worker %s ready on %s", config.worker_id, config.device)
    while True:
        database.heartbeat(config.worker_id, code_version(), config.device)
        database.release_expired()
        job = database.next_job(config.worker_id)
        if job is None:
            time.sleep(IDLE_SECONDS)
            continue
        log.info("starting job %s", job.id)
        run_job(job, database, files, engine, partial(notify, config))


if __name__ == "__main__":
    main()
