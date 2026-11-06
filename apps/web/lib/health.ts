export type Check = { name: string; path: string };

export const DEEP_CHECKS: Check[] = [
  { name: "database", path: "/rest/v1/" },
  { name: "auth", path: "/auth/v1/health" },
  { name: "storage", path: "/storage/v1/version" },
];

export type Health = { status: "ok" | "failing"; checks?: Record<string, boolean> };

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

async function passes(fetcher: Fetcher, url: string, key: string): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Ask each backing service if it is up. Nothing about the failure reaches the caller. */
export async function deepHealth(baseUrl: string, key: string, fetcher: Fetcher = fetch): Promise<Health> {
  const results = await Promise.all(
    DEEP_CHECKS.map(async ({ name, path }) => [name, await passes(fetcher, baseUrl + path, key)] as const),
  );
  const checks = Object.fromEntries(results);
  return { status: results.every(([, ok]) => ok) ? "ok" : "failing", checks };
}
