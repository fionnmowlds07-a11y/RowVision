import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const windows = process.platform === "win32";
// CI also runs this on the app as the Windows installer put it on the computer.
const unpacked = process.env.PACKAGED_APP_DIR ?? path.resolve(__dirname, "../../release", windows ? "win-unpacked" : "linux-unpacked");
const program = path.join(unpacked, windows ? "RowVision.exe" : "rowvision");
const engine = path.join(unpacked, "resources", "engine", windows ? "rowvision-engine.exe" : "rowvision-engine");

test.skip(!existsSync(program), "Build the installer first with npm run dist");

// With the engine inside, this downloads the real models from the internet, so it takes a few minutes.
test.setTimeout(25 * 60_000);

test("the installed app starts, knows it is packaged, and tells the truth about its engine", async () => {
  // CI names a folder to keep, so a later step can check the engine loads what was downloaded.
  const kept = process.env.PACKAGED_DATA_DIR;
  const data = kept ?? mkdtempSync(path.join(tmpdir(), "rowvision-packaged-"));
  mkdirSync(data, { recursive: true });
  const app = await electron.launch({
    executablePath: program,
    // Linux CI runners cannot set up Chromium's own sandbox for an unpacked app. On Windows the flag crashes the app.
    args: process.env.CI && process.platform === "linux" ? ["--no-sandbox", "--enable-unsafe-swiftshader"] : ["--enable-unsafe-swiftshader"],
    env: { ...process.env, ROWVISION_DATA_DIR: data, ROWVISION_ENGINE: "", ROWVISION_TEST_NOTICES: "1" },
  });
  try {
    const facts = await app.evaluate(({ app: electronApp }) => ({ packaged: electronApp.isPackaged, name: electronApp.getName(), version: electronApp.getVersion() }));
    const expected = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { version: string };
    expect(facts).toEqual({ packaged: true, name: "RowVision", version: expected.version });

    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Welcome to RowVision" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    const measuring = page.getByTestId("measuring");
    if (!existsSync(engine)) {
      // Built without the engine, which is how it is built on a developer's computer.
      await expect(measuring).toContainText("Not ready yet");
      return;
    }
    // Built with the engine: the download starts by itself, and "Ready" only shows once the files are really there.
    await expect(measuring).toContainText("Downloading", { timeout: 60_000 });
    await expect(measuring).toContainText("Ready", { timeout: 12 * 60_000 });
    const checkpoints = path.join(data, "models", "rtmlib", "hub", "checkpoints");
    expect(readdirSync(checkpoints).filter((name) => name.endsWith(".onnx")).sort()).toEqual([
      "rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.onnx",
      "rtmpose-x_simcc-body7_pt-body7_700e-384x288-71d7b7e9_20230629.onnx",
      "yolox_m_8xb8-300e_humanart-c2c7a14a.onnx",
    ]);
    expect(readdirSync(checkpoints).filter((name) => name.startsWith("."))).toEqual([]);

    // A real clip, through the page as a rower would do it. The engine is started by the app, so the
    // pipes between them are the real ones: on Windows those once stopped every clip before it began.
    const clip = process.env.PACKAGED_CLIP;
    if (!clip) return;
    await page.getByRole("button", { name: "Add your first video" }).click();
    await page.locator("input[type=file]").setInputFiles(clip);
    await expect(page.getByRole("group", { name: "Trim your clip" })).toBeVisible();
    await page.getByRole("region", { name: "Your boat" }).locator("select").first().selectOption("1x");
    // The larger model is the first choice, so this is also the real test that it loads and runs.
    await expect(page.getByRole("region", { name: "Accuracy" }).getByRole("button", { name: "More accurate" })).toHaveAttribute("aria-pressed", "true");
    if (process.env.PACKAGED_SHOT) await page.screenshot({ path: process.env.PACKAGED_SHOT.replace(/\.png$/, "-add.png"), fullPage: true });
    await page.getByRole("button", { name: "Add to your clips" }).click();
    await expect(page).toHaveURL(/#\/analysis\/[a-z0-9-]+$/);
    const id = /#\/analysis\/([a-z0-9-]+)$/.exec(page.url())![1];
    await expect(page.getByRole("heading", { name: "Analysed" })).toBeVisible({ timeout: 10 * 60_000 });
    const folder = path.join(data, "clips", id);
    expect(readdirSync(folder)).toEqual(expect.arrayContaining(["engine.log", "frames.json", "summary.json", "working.mp4"]));
    const log = readFileSync(path.join(folder, "engine.log"), "utf8");
    console.log(log);
    expect(log).toContain("accurate model");
    await page.getByRole("link", { name: "See your results" }).click();
    const viewer = page.getByRole("region", { name: "Frame viewer" });
    await expect(viewer).toBeVisible();
    // The app can show the video it made.
    await expect.poll(() => page.evaluate(() => document.querySelector("video")?.readyState ?? 0), { timeout: 30_000 }).toBeGreaterThan(1);
    const shown = () => viewer.locator("p[aria-live]").innerText();
    const before = await shown();
    await viewer.getByRole("button", { name: "Forward 1", exact: true }).click();
    await expect.poll(shown).not.toBe(before);
    if (process.env.PACKAGED_SHOT) await page.screenshot({ path: process.env.PACKAGED_SHOT, fullPage: true });
  } finally {
    const closed = await Promise.race([app.close().then(() => true), new Promise((done) => setTimeout(() => done(false), 10_000))]);
    if (!closed) app.process().kill("SIGKILL");
    if (!kept) rmSync(data, { recursive: true, force: true });
  }
});
