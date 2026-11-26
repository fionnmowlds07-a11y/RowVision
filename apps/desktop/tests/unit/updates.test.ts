import { expect, test } from "vitest";
import { cleanLatest, findUpdate, isNewer } from "../../src/main/updates";

test("only a later x.y.z version is newer", () => {
  expect(isNewer("0.3.1", "0.3.0")).toBe(true);
  expect(isNewer("0.10.0", "0.9.9")).toBe(true);
  expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  expect(isNewer("0.3.0", "0.3.0")).toBe(false);
  expect(isNewer("0.2.9", "0.3.0")).toBe(false);
  expect(isNewer("0.4.0-beta", "0.3.0")).toBe(false);
  expect(isNewer("", "0.3.0")).toBe(false);
});

test("latest.json must name a plain version", () => {
  expect(cleanLatest({ version: "0.4.0" })).toBe("0.4.0");
  expect(cleanLatest({ version: "<b>" })).toBeNull();
  expect(cleanLatest({ version: 4 })).toBeNull();
  expect(cleanLatest(null)).toBeNull();
});

const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

test("a newer version on the server is found, and anything else is quietly nothing", async () => {
  expect(await findUpdate("0.3.0", "https://x", answer({ version: "0.4.0" }))).toBe("0.4.0");
  expect(await findUpdate("0.3.0", "https://x", answer({ version: "0.3.0" }))).toBeNull();
  expect(await findUpdate("0.3.0", "https://x", answer({ version: "0.4.0" }, false))).toBeNull();
  expect(await findUpdate("0.3.0", "https://x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  const never = ((_: string, init: RequestInit) => new Promise((_, fail) => init.signal?.addEventListener("abort", () => fail(new Error("timed out"))))) as unknown as typeof fetch;
  expect(await findUpdate("0.3.0", "https://x", never, 20)).toBeNull();
});
