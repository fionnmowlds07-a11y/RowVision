import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { CATCHES, FPS, FRAMES, OLD_CODEC, frameOf, makeClip, makeVideo } from "./fixture";

const appDir = path.resolve(__dirname, "../..");
const electronPath = createRequire(__filename)("electron") as unknown as string;

let data: string;
let sources: string;
let app: ElectronApplication;
let page: Page;
const problems: string[] = [];

test.beforeAll(async () => {
  data = mkdtempSync(path.join(tmpdir(), "rowvision-app-"));
  makeClip(path.join(data, "clips"));
  // Videos to add, kept outside the library as a user's would be.
  sources = path.join(data, "videos");
  mkdirSync(sources);
  makeVideo(path.join(sources, "row.mp4"), { frames: 6 * FPS });
  makeVideo(path.join(sources, "old camera.avi"), { frames: 6 * FPS, codec: OLD_CODEC });
  makeVideo(path.join(sources, "short.mp4"));
  writeFileSync(path.join(sources, "notes.txt"), "not a video");
  app = await electron.launch({
    executablePath: electronPath,
    // CI machines have no graphics card, so the 3D model needs Chromium's software graphics.
    args: [appDir, "--enable-unsafe-swiftshader"],
    env: { ...process.env, ROWVISION_DATA_DIR: data },
  });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
});

test.afterAll(async () => {
  // A refused navigation can leave close() waiting, so stop the app outright if it does not close.
  const closed = app ? Promise.race([app.close().then(() => true), new Promise((done) => setTimeout(() => done(false), 10_000))]) : true;
  if (!(await closed)) app.process().kill("SIGKILL");
  rmSync(data, { recursive: true, force: true });
});

async function shownFrame() {
  const text = await page.getByRole("region", { name: "Frame viewer" }).locator("p[aria-live]").innerText();
  return Number(/frame (\d+)/i.exec(text)?.[1]);
}

/** Which frame the video element is really holding, read from its pixels. */
async function pictureFrame() {
  const rgb = await page.evaluate(() => {
    const video = document.querySelector("video")!;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const paint = canvas.getContext("2d")!;
    paint.drawImage(video, 0, 0);
    return Array.from(paint.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data);
  });
  return frameOf(rgb);
}

async function expectFrame(frame: number) {
  await expect.poll(shownFrame, { timeout: 5_000 }).toBe(frame);
  await expect.poll(pictureFrame, { timeout: 5_000 }).toBe(frame);
}

test("the page has no Node access and only the narrow bridge", async () => {
  const facts = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    bridge: Object.keys(window.rowvision).sort(),
    origin: location.origin,
  }));
  expect(facts).toEqual({ require: "undefined", process: "undefined", bridge: ["addClip", "getClip", "getColours", "getSetup", "listClips", "pathForFile", "setColours"], origin: "app://rowvision" });
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // Not in Electron's types, but it reports the settings the page really runs with.
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null };
    const prefs = contents.getLastWebPreferences();
    return { contextIsolation: prefs?.contextIsolation, nodeIntegration: prefs?.nodeIntegration, sandbox: prefs?.sandbox };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
});

test("the library lists the clip from its folder", async () => {
  await expect(page.getByRole("heading", { name: "Your clips" })).toBeVisible();
  await expect(page.getByRole("link", { name: /2- seat 2/ })).toBeVisible();
  await expect(page.getByText(/1 clip, using/)).toBeVisible();
});

