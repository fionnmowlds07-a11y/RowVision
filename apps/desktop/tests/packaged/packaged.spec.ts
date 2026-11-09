import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const windows = process.platform === "win32";
const unpacked = path.resolve(__dirname, "../../release", windows ? "win-unpacked" : "linux-unpacked");
const program = path.join(unpacked, windows ? "RowVision.exe" : "rowvision");
const engine = path.join(unpacked, "resources", "engine", windows ? "rowvision-engine.exe" : "rowvision-engine");

test.skip(!existsSync(program), "Build the installer first with npm run dist");

// With the engine inside, this downloads the real models from the internet, so it takes a few minutes.
test.setTimeout(15 * 60_000);

test("the installed app starts, knows it is packaged, and tells the truth about its engine", async () => {
  // CI names a folder to keep, so a later step can check the engine loads what was downloaded.
  const kept = process.env.PACKAGED_DATA_DIR;
  const data = kept ?? mkdtempSync(path.join(tmpdir(), "rowvision-packaged-"));
  mkdirSync(data, { recursive: true });
  const app = await electron.launch({
    executablePath: program,
    // CI runners cannot set up Chromium's own sandbox for an unpacked app.
    args: process.env.CI ? ["--no-sandbox", "--enable-unsafe-swiftshader"] : ["--enable-unsafe-swiftshader"],
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
      "yolox_m_8xb8-300e_humanart-c2c7a14a.onnx",
    ]);
    expect(readdirSync(checkpoints).filter((name) => name.startsWith("."))).toEqual([]);
  } finally {
    const closed = await Promise.race([app.close().then(() => true), new Promise((done) => setTimeout(() => done(false), 10_000))]);
    if (!closed) app.process().kill("SIGKILL");
    if (!kept) rmSync(data, { recursive: true, force: true });
  }
});
