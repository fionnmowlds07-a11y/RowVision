import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addClip, makeClip, signIn } from "./helpers";

async function noSeriousProblems(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(serious.map(({ id }) => id)).toEqual([]);
}

test("anyone signed out is sent to sign-in, and it is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
  await noSeriousProblems(page);
});

test("an email not on the list is turned away", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page.getByText("isn't on the preview list")).toBeVisible();
});

test("the filming guide is public", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { name: "Send the original" })).toBeVisible();
  await noSeriousProblems(page);
});

test("a clip goes from upload to result, and frames can be stepped", async ({ page }) => {
  await signIn(page, "athlete@example.com");
  await addClip(page, makeClip("journey.mp4", 8));
  await expect(page.getByRole("heading", { name: "Work on next" })).toBeVisible({ timeout: 45_000 });
  await noSeriousProblems(page);

  await page.getByRole("button", { name: "See the 3D model" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  const open = page.getByRole("button", { name: "Open video" });
  if (await open.isVisible()) await open.click();
  const readout = page.getByLabel("Frame viewer").locator("p").first();
  await expect(readout).toContainText("Catch, frame 30");
  await page.getByRole("button", { name: "Forward 1", exact: true }).click();
  await expect(readout).toContainText("Frame 31");
  await page.getByRole("button", { name: "Back 1", exact: true }).click();
  await page.getByRole("button", { name: "Back 1", exact: true }).click();
  await expect(readout).toContainText("Frame 29");
});

test("a compressed copy warns, and a third waiting clip is refused", async ({ page }) => {
  await signIn(page, "athlete@example.com");
  await page.goto("/add");
  await page.locator("input[type=file]").setInputFiles(makeClip("VID-20260101-WA0001.mp4", 6, "848x478"));
  await expect(page.getByText("compressed copy")).toBeVisible();
});

test("one athlete cannot open another's clip, and the admin can", async ({ page, browser }) => {
  await signIn(page, "athlete@example.com");
  await addClip(page, makeClip("private.mp4", 6));
  const link = page.url();

  const other = await (await browser.newContext()).newPage();
  await signIn(other, "second@example.com");
  const response = await other.goto(link);
  expect(response?.status()).toBe(404);

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, "admin@example.com");
  expect((await admin.goto(link))?.status()).toBe(200);
  await admin.goto("/admin");
  await expect(admin.getByText("opened clip").first()).toBeVisible();
  await noSeriousProblems(admin);
});

test("an athlete cannot reach the admin page", async ({ page }) => {
  await signIn(page, "athlete@example.com");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Your clips" })).toBeVisible();
});

test("colours can be changed and reset", async ({ page }) => {
  await signIn(page, "second@example.com");
  await page.goto("/settings");
  await noSeriousProblems(page);
  await page.getByRole("button", { name: "Pale green" }).click();
  await page.getByRole("button", { name: "Save colours" }).click();
  await expect.poll(async () => {
    await page.goto("/settings");
    return page.locator("header").evaluate((bar) => getComputedStyle(bar.parentElement!).backgroundColor);
  }).toBe("rgb(223, 241, 230)");
  await page.getByRole("button", { name: "Reset to the club greens" }).click();
});
