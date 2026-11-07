import { describe, expect, test } from "vitest";
import { isWaiting, minutesLeft, placeText, publicLink, waitText } from "@/lib/waiting";

describe("waiting", () => {
  test("a job that needs the athlete is not just waiting", () => {
    expect(isWaiting("queued")).toBe(true);
    expect(isWaiting("needs_tap")).toBe(false);
    expect(isWaiting("done")).toBe(false);
  });
  test("a 32 second clip is about 8 minutes", () => {
    expect(minutesLeft(1, 32, 0)).toBe(8);
  });
  test("clips ahead add to the wait", () => {
    expect(minutesLeft(3, 32, 0)).toBe(28);
  });
  test("progress shortens the wait, but never to nothing", () => {
    expect(minutesLeft(null, 32, 0.5)).toBe(4);
    expect(minutesLeft(null, 32, 1)).toBe(1);
  });
  test("unknown length uses a typical clip", () => {
    expect(minutesLeft(null, null, null)).toBe(12);
  });
  test("the words read naturally", () => {
    expect(waitText(1)).toBe("About a minute");
    expect(waitText(8)).toBe("About 8 minutes");
    expect(placeText(2)).toBe("Second in the queue");
    expect(placeText(12)).toBe("Number 12 in the queue");
    expect(placeText(null)).toBe("In the queue");
  });
  test("signed links use the public address", () => {
    expect(publicLink("http://inner:1/x", "http://inner:1", "https://app")).toBe("https://app/x");
    expect(publicLink("http://inner:1/x", "http://inner:1", undefined)).toBe("http://inner:1/x");
  });
});