test("the viewer shows exactly the frame it says, stepping either way", async () => {
  await page.getByRole("link", { name: /2- seat 2/ }).click();
  const viewer = page.getByRole("region", { name: "Frame viewer" });
  await expect(viewer).toBeVisible();
  await expectFrame(CATCHES[0]);

  const forward = viewer.getByRole("button", { name: "Forward 1", exact: true });
  const back = viewer.getByRole("button", { name: "Back 1", exact: true });
  for (const frame of [13, 14, 15]) {
    await forward.click();
    await expectFrame(frame);
  }
  await viewer.getByRole("button", { name: "Forward 10" }).click();
  await expectFrame(25);
  // Across a keyframe and back again, which needs decoding from the keyframe before.
  await viewer.getByRole("button", { name: "Forward 10" }).click();
  await expectFrame(35);
  for (const frame of [34, 33, 32, 31, 30, 29, 28]) {
    await back.click();
    await expectFrame(frame);
  }
  await viewer.getByRole("button", { name: "Next catch" }).click();
  await expectFrame(CATCHES[1]);
  await viewer.getByRole("button", { name: "Last catch" }).click();
  await expectFrame(CATCHES[0]);
  await viewer.getByRole("slider", { name: "Move through the video" }).fill(String(FRAMES - 1));
  await expectFrame(FRAMES - 1);
  await viewer.getByRole("slider", { name: "Move through the video" }).fill("0");
  await expectFrame(0);
});

