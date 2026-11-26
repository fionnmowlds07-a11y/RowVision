/** A small file on the download server that names the newest version. Reading it sends nothing about the user. */
export const LATEST_URL = "https://downloads.rowvision.app/latest.json";
export const DOWNLOAD_PAGE = "https://rowvision.app/download";

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** True when `candidate` is a later version than `current`. Anything that isn't x.y.z is never newer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = VERSION.exec(candidate);
  const b = VERSION.exec(current);
  if (!a || !b) return false;
  for (let part = 1; part <= 3; part += 1) {
    const diff = Number(a[part]) - Number(b[part]);
    if (diff) return diff > 0;
  }
  return false;
}

/** The version named in latest.json, or null when the file is not what we expect. */
export function cleanLatest(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { version } = value as Record<string, unknown>;
  return typeof version === "string" && VERSION.test(version) ? version : null;
}

/** The newer version on the server, or null when there is none, or the check failed or took too long. */
export async function findUpdate(current: string, url: string, fetcher: typeof fetch = fetch, timeoutMs = 10_000): Promise<string | null> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!response.ok) return null;
    const latest = cleanLatest(await response.json());
    return latest && isNewer(latest, current) ? latest : null;
  } catch {
    return null;
  }
}
