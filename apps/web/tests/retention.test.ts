import { expect, test } from "vitest";
import { daysLeft, deleteExpired } from "@/lib/retention";

function store(fail = false) {
  const log: string[] = [];
  return {
    log,
    expired: async () => [{ clip: "c", working: "w.mp4", frames: ["f.json"] }],
    remove: async (bucket: string, paths: string[]) => {
      if (fail) throw new Error("storage down");
      log.push(`${bucket}:${paths.join()}`);
    },
    mark: async (clip: string) => { log.push(`mark:${clip}`); },
  };
}

test("video and joint positions both go, then the clip is marked", async () => {
  const fake = store();
  expect(await deleteExpired(fake)).toBe(1);
  expect(fake.log).toEqual(["working:w.mp4", "frames:f.json", "mark:c"]);
});

test("a failed delete leaves the clip to try again", async () => {
  const fake = store(true);
  await expect(deleteExpired(fake)).rejects.toThrow();
  expect(fake.log).toEqual([]);
});

test("days left round up and stop at zero", () => {
  const now = new Date("2026-11-01T00:00:00Z").getTime();
  expect(daysLeft("2026-11-03T12:00:00Z", now)).toBe(3);
  expect(daysLeft("2026-10-01T00:00:00Z", now)).toBe(0);
  expect(daysLeft(null, now)).toBeNull();
});
