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

async function code(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
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
  await page.getByLabel("Code").fill(await code(email));
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
