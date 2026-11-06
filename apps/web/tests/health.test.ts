import { expect, test } from "vitest";
import { deepHealth } from "@/lib/health";

test("all services up reports ok", async () => {
  const health = await deepHealth("http://x", "key", async () => ({ ok: true }));
  expect(health).toEqual({ status: "ok", checks: { database: true, auth: true, storage: true } });
});

test("one service down fails and names it", async () => {
  const fetcher = async (url: string) => ({ ok: !url.includes("/storage/") });
  const health = await deepHealth("http://x", "key", fetcher);
  expect(health.status).toBe("failing");
  expect(health.checks).toEqual({ database: true, auth: true, storage: false });
});

test("a network error counts as down", async () => {
  const health = await deepHealth("http://x", "key", async () => {
    throw new Error("refused");
  });
  expect(health.status).toBe("failing");
});
