import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const windows = process.platform === "win32";
const unpacked = path.resolve(__dirname, "../../release", windows ? "win-unpacked" : "linux-unpacked");
const program = path.join(unpacked, windows ? "RowVision.exe" : "rowvision");
const engine = path.join(unpacked, "resources", "engine", windows ? "rowvision-engine.exe" : "rowvision-engine");

test.skip(!existsSync(program), "Build the installer first with npm run dist");

test("the installed app starts, knows it is packaged, and tells the truth about its engine", async () => {
  const data = mkdtempSync(path.join(tmpdir(), "rowvision-packaged-"));
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
    // Step 3 says what is really there: the engine only exists when the installer was built with it.
    await expect(page.getByTestId("measuring")).toContainText(existsSync(engine) ? "Ready" : "Not ready yet");
  } finally {
    const closed = await Promise.race([app.close().then(() => true), new Promise((done) => setTimeout(() => done(false), 10_000))]);
    if (!closed) app.process().kill("SIGKILL");
    rmSync(data, { recursive: true, force: true });
  }
});
