/** The presets from DESIGN.md. Black is the default. */
export const PRESETS = [
  { name: "Black", ground: "#070b09", highlight: "#35d07f" },
  { name: "Forest", ground: "#0a3d27", highlight: "#4be38a" },
  { name: "Deep green", ground: "#0a5c3a", highlight: "#4be38a" },
  { name: "Mid green", ground: "#127049", highlight: "#b6f2c9" },
  { name: "Pale green", ground: "#dff1e6", highlight: "#0b7a4b" },
] as const;

export const DEFAULT_COLOURS = { ground: PRESETS[0].ground, highlight: PRESETS[0].highlight };

export function isColour(value: string): boolean {
  return /^#[0-9a-f]{6}$/.test(value);
}

export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(first: string, second: string): number {
  const [low, high] = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}

/** Black or white, whichever reads better. One of the two always clears 4.5 to 1. */
export function textOn(hex: string): string {
  return contrast(hex, "#ffffff") >= contrast(hex, "#000000") ? "#ffffff" : "#000000";
}

export function colourVariables(ground: string | null, highlight: string | null): Record<string, string> {
  const chosenGround = ground && isColour(ground) ? ground : null;
  const chosenHighlight = highlight && isColour(highlight) ? highlight : null;
  return {
    ...(chosenGround ? {
      "--ground": chosenGround,
      "--on-ground": textOn(chosenGround),
      "--on-ground-soft": textOn(chosenGround),
    } : {}),
    ...(chosenHighlight ? { "--highlight": chosenHighlight, "--on-highlight": textOn(chosenHighlight) } : {}),
  };
}
