import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { makeClip } from "./fixture";

const FAKE = path.resolve(__dirname, "../fake-engine.mjs");
const withFake = (control: string) => ({ ROWVISION_ENGINE: JSON.stringify([process.env.NODE ?? "node", FAKE]), ROWVISION_ENGINE_KIND: "fake", FAKE_ENGINE_CONTROL: path.join(data, "engine-control"), FAKE_MODELS_CONTROL: control });

const appDir = path.resolve(__dirname, "../..");
const electronPath = createRequire(__filename)("electron") as unknown as string;

let data: string;
let app: ElectronApplication;
let page: Page;

/** A fresh computer: no settings, no clips, and no measuring program, as in the test version today. */
async function launch(env: Record<string, string> = {}) {
  app = await electron.launch({
    executablePath: electronPath,
    args: [appDir, "--enable-unsafe-swiftshader"],
    env: { ...process.env, ROWVISION_DATA_DIR: data, ROWVISION_TEST_NOTICES: "1", ROWVISION_ENGINE: "", ...env },
  });
  page = await app.firstWindow();
}

async function close() {
  const closed = await Promise.race([app.close().then(() => true), new Promise((done) => setTimeout(() => done(false), 10_000))]);
  if (!closed) app.process().kill("SIGKILL");
}

const settings = () => JSON.parse(readFileSync(path.join(data, "settings.json"), "utf8")) as Record<string, unknown>;

test.beforeEach(() => { data = mkdtempSync(path.join(tmpdir(), "rowvision-welcome-")); });
test.afterEach(async () => {
  await close();
  rmSync(data, { recursive: true, force: true });
});

test("the first run walks through the folder, colours and measuring, then opens the add page", async () => {
  const picked = path.join(data, "Videos");
  mkdirSync(picked);
  await launch({ ROWVISION_TEST_PICK_FOLDER: picked });

  await expect(page.getByRole("heading", { name: "Welcome to RowVision" })).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByTestId("clips-folder")).toHaveText(path.join(data, "clips"));
  await expect(page.getByText(/GB free|MB free/)).toBeVisible();

  await page.getByRole("button", { name: "Change" }).click();
  const moved = path.join(picked, "RowVision");
  await expect(page.getByTestId("clips-folder")).toHaveText(moved);
  expect(existsSync(moved)).toBe(true);
  expect(settings().clipsDir).toBe(moved);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Pick your colours" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Black" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Forest" }).click();
  await expect(page.getByRole("button", { name: "Forest" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => settings().colours).toEqual({ ground: "#0a3d27", highlight: "#4be38a" });

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Honest about what is missing: no pretend download.
  await expect(page.getByRole("heading", { name: "Get the measuring ready" })).toBeVisible();
  await expect(page.getByTestId("measuring")).toContainText("Not ready yet");
  await expect(page.getByText("aren't included in this test version yet")).toBeVisible();
  await page.getByRole("button", { name: "Add your first video" }).click();

  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByRole("navigation")).toBeVisible();
  expect(settings().welcomed).toBe(true);

  // The welcome never comes back, and the picked folder is still the library.
  await close();
  await launch();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to RowVision" })).toHaveCount(0);
  expect(await page.evaluate(async () => (await window.rowvision.getWelcome()).clipsDir)).toBe(moved);
});

test("with the measuring program there, step 3 says it is ready", async () => {
  await launch({ ROWVISION_ENGINE: JSON.stringify([process.env.NODE ?? "node", path.join(__dirname, "../fake-engine.mjs")]), ROWVISION_ENGINE_KIND: "fake" });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("measuring")).toContainText("Ready");
  await expect(page.getByText("Not ready yet")).toHaveCount(0);
});

test("a folder that can't be used is refused in plain words", async () => {
  // A file sits where the folder would go, so it can't be made.
  writeFileSync(path.join(data, "file.txt"), "x");
  await launch({ ROWVISION_TEST_PICK_FOLDER: path.join(data, "file.txt", "inside") });
  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByRole("alert")).toHaveText("RowVision can't save clips there. Pick another folder.");
  await expect(page.getByTestId("clips-folder")).toHaveText(path.join(data, "clips"));
  expect(existsSync(path.join(data, "settings.json")) && settings().clipsDir).toBeFalsy();
});

test("people who already have clips skip the welcome", async () => {
  makeClip(path.join(data, "clips"));
  await launch();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to RowVision" })).toHaveCount(0);
});

