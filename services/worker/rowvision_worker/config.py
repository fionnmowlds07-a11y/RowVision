"""Settings, all from the environment, so the same image runs anywhere."""

import os
import socket
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    database_url: str
    supabase_url: str
    service_key: str
    app_url: str
    worker_id: str
    device: str
    engine: str
    smtp_host: str
    smtp_port: int
    mail_from: str

    @staticmethod
    def load() -> "Config":
        env = os.environ
        return Config(
            database_url=env["DATABASE_URL"],
            supabase_url=env["SUPABASE_URL"].rstrip("/"),
            service_key=env["SUPABASE_SERVICE_KEY"],
            app_url=env.get("APP_URL", "http://127.0.0.1:3100").rstrip("/"),
            worker_id=env.get("WORKER_ID", socket.gethostname()),
            device=env.get("ROWVISION_DEVICE", "cpu"),
            engine=env.get("ROWVISION_ENGINE", "real"),
            smtp_host=env.get("SMTP_HOST", "127.0.0.1"),
            smtp_port=int(env.get("SMTP_PORT", "54425")),
            mail_from=env.get("MAIL_FROM", "RowVision <hello@rowvision.invalid>"),
        )