test("the 3D model opens", async () => {
  await page.getByRole("button", { name: "See the 3D model" }).click();
  const dialog = page.getByRole("dialog", { name: "Body angle at the catch" });
  await expect(dialog.locator("canvas")).toBeVisible();
  await expect(dialog.getByText("could not open")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("colours are saved on this computer", async () => {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Forest" }).click();
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect.poll(() => {
    try {
      return JSON.parse(readFileSync(path.join(data, "settings.json"), "utf8")).colours;
    } catch {
      return null;
    }
  }).toEqual({ ground: "#0a3d27", highlight: "#4be38a" });
  await page.reload();
  const ground = await page.locator("main").evaluate((element) => getComputedStyle(element.parentElement!).getPropertyValue("--ground").trim());
  expect(ground).toBe("#0a3d27");
});

function readJson(file: string) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function openAdd() {
  await page.getByRole("link", { name: "Clips" }).click();
  await page.getByRole("link", { name: "Add a video" }).click();
  await expect(page.getByRole("heading", { name: "Add a video" })).toBeVisible();
}

async function addedClip() {
  await expect(page).toHaveURL(/#\/clip\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: "Not analysed yet" })).toBeVisible();
  const id = /#\/clip\/([a-z0-9-]+)$/.exec(page.url())![1];
  return readJson(path.join(data, "clips", id, "clip.json"));
}

test("a video is picked, trimmed, tapped and added without copying it", async () => {
  await openAdd();
  const video = path.join(sources, "row.mp4");
  await page.locator("input[type=file]").setInputFiles(video);
  await expect(page.getByRole("group", { name: "Trim your clip" })).toBeVisible();
  await expect(page.getByText("6 of up to 60 seconds")).toBeVisible();
  // The test video is small, like a copy sent over WhatsApp.
  await expect(page.getByText("compressed copy")).toBeVisible();
  const [boat, side, seat] = [0, 1, 2].map((n) => page.getByRole("region", { name: "Your boat" }).locator("select").nth(n));
  await boat.selectOption("2-");
  await side.selectOption("bow");
  await seat.selectOption("2");
  await page.getByLabel("Note, if you like").fill("Saturday steady state");
  await page.getByRole("button", { name: "Tap yourself on this frame" }).click({ position: { x: 40, y: 30 } });
  await expect(page.getByText("Got you")).toBeVisible();
  await page.getByRole("button", { name: "Add to your clips" }).click();

  const clip = await addedClip();
  expect(clip).toMatchObject({ source: video, boat_class: "2-", side: "bow", seat: 2, note: "Saturday steady state", section_start: 0, section_length: 6 });
  expect(clip.tap.x).toBeGreaterThan(0);
  expect(clip.tap.x).toBeLessThan(0.5);
  expect(clip.tap.y).toBeLessThan(0.5);
  expect(readJson(path.join(data, "settings.json")).setup).toEqual({ boat: "2-", side: "bow", seat: 2 });
  // The last boat is offered next time.
  await openAdd();
  await page.locator("input[type=file]").setInputFiles(video);
  await expect(page.getByRole("region", { name: "Your boat" }).locator("select").first()).toHaveValue("2-");
});

test("a video the page cannot play can still be added", async () => {
  await openAdd();
  const video = path.join(sources, "old camera.avi");
  await page.locator("input[type=file]").setInputFiles(video);
  await expect(page.getByText("can't be shown here, but it can still be analysed")).toBeVisible();
  await expect(page.getByRole("group", { name: "Trim your clip" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add to your clips" }).click();
  const clip = await addedClip();
  expect(clip).toMatchObject({ source: video, section_start: 0, section_length: null, tap: null });
});

test("files that are not videos, or too short, are refused", async () => {
  await openAdd();
  await page.locator("input[type=file]").setInputFiles(path.join(sources, "notes.txt"));
  await expect(page.getByRole("alert")).toHaveText(/isn't a video/);
  await page.locator("input[type=file]").setInputFiles(path.join(sources, "short.mp4"));
  await expect(page.getByRole("alert")).toHaveText(/too short/);
  await expect(page.getByRole("button", { name: "Add to your clips" })).toHaveCount(0);
});

test("a dropped video is taken by the page, not opened", async () => {
  await openAdd();
  // A file made inside the page has no place on disk, so it is refused rather than read.
  await page.evaluate(() => {
    const drop = new DataTransfer();
    drop.items.add(new File(["x"], "made-up.mp4", { type: "video/mp4" }));
    window.dispatchEvent(new DragEvent("dragover", { dataTransfer: drop, cancelable: true }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, cancelable: true }));
  });
  await expect(page.getByRole("alert")).toHaveText(/can't be read/);
  expect(page.url()).toMatch(/^app:\/\/rowvision\/index.html#\/add$/);
});

// Before the tests that try forbidden things on purpose.
test("the page broke none of its rules while in use", () => {
  expect(problems).toEqual([]);
});

test("only the clip's video and frame data can be loaded", async () => {
  const results = await page.evaluate(async () => {
    const tryLoad = async (url: string) => {
      try {
        const response = await fetch(url);
        return response.ok ? "loaded" : `status ${response.status}`;
      } catch {
        return "blocked";
      }
    };
    return {
      frames: await tryLoad("rowvision://clip/test-clip/frames.json"),
      summary: await tryLoad("rowvision://clip/test-clip/summary.json"),
      settings: await tryLoad("rowvision://clip/test-clip/../../settings.json"),
      escape: await tryLoad("rowvision://clip/%2e%2e/settings.json"),
      remote: await tryLoad("https://example.com/"),
      file: await tryLoad("file:///etc/hostname"),
    };
  });
  expect(results.frames).toBe("loaded");
  for (const name of ["summary", "settings", "escape", "remote", "file"] as const) expect(results[name], name).not.toBe("loaded");
});

// Last, as a refused navigation leaves Playwright waiting on it.
test("the app cannot be sent to another site or open windows", async () => {
  // Stand in for the user's browser, so the test never opens a real one.
  await app.evaluate(({ shell }) => {
    const handedOver: string[] = [];
    (globalThis as { handedOver?: string[] }).handedOver = handedOver;
    shell.openExternal = async (url: string) => { handedOver.push(url); };
  });
  const opened = await page.evaluate(() => [window.open("https://example.com/") === null, window.open("http://example.com/") === null]);
  expect(opened).toEqual([true, true]);
  // Only the https link goes to the user's browser. Nothing opens inside the app.
  await expect.poll(() => app.evaluate(() => (globalThis as { handedOver?: string[] }).handedOver)).toEqual(["https://example.com/"]);
  await page.evaluate(() => { window.location.href = "https://example.com/"; });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^app:\/\/rowvision\//);
  expect(app.windows()).toHaveLength(1);
});