test("step 3 starts the download by itself, shows how far it is, and ends ready", async () => {
  const control = path.join(data, "models-control");
  writeFileSync(control, "slow");
  await launch(withFake(control));
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Get the measuring ready" })).toBeVisible();
  await expect(page.getByText("about 145 MB")).toBeVisible();
  // It started without a click, and stops at 40% (58 of 145 MB) until told to carry on.
  await expect(page.getByTestId("measuring")).toContainText("Downloading, 58 MB of 145 MB");
  await expect(page.getByTestId("measuring")).toContainText("40%");
  await expect(page.getByTestId("measuring")).not.toContainText("Ready");
  writeFileSync(control, "missing");
  await expect(page.getByTestId("measuring")).toContainText("Ready");
  await expect(page.getByTestId("measuring")).toContainText("100%");
  await page.getByRole("button", { name: "Add your first video" }).click();
  await expect(page).toHaveURL(/#\/add$/);
});

test("a download that fails says why and can be tried again", async () => {
  const control = path.join(data, "models-control");
  writeFileSync(control, "offline");
  await launch(withFake(control));
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't reach the download. Check your internet connection and try again.");
  // It does not keep hammering a failed download by itself.
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  writeFileSync(control, "missing");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("measuring")).toContainText("Ready");
});

test("the download can be cancelled and picked up again from Settings", async () => {
  const control = path.join(data, "models-control");
  writeFileSync(control, "slow");
  writeFileSync(path.join(data, "settings.json"), JSON.stringify({ welcomed: true }));
  await launch(withFake(control));
  await page.getByRole("link", { name: "Settings" }).click();
  const card = page.getByTestId("models-card");
  await expect(card).toContainText("Not downloaded yet");
  await card.getByRole("button", { name: "Download" }).click();
  await expect(card).toContainText("Downloading, 58 MB of 145 MB (40%)");
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toContainText("Not downloaded yet");
  writeFileSync(control, "missing");
  await card.getByRole("button", { name: "Download" }).click();
  await expect(card).toContainText("Downloaded.");
});

test("a clip for the more accurate model waits for it, and says so, when only the faster one is here", async () => {
  const control = path.join(data, "models-control");
  writeFileSync(control, "standard");
  writeFileSync(path.join(data, "settings.json"), JSON.stringify({ welcomed: true }));
  const folder = path.join(data, "clips", "waiting-clip");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(data, "source.mp4"), "pretend video");
  writeFileSync(path.join(folder, "clip.json"), JSON.stringify({ created_at: "2026-11-09T09:00:00Z", source: path.join(data, "source.mp4"), boat_class: "2-", side: "bow", seat: 2, section_start: 0, section_length: 10, model: "accurate" }));
  await launch(withFake(control));
  await page.evaluate(() => { window.location.hash = "#/analysis/waiting-clip"; });
  await expect(page.getByText("The more accurate model isn't downloaded yet")).toBeVisible();
  await page.getByRole("link", { name: "Download them in Settings" }).click();
  await expect(page.getByTestId("models-card")).toContainText("The faster model is here.");
  await page.getByTestId("models-card").getByRole("button", { name: "Download" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.rowvision.listClips())[0].state), { timeout: 20_000 }).toBe("done");
});

test("clips wait for the models, and are measured once they are downloaded", async () => {
  const control = path.join(data, "models-control");
  writeFileSync(control, "missing");
  writeFileSync(path.join(data, "settings.json"), JSON.stringify({ welcomed: true }));
  const folder = path.join(data, "clips", "waiting-clip");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(data, "source.mp4"), "pretend video");
  writeFileSync(path.join(folder, "clip.json"), JSON.stringify({ created_at: "2026-11-09T09:00:00Z", source: path.join(data, "source.mp4"), boat_class: "2-", side: "bow", seat: 2, section_start: 0, section_length: 10 }));
  await launch(withFake(control));
  await page.evaluate(() => { window.location.hash = "#/analysis/waiting-clip"; });
  await expect(page.getByText("The measuring models aren't downloaded yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting its turn" })).toBeVisible();
  expect(await page.evaluate(async () => (await window.rowvision.listClips())[0].state)).toBe("waiting");
  await page.getByRole("link", { name: "Download them in Settings" }).click();
  await page.getByTestId("models-card").getByRole("button", { name: "Download" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.rowvision.listClips())[0].state), { timeout: 20_000 }).toBe("done");
});

test("a newer version is shown in the side menu until Later, and the check can be turned off", async () => {
  writeFileSync(path.join(data, "settings.json"), JSON.stringify({ welcomed: true }));
  const newer = { ROWVISION_LATEST_URL: `data:application/json,${encodeURIComponent(JSON.stringify({ version: "9.9.9" }))}` };
  await launch(newer);

  const card = page.getByRole("region", { name: "9.9.9 is out" });
  await expect(card).toContainText("Your clips stay when you install it.");
  await expect(card.getByRole("link", { name: "Download" })).toHaveAttribute("href", "https://rowvision.app/download");
  await card.getByRole("button", { name: "Later" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => settings().skippedVersion).toBe("9.9.9");

  await close();
  await launch(newer);
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("region", { name: /is out/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings" }).click();
  const check = page.getByRole("checkbox", { name: "Check for a new version when RowVision opens" });
  await expect(check).toBeChecked();
  await check.uncheck();
  await expect.poll(() => settings().checkUpdates).toBe(false);
});
