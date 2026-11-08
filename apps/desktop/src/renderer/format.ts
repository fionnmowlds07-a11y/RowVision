const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const LONG_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

export function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown date" : DATE.format(date);
}

export function longDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Unknown date" : LONG_DATE.format(date);
}

export function setupLine(setup: { boat_class?: string; seat?: number }): string {
  return [setup.boat_class, setup.seat !== undefined ? `seat ${setup.seat}` : null].filter(Boolean).join(" ");
}

export function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
