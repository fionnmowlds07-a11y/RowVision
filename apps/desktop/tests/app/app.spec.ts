import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { CATCHES, FRAMES, frameOf, makeClip } from "./fixture";

const appDir = path.resolve(__dirname, "../..");
const electronPath = createRequire(__filename)("electron") as unknown as string;

let data: string;
let app: ElectronApplication;
let page: Page;
const problems: string[] = [];

test.beforeAll(async () => {
  data = mkdtempSync(path.join(tmpdir(), "rowvision-app-"));
  makeClip(path.join(data, "clips"));
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
  if (!(await closed)) app.process().kill();
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
  expect(facts).toEqual({ require: "undefined", process: "undefined", bridge: ["getClip", "getColours", "listClips", "setColours"], origin: "app://rowvision" });
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
  const opened = await page.evaluate(() => window.open("https://example.com/") === null);
  expect(opened).toBe(true);
  await page.evaluate(() => { window.location.href = "https://example.com/"; });
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/^app:\/\/rowvision\//);
  expect(app.windows()).toHaveLength(1);
});
