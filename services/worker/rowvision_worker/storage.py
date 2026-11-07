"""Move files in and out of Supabase Storage."""

from pathlib import Path

import httpx

TIMEOUT = httpx.Timeout(30, read=600, write=600)
CHUNK_BYTES = 1024 * 1024


class Storage:
    def __init__(self, url: str, key: str, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(
            base_url=f"{url}/storage/v1",
            headers={"Authorization": f"Bearer {key}", "apikey": key},
            timeout=TIMEOUT,
            transport=transport,
        )

    def download(self, bucket: str, name: str, target: Path) -> None:
        with self._client.stream("GET", f"/object/{bucket}/{name}") as response:
            response.raise_for_status()
            with target.open("wb") as file:
                for chunk in response.iter_bytes(CHUNK_BYTES):
                    file.write(chunk)

    def upload(self, bucket: str, name: str, source: Path, content_type: str) -> None:
        with source.open("rb") as file:
            response = self._client.post(
                f"/object/{bucket}/{name}",
                content=file,
                headers={"Content-Type": content_type, "x-upsert": "true"},
            )
        response.raise_for_status()

    def delete(self, bucket: str, name: str) -> None:
        self._client.delete(f"/object/{bucket}/{name}").raise_for_status()
