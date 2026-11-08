import path from "node:path";
import { describe, expect, test } from "vitest";
import { clipFile, contentType, pageFile } from "../../src/main/paths";

const library = path.resolve("/data/clips");
const page = path.resolve("/app/renderer");

describe("clip files", () => {
  test("the video and frame data of a clip are served", () => {
    expect(clipFile(library, "rowvision://clip/abc-123/working.mp4")).toBe(path.join(library, "abc-123", "working.mp4"));
    expect(clipFile(library, "rowvision://clip/abc-123/frames.json")).toBe(path.join(library, "abc-123", "frames.json"));
  });

  test.each([
    "rowvision://clip/abc/summary.json",
    "rowvision://clip/abc/clip.json",
    "rowvision://clip/../settings.json",
    "rowvision://clip/abc/../../settings.json",
    "rowvision://clip/%2e%2e/working.mp4",
    "rowvision://clip/abc%2f..%2fdef/working.mp4",
    "rowvision://clip/ABC/working.mp4",
    "rowvision://clip/abc/sub/working.mp4",
    "rowvision://clip//working.mp4",
    "rowvision://other/abc/working.mp4",
    "rowvision://clip/abc/working.mp4?x=1",
    "app://rowvision/abc/working.mp4",
    "file:///data/clips/abc/working.mp4",
    "not a url",
  ])("%s is refused", (url) => {
    expect(clipFile(library, url)).toBeNull();
  });
});

describe("page files", () => {
  test("the built page is served", () => {
    expect(pageFile(page, "app://rowvision/index.html")).toBe(path.join(page, "index.html"));
    expect(pageFile(page, "app://rowvision/")).toBe(path.join(page, "index.html"));
    expect(pageFile(page, "app://rowvision/assets/index-1.js")).toBe(path.join(page, "assets", "index-1.js"));
  });

  test.each(["app://rowvision/../main/main.js", "app://rowvision/%2e%2e/main/main.js"])("%s is folded back inside the page", (url) => {
    expect(pageFile(page, url)).toBe(path.join(page, "main", "main.js"));
  });

  test.each([
    "app://rowvision/assets/%2e%2e%2f%2e%2e%2fmain/main.js",
    "app://rowvision/a%5c..%5c..%5cmain.js",
    "app://rowvision/a%00.js",
    "app://other/index.html",
    "rowvision://rowvision/index.html",
  ])("%s is refused", (url) => {
    expect(pageFile(page, url)).toBeNull();
  });
});

test("types come from the file's ending", () => {
  expect(contentType("a/working.mp4")).toBe("video/mp4");
  expect(contentType("index.html")).toMatch(/^text\/html/);
  expect(contentType("thing.exe")).toBe("application/octet-stream");
});
