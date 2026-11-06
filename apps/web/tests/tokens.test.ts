import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const css = readFileSync(resolve(root, "app/tokens.css"), "utf8");
const design = readFileSync(resolve(root, "../../DESIGN.md"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`));
  if (!match) throw new Error(`No token called ${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: string, second: string): number {
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

describe("design tokens", () => {
  test.each([
    ["on-ground", "ground"],
    ["on-ground-soft", "ground"],
    ["ink", "panel"],
    ["ink-soft", "panel"],
    ["ink", "quiet"],
    ["ink-soft", "quiet"],
    ["link", "panel"],
    ["link", "ground"],
    ["danger", "panel"],
    ["on-stage", "stage"],
    ["on-highlight", "highlight"],
    ["caution", "caution-bg"],
  ])("%s is readable on %s", (text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  test("every colour matches DESIGN.md", () => {
    const names = [...css.matchAll(/--([a-z-]+): #/g)].map((match) => match[1]);
    const paired = new Set(["caution-bg", "caution"]);
    for (const name of names.filter((item) => !paired.has(item))) {
      expect(design).toContain(`\`--${name}\` | \`${token(name)}\``);
    }
    expect(design).toContain(`\`${token("caution-bg")}\`, \`${token("caution")}\``);
  });
});
