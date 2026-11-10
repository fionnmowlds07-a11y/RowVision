import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { makeServer } from "../../../../services/intake/server.mjs";
import { CATCHES, FPS, FRAMES, OLD_CODEC, frameOf, makeClip, makeVideo } from "./fixture";

const appDir = path.resolve(__dirname, "../..");
const electronPath = createRequire(__filename)("electron") as unknown as string;

let data: string;
let sources: string;
let control: string;
let intake: Server;
let intakeUrl: string;
let app: ElectronApplication;
let page: Page;
const problems: string[] = [];

test.beforeAll(async () => {
  data = mkdtempSync(path.join(tmpdir(), "rowvision-app-"));
  makeClip(path.join(data, "clips"));
  // An analysed clip filmed months ago, whose video can be cleared out.
  const old = makeClip(path.join(data, "clips"), "old-clip");
  writeFileSync(path.join(old, "clip.json"), JSON.stringify({ created_at: "2026-05-02T09:00:00Z", filmed_at: "2026-05-01T09:00:00Z", boat_class: "1x", side: "scull", seat: 1 }));
  // Videos to add, kept outside the library as a user's would be.
  sources = path.join(data, "videos");
  mkdirSync(sources);
  makeVideo(path.join(sources, "row.mp4"), { frames: 6 * FPS });
  makeVideo(path.join(sources, "old camera.avi"), { frames: 6 * FPS, codec: OLD_CODEC });
  makeVideo(path.join(sources, "short.mp4"));
  writeFileSync(path.join(sources, "notes.txt"), "not a video");
  // The stand-in engine waits until a test tells it what to do.
  control = path.join(data, "engine-control");
  writeFileSync(control, "hang");
  // A local stand-in for the service that receives sent clips.
  intake = makeServer({ folder: path.join(data, "received"), adminToken: "owner" });
  await new Promise<void>((done) => intake.listen(0, "127.0.0.1", done));
  intakeUrl = `http://127.0.0.1:${(intake.address() as { port: number }).port}`;
  await launch();
});

async function launch() {
  app = await electron.launch({
    executablePath: electronPath,
    // CI machines have no graphics card, so the 3D model needs Chromium's software graphics.
    args: [appDir, "--enable-unsafe-swiftshader"],
    env: {
      ...process.env,
      ROWVISION_DATA_DIR: data,
      ROWVISION_ENGINE: JSON.stringify([process.env.NODE ?? "node", path.join(__dirname, "../fake-engine.mjs")]),
      ROWVISION_ENGINE_KIND: "fake",
      ROWVISION_TEST_NOTICES: "1",
      FAKE_ENGINE_CONTROL: control,
      ROWVISION_SEND_URL: intakeUrl,
    },
  });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
}

test.afterAll(async () => {
  // A refused navigation can leave close() waiting, so stop the app outright if it does not close.
  const closed = app ? Promise.race([app.close().then(() => true), new Promise((done) => setTimeout(() => done(false), 10_000))]) : true;
  if (!(await closed)) app.process().kill("SIGKILL");
  intake?.close();
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
  expect(facts).toEqual({ require: "undefined", process: "undefined", bridge: ["addClip", "canSend", "cancelModels", "changeClipsFolder", "deleteClip", "downloadModels", "finishWelcome", "getAnalysis", "getClip", "getColours", "getModels", "getSetup", "getSpace", "getTargets", "getWelcome", "listClips", "onAnalysis", "onModels", "onSendProgress", "pathForFile", "removeVideo", "sendClip", "setColours", "setTargets", "startClip", "stopClip", "tapAgain"], origin: "app://rowvision" });
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // Not in Electron's types, but it reports the settings the page really runs with.
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null };
    const prefs = contents.getLastWebPreferences();
    return { contextIsolation: prefs?.contextIsolation, nodeIntegration: prefs?.nodeIntegration, sandbox: prefs?.sandbox };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
});

