import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { makeClip } from "./fixture";

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
