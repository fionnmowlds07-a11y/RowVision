import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

const MAIL = "http://127.0.0.1:54424";

/** Make a clip at test time, as footage is never kept in the repository. */
export function makeClip(name: string, seconds: number, size = "1920x1080"): string {
  const path = join(tmpdir(), name);
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30`, "-t", String(seconds),
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path,
  ]);
  return path;
}

async function code(page: Page, email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // The same email can't be sent another code within a second, so a test that
    // signs in straight after another with that email may have to ask again.
    if (await page.getByText("Too many codes have been sent").isVisible()) {
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "Send my code" }).click();
    }
    const search = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:"Your RowVision code"`)}`)).json();
    if (search.messages?.[0]) {
      const message = await (await fetch(`${MAIL}/api/v1/message/${search.messages[0].ID}`)).json();
      return (message.Text || message.HTML).match(/\b\d{6}\b/)[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("No code arrived");
}

export async function signIn(page: Page, email: string) {
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.getByLabel("Code").fill(await code(page, email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your clips" })).toBeVisible();
}

export async function addClip(page: Page, path: string) {
  await page.goto("/add");
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByText("Uploaded")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Analyse" }).click();
  await page.waitForURL("**/clips/**");
}