test("the library lists the clips from their folders, newest first", async () => {
  await expect(page.getByRole("heading", { name: "Your clips" })).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("2- seat 2");
  await expect(rows.nth(1)).toContainText("84");
  await expect(rows.nth(1)).toContainText("Kept");
  await expect(rows.nth(2)).toContainText("1x seat 1");
  await expect(page.getByText("You have 2 so far")).toBeVisible();
  const space = page.getByRole("region", { name: "Space on this computer" });
  await expect(space).toContainText(/Videos \d/);
  await expect(space).toContainText(/free/);
});

test("the viewer shows exactly the frame it says, stepping either way", async () => {
  await page.getByRole("row", { name: /2- seat 2/ }).getByRole("link").click();
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

test("the results show what to work on, the measures and a freeze frame for each stroke", async () => {
  await page.evaluate(() => { window.location.hash = "#/clip/test-clip"; });
  await expect(page.getByRole("heading", { name: "Work on next" })).toBeVisible();
  const measures = page.getByRole("region", { name: "Measures" });
  await expect(measures).toContainText("Body angle at the catch");
  await expect(measures).toContainText("Knee at the catch");
  // Opening a measure shows a freeze frame for each stroke, and one jumps the viewer to that frame.
  await measures.getByRole("button", { name: /Body angle at the catch/ }).click();
  const freezes = page.getByRole("button", { name: /^Stroke \d+, go to frame \d+$/ });
  await expect(freezes.first()).toBeVisible();
  const count = await freezes.count();
  expect(count).toBeGreaterThanOrEqual(CATCHES.length);
  await freezes.nth(1).click();
  await expectFrame(CATCHES[1]);
  // Leave the clip page as the other tests found it.
  await page.evaluate(() => { window.location.hash = "#/"; });
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

test("targets: type a range, make a knee count, and it is kept on this computer", async () => {
  await page.getByRole("link", { name: "Settings" }).click();
  const card = page.getByTestId("targets-card");
  await expect(card).toContainText("General standard");
  // Only the body angles count at first.
  await expect(card.getByTestId("target-catch_knee_deg").getByRole("button", { name: "Add to score" })).toBeVisible();
  // A range wider than 5 degrees is refused and not saved.
  const top = card.getByRole("spinbutton", { name: "Top of the range for Body angle at the catch" });
  await top.fill("45");
  await expect(card.getByRole("alert")).toContainText("5°");
  expect(readJson(path.join(data, "settings.json"))?.targets?.catch_lean_deg ?? { low: 26, high: 31 }).toMatchObject({ low: 26, high: 31 });
  // A valid range typed in is saved.
  await card.getByRole("spinbutton", { name: "Bottom of the range for Body angle at the catch" }).fill("34");
  await top.fill("38");
  await card.getByTestId("target-catch_knee_deg").getByRole("button", { name: "Add to score" }).click();
  await expect.poll(() => readJson(path.join(data, "settings.json"))?.targets).toMatchObject({
    catch_lean_deg: { low: 34, high: 38, counts: true },
    catch_knee_deg: { counts: true },
  });
  await expect(card).toContainText("Your own setup");
  // The knee has moved to the group that counts.
  await expect(card.getByTestId("target-catch_knee_deg").getByRole("button", { name: "Stop counting" })).toBeVisible();
  // Back to the standard in one press.
  await card.getByRole("button", { name: "Reset everything to the general standard" }).click();
  await expect(card).toContainText("General standard");
  await expect.poll(() => readJson(path.join(data, "settings.json"))?.targets?.catch_lean_deg).toMatchObject({ low: 26, high: 31 });
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

const ids: Record<string, string> = {};

/** Adding a clip goes straight to its analysis screen. */
async function addedClip(name: string, heading: string) {
  await expect(page).toHaveURL(/#\/analysis\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  const id = /#\/analysis\/([a-z0-9-]+)$/.exec(page.url())![1];
  ids[name] = id;
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

  const clip = await addedClip("row", "Analysing your clip");
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
  const clip = await addedClip("old", "Waiting its turn");
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

const notices = () => app.evaluate(() => (globalThis as { rowvisionNotices?: { title: string; id: string }[] }).rowvisionNotices ?? []);
const panel = () => page.getByRole("region", { name: "Progress" });

async function openAnalysis(name: string) {
  await page.evaluate((id) => { window.location.hash = `#/analysis/${id}`; }, ids[name]);
}

test("analysis shows its stage and the clips waiting next", async () => {
  await openAnalysis("row");
  await expect(page.getByRole("heading", { name: "Analysing your clip" })).toBeVisible();
  await expect(panel().locator("[aria-current=step]")).toHaveText("Finding the boats and seats");
  await expect(page.getByRole("link", { name: /^Analysing \d+%$/ })).toBeVisible();
  await expect(panel().getByRole("heading", { name: "Waiting next" })).toBeVisible();
  await panel().getByRole("button", { name: /from the queue/ }).click();
  await expect(panel().getByRole("heading", { name: "Waiting next" })).toHaveCount(0);
  await openAnalysis("old");
  await expect(page.getByRole("heading", { name: "Stopped" })).toBeVisible();
});

test("a running clip can be cancelled and started again", async () => {
  await openAnalysis("row");
  await panel().getByRole("button", { name: "Cancel" }).click();
  await panel().getByRole("button", { name: "Keep going" }).click();
  await panel().getByRole("button", { name: "Cancel" }).click();
  await panel().getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stopped" })).toBeVisible();
  await panel().getByRole("button", { name: "Start again" }).click();
  await expect(page.getByRole("heading", { name: "Analysing your clip" })).toBeVisible();
});

test("if the engine dies, the clip says so and can be started again", async () => {
  const pidFile = path.join(data, "clips", ids.row, "engine.pid");
  // Once it is finding boats, the engine started again has written its process number.
  await expect(panel().locator("[aria-current=step]")).toHaveText("Finding the boats and seats");
  process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
  await expect(page.getByRole("heading", { name: "We couldn't analyse this clip" })).toBeVisible();
  await expect(panel().getByRole("alert")).toHaveText(/stopped unexpectedly/);
  await panel().getByRole("button", { name: "Start again" }).click();
  await expect(page.getByRole("heading", { name: "Analysing your clip" })).toBeVisible();
});

test("closing the app part way through starts the clip again next time", async () => {
  await app.close();
  await launch();
  await openAnalysis("row");
  await expect(page.getByRole("heading", { name: "Analysing your clip" })).toBeVisible();
});

test("a finished clip says so, with a notification and its results", async () => {
  await openAnalysis("row");
  writeFileSync(control, "done");
  await expect(page.getByRole("heading", { name: "Analysed" })).toBeVisible();
  await expect.poll(notices).toContainEqual(expect.objectContaining({ title: "Your clip is ready", id: ids.row }));
  await panel().getByRole("link", { name: "See your results" }).click();
  await expect(page.getByRole("heading", { name: "No scores for this clip" })).toBeVisible();
});

test("when it can't tell which rower is you, a click carries it on", async () => {
  writeFileSync(control, "tap");
  await openAdd();
  await page.locator("input[type=file]").setInputFiles(path.join(sources, "row.mp4"));
  await page.getByRole("button", { name: "Add to your clips" }).click();
  await addedClip("tap", "Click on yourself to carry on");
  await expect.poll(notices).toContainEqual(expect.objectContaining({ title: "Which one is you?", id: ids.tap }));
  const thisIsMe = panel().getByRole("button", { name: "This is me" });
  await expect(thisIsMe).toBeDisabled();
  await page.getByRole("button", { name: "Tap yourself on this frame" }).click({ position: { x: 60, y: 40 } });
  await thisIsMe.click();
  await expect(page.getByRole("heading", { name: "Analysed" })).toBeVisible();
  expect(readJson(path.join(data, "clips", ids.tap, "clip.json")).tap).toMatchObject({ t: 1 });
});

test("the library sorts by score and size", async () => {
  await page.getByRole("link", { name: "Clips" }).click();
  await page.getByRole("button", { name: "Size" }).click();
  await expect(page.getByRole("columnheader", { name: "Size" })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: "Overall" }).click();
  // The two scored clips come first, then the unscored ones.
  const scores = await page.getByRole("row").locator("td:nth-child(3)").allInnerTexts();
  expect(scores.slice(0, 2)).toEqual(["84", "84"]);
  expect(scores.slice(2).every((text) => text === "–")).toBe(true);
});

test("a video can be removed, keeping the scores", async () => {
  await page.evaluate((id) => { window.location.hash = `#/clip/${id}`; }, ids.row);
  await page.getByRole("button", { name: "Remove video, keep scores" }).click();
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  await expect(page.getByText("The video was removed, and the scores were kept.")).toBeVisible();
  expect(existsSync(path.join(data, "clips", ids.row, "working.mp4"))).toBe(false);
  expect(existsSync(path.join(data, "clips", ids.row, "summary.json"))).toBe(true);
  expect(existsSync(path.join(sources, "row.mp4"))).toBe(true);
});

test("a clip can be deleted, leaving the original video alone", async () => {
  await page.evaluate((id) => { window.location.hash = `#/clip/${id}`; }, ids.tap);
  await page.getByRole("button", { name: "Delete clip" }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await page.getByRole("button", { name: "Delete clip" }).click();
  await page.getByRole("button", { name: "Delete clip" }).click();
  await expect(page.getByRole("heading", { name: "Your clips" })).toBeVisible();
  expect(existsSync(path.join(data, "clips", ids.tap))).toBe(false);
  expect(existsSync(path.join(sources, "row.mp4"))).toBe(true);
});

test("videos over three months old can be cleared out in one go", async () => {
  const space = page.getByRole("region", { name: "Space on this computer" });
  await space.getByRole("button", { name: "Remove videos over 3 months old" }).click();
  await expect(space).toContainText("Remove 1 video over 3 months old?");
  await space.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("row", { name: /1x seat 1/ })).toContainText("Removed");
  await expect(space.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  expect(existsSync(path.join(data, "clips", "old-clip", "working.mp4"))).toBe(false);
});

test("the filming guide is in the app", async () => {
  await page.getByRole("link", { name: "Filming guide" }).click();
  await expect(page.getByRole("heading", { name: "How to film a good clip" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Film side-on" })).toBeVisible();
});

test("a clip is sent only after both ticks, then marked as sent", async () => {
  await page.evaluate(() => { window.location.hash = "#/clip/test-clip"; });
  await page.getByRole("button", { name: "Send this clip" }).click();
  const dialog = page.getByRole("dialog", { name: "Send this clip to help RowVision learn" });
  await expect(dialog).toContainText("The 3 seconds you analysed");
  const send = dialog.getByRole("button", { name: "Send clip" });
  await expect(send).toBeDisabled();
  await dialog.getByLabel("Anything wrong with the results? (optional)").fill("Catch marks look late");
  await dialog.getByLabel(/18 or over/).check();
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/happy for it to be used/).check();
  await send.click();
  await expect(page.getByRole("heading", { name: "Sent. Thank you" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Sent to RowVision")).toBeVisible();
  const list = await (await fetch(`${intakeUrl}/admin/sends`, { headers: { authorization: "Bearer owner" } })).json();
  expect(list.sends).toHaveLength(1);
  expect(list.sends[0]).toMatchObject({ note: "Catch marks look late", setup: { boat: "2-", seat: 2 }, consent: { adult: true, allowed: true } });
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
