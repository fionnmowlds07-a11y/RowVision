// The statistics PDF: scores, every rower's stroke over one another, every number, and the power
// hand-over from legs to back to arms. Plain data in, HTML text out, so the preview and the PDF match.
import { anglesFor, handover, leadRower, PARTS, type Handover, type Part } from "@/lib/handover";
import type { FrameData, Metric, Rower, Target } from "@/lib/result";
import { escape, rowerTitle } from "./report";

/** One colour per rower, stroke first. Each reads on white and differs from its neighbours in lightness. */
export const SEAT_COLOURS = ["#0b7a4b", "#1f5fbf", "#c2410c", "#7c3aed", "#0e7490", "#a16207", "#be185d", "#374151"];
const PART_COLOURS: Record<Part, string> = { legs: "#0b7a4b", back: "#7c3aed", arms: "#c2410c" };
const PART_NAMES: Record<Part, string> = { legs: "legs", back: "back", arms: "arms" };
const PHASES = ["catch", "drive", "finish", "rhythm"] as const;
const PHASE_NAMES: Record<string, string> = { catch: "Catch", drive: "Drive", finish: "Finish", rhythm: "Rhythm" };

export type StatsRower = { key: string; name: string; colour: string; tone: number; rower: Rower; hand: Handover | null };
export type Stats = { title: string; meta: string; lead: StatsRower | null; rowers: StatsRower[]; leadName: string };

const ink = "#0d1a12";
const soft = "#3d5246";
const rule = "#cfdcd4";
const faint = "#eef2ef";

// ---- Building the data ----

export function shortName(rower: Rower, seats: number, own: number | null): string {
  const { title, note } = rowerTitle(rower, seats, own);
  const base = seats === 1 ? "Rower" : note.includes("Stroke seat") ? "Stroke" : note.includes("Bow seat") ? "Bow" : title;
  return note.includes("you") ? `${base} (you)` : base;
}

/** Every rower in the clip, stroke first, with their colour and hand-over. */
export function statsRowers(rowers: Rower[], data: FrameData | null, fps: number, seats: number, own: number | null): StatsRower[] {
  const crew = rowers.length > 1;
  const lead = rowers.length ? leadRower(rowers) : null;
  return [...rowers].sort((a, b) => (b.seat ?? 0) - (a.seat ?? 0)).map((rower, index) => {
    const angles = data ? anglesFor(rower, data, crew) : null;
    return {
      key: String(rower.seat ?? "rower"),
      name: shortName(rower, seats, own),
      colour: SEAT_COLOURS[index % SEAT_COLOURS.length],
      tone: index % SEAT_COLOURS.length,
      rower,
      hand: angles && lead ? handover(rower, angles, fps, lead) : null,
    };
  });
}

export function statsReport(title: string, meta: string, every: StatsRower[], chosen: string[]): Stats {
  const rowers = every.filter((item) => chosen.includes(item.key));
  const leaderSeat = leadRower(every.map((item) => item.rower))?.seat ?? null;
  const lead = every.find((item) => item.rower.seat === leaderSeat) ?? null;
  return { title, meta, lead, rowers, leadName: lead?.name ?? "the stroke" };
}

// ---- Numbers ----

export const minus = (text: string) => text.replace(/^-/, "−");
export const fixed = (value: number, places = 1) => minus(value.toFixed(places));
export const deg = (value: number | null | undefined, places = 1) => (value === null || value === undefined ? "—" : `${fixed(value, places)}°`);
export const pct = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);
export const secs = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value.toFixed(2)} s`);

export function metricOf(rower: Rower, name: string): Metric | null {
  return [...rower.card.metrics, ...(rower.card.extras ?? [])].find((metric) => metric.name === name) ?? null;
}

export function targetOf(rowers: StatsRower[], name: string): { target: Target; scored: boolean } | null {
  for (const item of rowers) {
    const metric = metricOf(item.rower, name);
    if (metric?.target) return { target: metric.target, scored: metric.score !== null };
  }
  return null;
}

export const MEASURES: { name: string; label: string; show: (value: number) => string }[] = [
  { name: "catch_lean_deg", label: "Catch lean", show: (v) => deg(v) },
  { name: "finish_lean_deg", label: "Finish lean", show: (v) => deg(v) },
  { name: "body_swing_deg", label: "Body swing", show: (v) => deg(v) },
  { name: "catch_knee_deg", label: "Catch knee", show: (v) => deg(v) },
  { name: "catch_shin_deg", label: "Catch shin from vertical", show: (v) => deg(v) },
  { name: "finish_knee_deg", label: "Finish knee", show: (v) => deg(v) },
  { name: "catch_elbow_deg", label: "Elbow at the catch", show: (v) => deg(v, 0) },
  { name: "finish_elbow_deg", label: "Elbow at the finish", show: (v) => deg(v, 0) },
  { name: "legs_lead", label: "Legs lead the back", show: (v) => pct(v) },
  { name: "arms_break", label: "Arms bend at", show: (v) => pct(v) },
  { name: "drive_share", label: "Drive share", show: (v) => pct(v) },
  { name: "drive_s", label: "Drive", show: (v) => secs(v) },
  { name: "recovery_s", label: "Recovery", show: (v) => secs(v) },
  { name: "ratio", label: "Recovery ÷ drive", show: (v) => v.toFixed(2) },
  { name: "stroke_length", label: "Stroke length", show: (v) => `${v.toFixed(2)}×` },
  { name: "rate_steadiness", label: "Rate steadiness", show: (v) => `within ${Math.max(1, Math.round(v))}%` },
];

export function targetText(name: string, found: { target: Target; scored: boolean } | null): string {
  if (!found) return "no target";
  const { low, high } = found.target;
  const guide = found.scored ? "" : "guide ";
  if (name.includes("lean") && low < 0) return `${guide}${minus(String(Math.round(low)))} to ${minus(String(Math.round(high ?? low)))}°`;
  if (name === "drive_share" || name === "legs_lead") return high === null ? `above ${Math.round(low * 100)}%` : `${guide}${Math.round(low * 100)}–${Math.round(high * 100)}%`;
  if (high === null) return `${guide}at least ${Math.round(low)}`;
  return `${guide}${Math.round(low)}–${Math.round(high)}°`;
}

// ---- Drawing ----

function line(values: number[], width: number, height: number, low: number, high: number): string {
  return "M" + values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - low) / (high - low)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

const yOf = (value: number, height: number, low: number, high: number) => height - ((value - low) / (high - low)) * height;

function head(title: string, meta: string, big: boolean): string {
  return `<header class="rvs-head"><div><h1 class="${big ? "rvs-h1" : "rvs-h2"}">${escape(title)}</h1>${meta ? `<p class="rvs-meta">${escape(meta)}</p>` : ""}</div>
    <div class="rvs-brand"><svg width="30" height="30" viewBox="0 0 32 32" role="img" aria-label="RowVision logo"><rect width="32" height="32" rx="7" fill="#070b09"/><path d="M6 22 L14 10 L20 18 L26 8" fill="none" stroke="#35d07f" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>RowVision</span></div></header>`;
}

const foot = (left: string) => `<footer class="rvs-foot"><span>${escape(left)}</span><span class="rvs-page">RowVision</span></footer>`;
// The app's page allows no inline styles, so every colour and column count here is a class.
const key = (items: { fill: string; name: string }[]) => `<div class="rvs-key">${items.map((item) => `<span><i class="${item.fill}"></i>${escape(item.name)}</span>`).join("")}</div>`;

function shade(score: number | null): string {
  if (score === null) return `class="rvs-cell rvs-none"`;
  if (score >= 90) return `class="rvs-cell rvs-top"`;
  if (score >= 80) return `class="rvs-cell rvs-s80"`;
  if (score >= 70) return `class="rvs-cell rvs-s70"`;
  if (score >= 50) return `class="rvs-cell rvs-s50"`;
  return `class="rvs-cell rvs-low"`;
}

// ---- Page 1: the overview ----

function scoreCards(rowers: StatsRower[]): string {
  if (rowers.length <= 3) {
    return `<div class="rvs-cards rvs-n${rowers.length}">${rowers.map((item) => {
      const overall = item.rower.card.overall;
      return `<div class="rvs-card rvs-bd${item.tone}"><div><div class="rvs-who"><i class="rvs-bg${item.tone}"></i>${escape(item.name)}</div>
        <div class="rvs-small">accuracy ${escape(item.rower.rating.band)} (${Math.round(item.rower.rating.accuracy)})</div></div>
        <div class="rvs-right"><div class="rvs-score rvs-t${item.tone}">${overall === null ? "–" : Math.round(overall)}</div><div class="rvs-small">${overall === null ? "no overall score" : "overall"}</div></div></div>`;
    }).join("")}</div>`;
  }
  const rows = rowers.map((item, index) => {
    const overall = item.rower.card.overall;
    const y = index * 25;
    const width = overall === null ? 0 : (overall / 100) * 400;
    return `<text x="0" y="${y + 13}" font-weight="700" fill="${ink}">${escape(item.name)}</text><rect x="96" y="${y + 1}" width="${width.toFixed(0)}" height="16" rx="3" fill="${item.colour}"/>
      <text x="${(102 + width).toFixed(0)}" y="${y + 14}" fill="${ink}">${overall === null ? "no overall score" : Math.round(overall)} · accuracy ${escape(item.rower.rating.band)}</text>`;
  }).join("");
  return `<section><h3>Overall score, stroke to bow</h3><svg class="rvs-svg" width="706" height="${rowers.length * 25}" viewBox="0 0 706 ${rowers.length * 25}" role="img" aria-label="Overall score for each rower">${rows}</svg></section>`;
}

function strip(stats: Stats): string {
  const { rowers } = stats;
  const rates = rowers.map((item) => item.rower.rate_spm).filter((value): value is number => value !== null);
  const strokes = Math.max(0, ...rowers.map((item) => item.rower.strokes.length));
  const drives = rowers.map((item) => metricOf(item.rower, "drive_s")?.value ?? null);
  const shown = drives.filter((value): value is number => value !== null);
  const driveText = shown.length === 0 ? "—" : rowers.length <= 3 ? `${drives.map((value) => (value === null ? "—" : value.toFixed(2))).join(" · ")} s` : `${Math.min(...shown).toFixed(2)}–${Math.max(...shown).toFixed(2)} s`;
  const timed = rowers.filter((item) => item.rower.timing?.catch_ms !== null && item.rower.timing?.catch_ms !== undefined);
  let timing = { label: "Catch timing", text: "—" };
  if (timed.length === 1) {
    const ms = timed[0].rower.timing!.catch_ms!;
    timing = { label: `${timed[0].name}'s catch`, text: `${Math.round(Math.abs(ms))} ms ${ms < 0 ? "early" : "late"}` };
  } else if (timed.length > 1) {
    timing = { label: `Catches against ${stats.leadName}`, text: `within ±${Math.round(Math.max(...timed.map((item) => Math.abs(item.rower.timing!.catch_ms!))))} ms` };
  }
  const tiles = [
    { label: "Rate", text: rates.length ? `${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)} spm` : "—" },
    { label: "Strokes measured", text: String(strokes) },
    timing,
    { label: rowers.length <= 3 ? "Drive time" : "Drive times", text: driveText },
  ];
  return `<div class="rvs-strip">${tiles.map((tile) => `<div><small>${escape(tile.label)}</small><b>${escape(tile.text)}</b></div>`).join("")}</div>`;
}

function strokeOverlay(stats: Stats): string {
  const { rowers } = stats;
  const drawn = rowers.filter((item) => item.hand?.cycle.trunk);
  if (drawn.length === 0) return "";
  const all = drawn.flatMap((item) => item.hand!.cycle.trunk!);
  const low = Math.min(-40, Math.floor(Math.min(...all) / 5) * 5 - 5);
  const high = Math.max(40, Math.ceil(Math.max(...all) / 5) * 5 + 5);
  const W = 640;
  const H = 240;
  const y = (value: number) => yOf(value, H, low, high).toFixed(1);
  const band = (name: string, where: "above" | "below") => {
    const found = targetOf(rowers, name);
    if (!found || found.target.high === null) return "";
    const top = Number(y(found.target.high));
    const bottom = Number(y(found.target.low));
    const label = `${name.startsWith("catch") ? "catch" : "finish"} target ${targetText(name, found)}`;
    const ty = where === "above" ? top - 6 : bottom + 15;
    return `<rect x="0" y="${top}" width="${W}" height="${(bottom - top).toFixed(1)}" fill="#0b7a4b" opacity="0.12"/><text x="${W - 4}" y="${ty.toFixed(0)}" fill="#0b7a4b" text-anchor="end">${escape(label)}</text>`;
  };
  const ticks = [30, 0, -30].filter((value) => value > low && value < high)
    .map((value) => `<text x="-8" y="${(Number(y(value)) + 4).toFixed(0)}" fill="${soft}" text-anchor="end">${value > 0 ? "+" : ""}${minus(String(value))}°</text>`).join("");
  const lines = [...drawn].reverse().map((item) => `<path d="${line(item.hand!.cycle.trunk!, W, H, low, high)}" fill="none" stroke="${item.colour}" stroke-width="${drawn.length <= 2 ? 3 : 2.2}"/>`).join("");
  const marks = drawn.map((item) => {
    const values = item.hand!.cycle.trunk!;
    const share = item.hand!.cycle.finishShare;
    const catchMark = `<circle cx="0" cy="${y(values[0])}" r="6" fill="#fff" stroke="${item.colour}" stroke-width="2.5"/>`;
    if (share === null) return catchMark;
    const index = Math.round(share * (values.length - 1));
    return `${catchMark}<rect x="${(share * W - 6).toFixed(1)}" y="${(Number(y(values[index])) - 6).toFixed(1)}" width="12" height="12" fill="#fff" stroke="${item.colour}" stroke-width="2.5"/>`;
  }).join("");
  const labels = drawn.length <= 2 ? drawn.map((item, index) => {
    const catchValue = metricOf(item.rower, "catch_lean_deg")?.value;
    const finishValue = metricOf(item.rower, "finish_lean_deg")?.value;
    const values = item.hand!.cycle.trunk!;
    const share = item.hand!.cycle.finishShare ?? 0.45;
    const fy = Number(y(values[Math.round(share * (values.length - 1))]));
    const cy = Number(y(values[0]));
    return `<text x="14" y="${(cy + (index === 0 ? -8 : 16)).toFixed(0)}" fill="${item.colour}" font-weight="700">${escape(`${item.name} ${deg(catchValue)}`)}</text>`
      + `<text x="${(share * W + 12).toFixed(0)}" y="${(fy + (index === 0 ? -10 : 22)).toFixed(0)}" fill="${item.colour}" font-weight="700">${escape(`${item.name} ${deg(finishValue)}`)}</text>`;
  }).join("") : "";
  const finishes = drawn.map((item) => item.hand!.cycle.finishShare).filter((value): value is number => value !== null);
  const note = drawn.length === 2 && finishes.length === 2 ? `${drawn[0].name}'s finish comes at ${pct(finishes[0])} of the stroke, ${drawn[1].name}'s at ${pct(finishes[1])}.` : "";
  const finishX = finishes.length ? (finishes.reduce((a, b) => a + b, 0) / finishes.length) * W : W * 0.45;
  return `<section><div class="rvs-title"><h3>Body angle through one stroke${rowers.length > 1 ? ", every rower" : ""}</h3><span>median of each rower's strokes · ○ catch · □ finish</span></div>
    <svg class="rvs-svg" width="706" height="300" viewBox="0 0 706 300" role="img" aria-label="Body angle through the stroke for each rower, overlaid">
    <g transform="translate(48,10)">${band("catch_lean_deg", "above")}${band("finish_lean_deg", "below")}
    <line x1="0" y1="${y(0)}" x2="${W}" y2="${y(0)}" stroke="${rule}"/><line x1="0" y1="0" x2="0" y2="${H}" stroke="${rule}"/>${ticks}${lines}${marks}${labels}
    <text x="0" y="${H + 20}" font-weight="700" fill="${ink}">Catch</text><text x="${finishX.toFixed(0)}" y="${H + 20}" font-weight="700" fill="${ink}" text-anchor="middle">Finish</text>
    <text x="${((finishX + W) / 2).toFixed(0)}" y="${H + 20}" fill="${soft}" text-anchor="middle">Recovery</text><text x="${W}" y="${H + 20}" font-weight="700" fill="${ink}" text-anchor="end">Next catch</text></g></svg>
    ${key(drawn.map((item) => ({ fill: `rvs-bg${item.tone}`, name: item.name })))}${note ? `<p class="rvs-note">${escape(note)}</p>` : ""}</section>`;
}

function phaseTable(stats: Stats): string {
  const { rowers } = stats;
  const phases = PHASES.filter((phase) => rowers.some((item) => item.rower.card.phases[phase] !== undefined));
  const header = `<div class="rvs-th rvs-left">Seat</div>${phases.map((phase) => `<div class="rvs-th">${PHASE_NAMES[phase]}</div>`).join("")}<div class="rvs-th"><b>Overall</b></div>`;
  const rows = rowers.map((item) => {
    const cells = phases.map((phase) => {
      const score = item.rower.card.phases[phase];
      const value = score === null || score === undefined ? null : Math.round(score);
      return `<div ${shade(value)}>${value ?? "–"}</div>`;
    }).join("");
    const overall = item.rower.card.overall === null ? null : Math.round(item.rower.card.overall);
    return `<div class="rvs-rowname rvs-t${item.tone}">${escape(item.name)}</div>${cells}<div ${shade(overall)}>${overall ?? "–"}</div>`;
  }).join("");
  // The weakest scored measure, said in plain words.
  const weakest = rowers.flatMap((item) => item.rower.card.metrics.filter((metric) => metric.score !== null && metric.score < 50 && metric.value !== null && metric.target)
    .map((metric) => ({ item, metric }))).sort((a, b) => a.metric.score! - b.metric.score!)[0];
  const note = weakest ? `${weakest.item.name}'s ${weakest.metric.label.toLowerCase()} scores ${Math.round(weakest.metric.score!)}: ${deg(weakest.metric.value)} against a target of ${targetText(weakest.metric.name, { target: weakest.metric.target!, scored: true })}.` : "";
  return `<section><div class="rvs-title"><h3>Scores at each part of the stroke</h3><span>darker = higher</span></div>
    <div class="rvs-grid rvs-n${phases.length + 1}">${header}${rows}</div>${note ? `<p class="rvs-note">${escape(note)}</p>` : ""}</section>`;
}

function overviewPage(stats: Stats): string {
  const title = stats.rowers.length > 1 ? "Crew statistics" : "Rower statistics";
  return `<article class="rvs-sheet">${head(title, stats.meta, true)}${scoreCards(stats.rowers)}${strip(stats)}${strokeOverlay(stats)}${phaseTable(stats)}
    ${foot("Drive scores legs leading the back · knees are shown but never scored")}</article>`;
}

// ---- Page 2: in detail ----

function rangePlot(stats: Stats, name: string, title: string): string {
  const rows = stats.rowers.map((item) => ({ item, metric: metricOf(item.rower, name) })).filter((row) => row.metric?.value !== null && row.metric?.value !== undefined);
  if (rows.length === 0) return "";
  const found = targetOf(stats.rowers, name);
  const ends = rows.flatMap(({ metric }) => [metric!.value! - (metric!.spread ?? 0), metric!.value! + (metric!.spread ?? 0)]);
  if (found) ends.push(found.target.low, found.target.high ?? found.target.low);
  const low = Math.floor((Math.min(...ends) - 3) / 5) * 5;
  const high = Math.ceil((Math.max(...ends) + 3) / 5) * 5;
  const W = 250;
  const x = (value: number) => (((value - low) / (high - low)) * W).toFixed(1);
  const step = 26;
  const height = rows.length * step + 30;
  const bandSvg = found && found.target.high !== null ? `<rect x="${x(found.target.low)}" y="0" width="${(Number(x(found.target.high)) - Number(x(found.target.low))).toFixed(1)}" height="${rows.length * step}" fill="#0b7a4b" opacity="0.12"/>` : "";
  const marks = rows.map(({ item, metric }, index) => {
    const value = metric!.value!;
    const spread = metric!.spread ?? 0;
    const y = index * step + 13;
    const outside = found ? value < found.target.low || value > (found.target.high ?? Infinity) : false;
    return `<text x="-8" y="${y + 4}" fill="${item.colour}" text-anchor="end" font-weight="700">${escape(item.name)}</text>
      <line x1="${x(value - spread)}" y1="${y}" x2="${x(value + spread)}" y2="${y}" stroke="${item.colour}" stroke-width="2.5"/>
      <circle cx="${x(value)}" cy="${y}" r="6" fill="${outside ? "#fff" : item.colour}" stroke="${item.colour}" stroke-width="2.5"/>
      <text x="${(Number(x(value + spread)) + 8).toFixed(1)}" y="${y + 4}" fill="${ink}"${outside ? ` font-weight="700"` : ""}>${escape(deg(value))}</text>`;
  }).join("");
  const ticks = Array.from({ length: Math.floor((high - low) / 10) + 1 }, (_, n) => low + n * 10).map((value) => `<text x="${x(value)}" y="${rows.length * step + 18}" fill="${soft}" text-anchor="middle">${minus(String(value))}°</text>`).join("");
  return `<div><h3>${escape(title)}</h3><p class="rvs-small">dot = typical stroke · line = spread · hollow = outside the target${found ? ` ${escape(targetText(name, found))}` : ""}</p>
    <svg class="rvs-svg" width="340" height="${height}" viewBox="0 0 340 ${height}" role="img" aria-label="${escape(title)} for each rower, with spread"><g transform="translate(78,4)">${bandSvg}${marks}
    <line x1="0" y1="${rows.length * step + 2}" x2="${W}" y2="${rows.length * step + 2}" stroke="${rule}"/>${ticks}</g></svg></div>`;
}

function kneeOverlay(stats: Stats): string {
  const drawn = stats.rowers.filter((item) => item.hand?.cycle.knee);
  if (drawn.length === 0) return "<div></div>";
  const lines = [...drawn].reverse().map((item) => `<path d="${line(item.hand!.cycle.knee!, 360, 140, 40, 190)}" fill="none" stroke="${item.colour}" stroke-width="2.2"/>`).join("");
  return `<div><h3>Knees through one stroke</h3><p class="rvs-small">a rough guide only, never scored</p>
    <svg class="rvs-svg" width="410" height="170" viewBox="0 0 410 170" role="img" aria-label="Knee angle through the stroke for each rower"><g transform="translate(40,6)">
    <line x1="0" y1="${yOf(180, 140, 40, 190).toFixed(0)}" x2="360" y2="${yOf(180, 140, 40, 190).toFixed(0)}" stroke="${faint}"/><line x1="0" y1="${yOf(90, 140, 40, 190).toFixed(0)}" x2="360" y2="${yOf(90, 140, 40, 190).toFixed(0)}" stroke="${faint}"/>${lines}
    <text x="-6" y="${(yOf(180, 140, 40, 190) + 4).toFixed(0)}" fill="${soft}" text-anchor="end">180°</text><text x="-6" y="${(yOf(90, 140, 40, 190) + 4).toFixed(0)}" fill="${soft}" text-anchor="end">90°</text>
    <text x="0" y="158" fill="${soft}">Catch</text><text x="360" y="158" fill="${soft}" text-anchor="end">Next catch</text></g></svg></div>`;
}

const FADES: { name: string; label: string; places: number; unit: string }[] = [
  { name: "catch_lean_deg", label: "Catch lean", places: 1, unit: "°" },
  { name: "finish_lean_deg", label: "Finish lean", places: 1, unit: "°" },
  { name: "body_swing_deg", label: "Body swing", places: 1, unit: "°" },
  { name: "catch_knee_deg", label: "Catch knee", places: 1, unit: "°" },
  { name: "ratio", label: "Recovery ÷ drive", places: 2, unit: "" },
  { name: "stroke_length", label: "Stroke length", places: 2, unit: "" },
];

function fadeTable(stats: Stats): string {
  const { rowers } = stats;
  const kept = FADES.filter((fade) => rowers.some((item) => typeof item.rower.fade?.[fade.name] === "number"));
  if (kept.length === 0) return `<div class="rvs-box"><h3>First half against second half</h3><p class="rvs-small">The clip is too short to compare its two halves.</p></div>`;
  const cell = (item: StatsRower, fade: (typeof FADES)[number]) => {
    const change = item.rower.fade?.[fade.name];
    if (typeof change !== "number") return `<div>—</div>`;
    const big = fade.unit === "°" ? Math.abs(change) >= 3 : false;
    return `<div${big ? ` class="rvs-bold"` : ""}>${change > 0 ? "+" : ""}${fixed(change, fade.places)}${fade.unit}</div>`;
  };
  const biggest = rowers.flatMap((item) => kept.filter((fade) => fade.unit === "°").map((fade) => ({ item, fade, change: item.rower.fade?.[fade.name] })))
    .filter((row): row is { item: StatsRower; fade: (typeof FADES)[number]; change: number } => typeof row.change === "number").sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const note = biggest && Math.abs(biggest.change) >= 3 ? `${biggest.item.name}'s ${biggest.fade.label.toLowerCase()} changed most: ${biggest.change > 0 ? "+" : ""}${fixed(biggest.change)}° in the second half.` : "No big changes between the two halves.";
  return `<div class="rvs-box"><h3>First half against second half</h3><p class="rvs-small">how each rower changed through the piece</p>
    <div class="rvs-fade rvs-n${rowers.length}"><div></div>${rowers.map((item) => `<div class="rvs-t${item.tone} rvs-bold">${escape(item.name)}</div>`).join("")}
    ${kept.map((fade) => `<div>${fade.label}</div>${rowers.map((item) => cell(item, fade)).join("")}`).join("")}</div><p class="rvs-small">${escape(note)}</p></div>`;
}

function timingBars(stats: Stats): string {
  const timed = stats.rowers.filter((item) => item.rower.timing && (item.rower.timing.catch_ms !== null || item.rower.timing.finish_ms !== null));
  if (timed.length === 0) return "";
  const most = Math.max(50, ...timed.flatMap((item) => [Math.abs(item.rower.timing!.catch_ms ?? 0), Math.abs(item.rower.timing!.finish_ms ?? 0)]));
  const half = 150;
  const scale = half / most;
  const step = 34;
  const bar = (ms: number | null, y: number, colour: string, faded: boolean) => {
    if (ms === null) return "";
    const width = Math.abs(ms) * scale;
    return `<rect x="${(ms < 0 ? half - width : half).toFixed(1)}" y="${y}" width="${Math.max(width, 1.5).toFixed(1)}" height="11" rx="3" fill="${colour}"${faded ? ` opacity="0.55"` : ""}/>`;
  };
  const rows = timed.map((item, index) => {
    const t = item.rower.timing!;
    const y = index * step;
    const words = (ms: number | null, spread: number | null) => (ms === null ? "—" : `${Math.round(Math.abs(ms))} ms ${ms < 0 ? "early" : "late"}${spread !== null ? ` · varies ±${Math.round(spread)}` : ""}`);
    return `<text x="-8" y="${y + 18}" fill="${item.colour}" text-anchor="end" font-weight="700">${escape(item.name)}</text>${bar(t.catch_ms, y + 2, item.colour, false)}${bar(t.finish_ms, y + 16, item.colour, true)}
      <text x="${half * 2 + 14}" y="${y + 11}" fill="${ink}">catch ${escape(words(t.catch_ms, t.catch_spread_ms))}</text><text x="${half * 2 + 14}" y="${y + 25}" fill="${soft}">finish ${escape(words(t.finish_ms, t.finish_spread_ms))}</text>`;
  }).join("");
  const height = timed.length * step + 22;
  return `<section><div class="rvs-title"><h3>Timing against ${escape(stats.leadName)}</h3><span>left = early · solid = catch, pale = finish · good to about 50 ms · not scored</span></div>
    <svg class="rvs-svg" width="706" height="${height}" viewBox="0 0 706 ${height}" role="img" aria-label="Catch and finish timing for each rower against the lead rower"><g transform="translate(90,2)">
    <line x1="${half}" y1="0" x2="${half}" y2="${timed.length * step}" stroke="#9fb3a7"/>${rows}
    <text x="0" y="${height - 6}" fill="${soft}">−${Math.round(most)} ms</text><text x="${half}" y="${height - 6}" fill="${soft}" text-anchor="middle">with ${escape(stats.leadName)}</text><text x="${half * 2}" y="${height - 6}" fill="${soft}" text-anchor="end">+${Math.round(most)} ms</text></g></svg></section>`;
}

function everyNumber(stats: Stats): string {
  const { rowers } = stats;
  const kept = MEASURES.filter((measure) => rowers.some((item) => metricOf(item.rower, measure.name)));
  const header = `<div class="rvs-th rvs-left">Measure</div>${rowers.map((item) => `<div class="rvs-th rvs-t${item.tone}">${escape(item.name)}</div>`).join("")}<div class="rvs-th">Target</div>`;
  const rows = kept.map((measure, index) => {
    const found = targetOf(rowers, measure.name);
    const zebra = index % 2 ? "rvs-zebra" : "";
    const shaded = zebra ? ` class="${zebra}"` : "";
    const cells = rowers.map((item) => {
      const metric = metricOf(item.rower, measure.name);
      const value = metric?.value;
      const outside = found && found.scored && typeof value === "number" && (value < found.target.low || value > (found.target.high ?? Infinity));
      return `<div class="${[zebra, outside ? "rvs-bold" : ""].filter(Boolean).join(" ")}">${typeof value === "number" ? escape(measure.show(value)) : "—"}</div>`;
    }).join("");
    return `<div${shaded}>${escape(measure.label)}</div>${cells}<div class="${[zebra, "rvs-soft"].filter(Boolean).join(" ")}">${escape(targetText(measure.name, found))}</div>`;
  }).join("");
  return `<section><h3>Every number</h3><div class="rvs-table rvs-n${rowers.length}">${header}${rows}</div></section>`;
}

function detailPages(stats: Stats): string[] {
  const top = `<div class="rvs-two">${rangePlot(stats, "catch_lean_deg", "Body angle at the catch")}${rangePlot(stats, "finish_lean_deg", "Body angle at the finish")}</div>
    <div class="rvs-two rvs-wide">${kneeOverlay(stats)}${fadeTable(stats)}</div>${timingBars(stats)}`;
  const note = "Bold = outside a scored target · — = could not be seen reliably · stroke length is hand travel in trunk lengths";
  if (stats.rowers.length <= 2) return [`<article class="rvs-sheet">${head("In detail", "", false)}${top}${everyNumber(stats)}${foot(note)}</article>`];
  return [
    `<article class="rvs-sheet">${head("In detail", "", false)}${top}${foot(note)}</article>`,
    `<article class="rvs-sheet">${head("Every number", "", false)}${everyNumber(stats)}${foot(note)}</article>`,
  ];
}

// ---- The power hand-over ----

const ms = (seconds: number) => `${seconds.toFixed(2)} s`;

/** What the hand-over shows, in plain sentences worked out from the numbers. */
export function handoverNotes(stats: Stats): { headline: string; lines: string[] } {
  const items = stats.rowers.filter((item) => item.hand && item.hand.strokes > 0);
  const lines: string[] = [];
  let headline = "";
  if (items.length === 0) return { headline: "The legs, back and arms could not be timed in this clip.", lines };
  // Compared by the middle of each movement, which is steadier than the moment it starts.
  const backs = items.filter((item) => item.hand!.boat.back).map((item) => ({ item, middle: item.hand!.boat.back!.middle }));
  if (backs.length >= 2) {
    const sorted = [...backs].sort((a, b) => a.middle - b.middle);
    const gap = sorted[sorted.length - 1].middle - sorted[0].middle;
    if (gap <= 0.04) lines.push(`In the boat the backs swing together: the middle of every swing is within ${Math.round(gap * 1000)} ms, about ${ms(sorted[0].middle)} after ${stats.leadName}'s catch.`);
    else lines.push(`${sorted[0].item.name}'s back swings first: the middle of the swing comes ${Math.round(gap * 1000)} ms before ${sorted[sorted.length - 1].item.name}'s.`);
  }
  const drives = items.filter((item) => item.hand!.driveS !== null).sort((a, b) => a.hand!.driveS! - b.hand!.driveS!);
  if (drives.length >= 2 && drives[drives.length - 1].hand!.driveS! - drives[0].hand!.driveS! >= 0.08) {
    const short = drives[0];
    const long = drives[drives.length - 1];
    const sentence = `${short.name}'s drive is shortest: ${ms(short.hand!.driveS!)} against ${ms(long.hand!.driveS!)} for ${long.name}.`;
    lines.push(sentence);
    const shortMiddle = short.hand!.middle;
    const longMiddle = long.hand!.middle;
    if (shortMiddle.back !== null && longMiddle.back !== null && shortMiddle.back + 0.04 < longMiddle.back) {
      headline = `${short.name}'s drive is squeezed: the back and arms come in sooner in the stroke.`;
    }
  }
  const arms = items.filter((item) => item.hand!.boat.arms && !item.hand!.armsRough).sort((a, b) => a.hand!.boat.arms!.middle - b.hand!.boat.arms!.middle);
  if (arms.length >= 2) {
    const gap = arms[arms.length - 1].hand!.boat.arms!.middle - arms[0].hand!.boat.arms!.middle;
    if (gap >= 0.06) lines.push(`${arms[0].name}'s arms come in ${ms(gap)} before ${arms[arms.length - 1].name}'s.`);
  }
  for (const item of items) {
    const { legs, back, arms: armsMiddle } = item.hand!.middle;
    if (legs !== null && back !== null && back < legs) lines.push(`${item.name}'s back moves before the legs have done most of their work.`);
    else if (back !== null && armsMiddle !== null && !item.hand!.armsRough && armsMiddle < back) lines.push(`${item.name}'s arms move before the back has swung.`);
    const reach = metricOf(item.rower, "catch_lean_deg");
    const layback = metricOf(item.rower, "finish_lean_deg");
    if (typeof reach?.value === "number" && reach.target && typeof layback?.value === "number" && layback.target && reach.value < reach.target.low && layback.value < layback.target.low) {
      lines.push(`${item.name} reaches only ${deg(reach.value)} at the catch and leans back to ${deg(layback.value)}, so most of the swing comes late in the drive.`);
    }
  }
  if (items.length === 1) {
    const hand = items[0].hand!;
    if (hand.middle.legs !== null && hand.middle.back !== null && hand.middle.arms !== null) {
      lines.unshift(`The middle of the legs, back and arms come at ${pct(hand.middle.legs)}, ${pct(hand.middle.back)} and ${pct(hand.middle.arms)} of the drive.`);
    }
    if (hand.backOpensShare !== null) lines.push(`The back starts to open ${pct(hand.backOpensShare)} into the drive, with the legs ${pct(hand.legsWhenBackOpens)} down.`);
  }
  if (!headline) {
    const inOrder = items.every((item) => {
      const { legs, back, arms: a } = item.hand!.middle;
      return legs !== null && back !== null && legs < back && (a === null || item.hand!.armsRough || back < a);
    });
    headline = inOrder ? `Legs, then back, then arms${items.length > 1 ? " for every rower" : ""}.` : lines[0] ?? "How the drive is handed from legs to back to arms.";
  }
  return { headline, lines: lines.filter((text) => text !== headline).slice(0, 4) };
}

function drivePanel(item: StatsRower, width = 340): string {
  const hand = item.hand;
  const W = width - 44;
  const H = 140;
  if (!hand) return `<div><h4 class="rvs-t${item.tone}">${escape(item.name)}</h4><p class="rvs-small">Could not be timed.</p></div>`;
  const lines = PARTS.map((part) => {
    const values = hand.drive[part];
    if (!values) return "";
    const rough = part === "arms" && hand.armsRough;
    return `<path d="${line(values, W, H, 0, 1)}" fill="none" stroke="${PART_COLOURS[part]}" stroke-width="2.5"${rough ? ` stroke-dasharray="6 3"` : ""}/>`;
  }).join("");
  const opens = hand.backOpensShare;
  const opensLine = opens === null ? "" : `<line x1="${(opens * W).toFixed(1)}" y1="0" x2="${(opens * W).toFixed(1)}" y2="${H}" stroke="${PART_COLOURS.back}" stroke-dasharray="3 3"/><text x="${(opens * W + 4).toFixed(1)}" y="12" fill="${PART_COLOURS.back}">back opens, ${pct(opens)}</text>`;
  const legsDone = hand.drive.legs ? hand.drive.legs.findIndex((value) => value >= 0.9) : -1;
  const under = hand.armsRough ? "dashed orange: arms hard to see on this side" : legsDone > 0 ? `legs done by ${pct(legsDone / (POINTS_OF(hand) - 1))} of the drive` : "";
  return `<div><h4 class="rvs-t${item.tone}">${escape(item.name)}</h4><svg class="rvs-svg" width="${width}" height="190" viewBox="0 0 ${width} 190" role="img" aria-label="${escape(item.name)}'s legs, back and arms through the drive">
    <g transform="translate(36,8)"><line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="${rule}"/><line x1="0" y1="0" x2="${W}" y2="0" stroke="${faint}"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="${faint}"/>${opensLine}${lines}
    <text x="-6" y="4" fill="${soft}" text-anchor="end">100%</text><text x="-6" y="${H + 4}" fill="${soft}" text-anchor="end">0</text>
    <text x="0" y="${H + 18}" font-weight="700" fill="${ink}">Catch</text><text x="${W}" y="${H + 18}" font-weight="700" fill="${ink}" text-anchor="end">Finish</text>
    <text x="${W / 2}" y="${H + 34}" fill="${soft}" text-anchor="middle">${escape(under)}</text></g></svg></div>`;
}

const POINTS_OF = (hand: Handover) => hand.drive.legs?.length ?? 41;

function boatTimeline(stats: Stats): string {
  const items = stats.rowers.filter((item) => item.hand && PARTS.some((part) => item.hand!.boat[part]));
  if (items.length === 0) return "";
  const times = items.flatMap((item) => [...PARTS.flatMap((part) => (item.hand!.boat[part] ? [item.hand!.boat[part]!.start, item.hand!.boat[part]!.done] : [])), item.hand!.finishS ?? 0]);
  const from = Math.min(0, Math.floor(Math.min(...times) * 5) / 5);
  const to = Math.max(1, Math.ceil(Math.max(...times) * 5) / 5);
  const left = 90;
  const W = 600;
  const x = (seconds: number) => left + ((seconds - from) / (to - from)) * W;
  const step = 58;
  const rows = items.map((item, index) => {
    const y = index * step + 4;
    const bars = PARTS.map((part, n) => {
      const span = item.hand!.boat[part];
      if (!span) return "";
      const rough = part === "arms" && item.hand!.armsRough;
      return `<rect x="${x(span.start).toFixed(1)}" y="${y + n * 14}" width="${Math.max(2, x(span.done) - x(span.start)).toFixed(1)}" height="10" rx="3" fill="${PART_COLOURS[part]}" opacity="${rough ? 0.4 : 0.85}"/>
        <circle cx="${x(span.middle).toFixed(1)}" cy="${y + n * 14 + 5}" r="4.5" fill="#fff" stroke="${PART_COLOURS[part]}" stroke-width="2"/>`;
    }).join("");
    const finish = item.hand!.finishS === null ? "" : `<line x1="${x(item.hand!.finishS).toFixed(1)}" y1="${y - 2}" x2="${x(item.hand!.finishS).toFixed(1)}" y2="${y + 42}" stroke="${ink}" stroke-width="2"/>`;
    return `<text x="0" y="${y + 24}" fill="${item.colour}" font-weight="700">${escape(item.name)}</text>${bars}${finish}`;
  }).join("");
  const ticks: string[] = [];
  for (let t = from; t <= to + 1e-6; t += 0.2) {
    ticks.push(`<line x1="${x(t).toFixed(1)}" y1="0" x2="${x(t).toFixed(1)}" y2="${items.length * step - 6}" stroke="${Math.abs(t) < 1e-6 ? rule : faint}"/><text x="${x(t).toFixed(1)}" y="${items.length * step + 10}" fill="${soft}" text-anchor="middle">${Math.abs(t) < 1e-6 ? "0" : `${minus(t.toFixed(1))} s`}</text>`);
  }
  const height = items.length * step + 28;
  return `<section><div class="rvs-title"><h3>In the boat: when each part moves, from ${escape(stats.leadName)}'s catch</h3><span>bar = moving · dot = middle · | = finish</span></div>
    <svg class="rvs-svg" width="706" height="${height}" viewBox="0 0 706 ${height}" role="img" aria-label="When each rower's legs, back and arms move, in seconds after the lead rower's catch">${ticks.join("")}${rows}
    <text x="${x(0).toFixed(1)}" y="${height - 2}" fill="${soft}">${escape(stats.leadName)}'s catch</text></svg></section>`;
}

function backStrip(stats: Stats): string {
  const items = stats.rowers.filter((item) => item.hand && item.hand.backOpens.length);
  if (items.length === 0) return "";
  const most = Math.max(0.5, ...items.flatMap((item) => item.hand!.backOpens.map((open) => open.share + 0.05)));
  const W = 300;
  const x = (share: number) => ((share / most) * W).toFixed(1);
  const step = 38;
  const rows = items.map((item, index) => {
    const y = index * step + 16;
    const dots = item.hand!.backOpens.map((open, n) => `<circle cx="${x(open.share)}" cy="${y + ((n % 3) - 1) * 5}" r="5" fill="${item.colour}" opacity="0.75"/>`).join("");
    const middle = item.hand!.backOpensShare;
    return `<text x="-8" y="${y + 4}" fill="${item.colour}" text-anchor="end" font-weight="700">${escape(item.name)}</text>${dots}${middle === null ? "" : `<line x1="${x(middle)}" y1="${y - 14}" x2="${x(middle)}" y2="${y + 14}" stroke="${ink}" stroke-width="2"/>`}`;
  }).join("");
  const height = items.length * step + 28;
  const words = items.map((item) => `${item.name}: ${pct(item.hand!.backOpensShare)} in, legs ${pct(item.hand!.legsWhenBackOpens)} down${item.hand!.backOpensS !== null ? `, ${ms(item.hand!.backOpensS)} after the catch` : ""}.`).join(" ");
  return `<div><h3>When the back starts to open, stroke by stroke</h3><p class="rvs-small">share of the drive gone · line = typical</p>
    <svg class="rvs-svg" width="380" height="${height}" viewBox="0 0 380 ${height}" role="img" aria-label="Where in the drive the back starts to open, every stroke"><g transform="translate(62,4)">${rows}
    <line x1="0" y1="${items.length * step}" x2="${W}" y2="${items.length * step}" stroke="${rule}"/><text x="0" y="${items.length * step + 16}" fill="${soft}">0%</text><text x="${W / 2}" y="${items.length * step + 16}" fill="${soft}" text-anchor="middle">${pct(most / 2)}</text><text x="${W}" y="${items.length * step + 16}" fill="${soft}" text-anchor="end">${pct(most)}</text></g></svg>
    <p class="rvs-small">${escape(words)}</p></div>`;
}

/** The order coming forward, in a few words, from how far each part is a third of the way into the recovery. */
export function recoveryWords(hand: Handover): string {
  const reached = (part: Part) => (hand.recovery[part] ? hand.recovery[part]![Math.round(0.3 * (POINTS_OF(hand) - 1))] : null);
  const armsAt = reached("arms");
  const backAt = reached("back");
  if (armsAt === null || backAt === null) return "";
  return Math.abs(armsAt - backAt) < 0.1 ? "arms and back come over together" : armsAt > backAt ? "arms lead, then back, then slide" : "back moves before the arms";
}

function recoveryMinis(stats: Stats, columns: number): string {
  const items = stats.rowers.filter((item) => item.hand && PARTS.some((part) => item.hand!.recovery[part]));
  if (items.length === 0) return "";
  const minis = items.map((item) => {
    const hand = item.hand!;
    const lines = (["arms", "back", "legs"] as Part[]).map((part) => (hand.recovery[part] ? `<path d="${line(hand.recovery[part]!, 150, 56, 0, 1)}" fill="none" stroke="${PART_COLOURS[part]}" stroke-width="2.2"${part === "arms" && hand.armsRough ? ` stroke-dasharray="6 3"` : ""}/>` : "")).join("");
    const words = recoveryWords(hand);
    return `<div><h4 class="rvs-t${item.tone}">${escape(item.name)}</h4><svg class="rvs-svg" width="160" height="62" viewBox="0 0 160 62" aria-hidden="true"><g transform="translate(4,3)">${lines}</g></svg><p class="rvs-small">${escape(words)}</p></div>`;
  }).join("");
  return `<div><h3>Coming forward: arms, back, then legs</h3><p class="rvs-small">recovery, finish to next catch</p><div class="rvs-minis rvs-n${columns}">${minis}</div></div>`;
}

const partKey = () => key(PARTS.map((part) => ({ fill: `rvs-part-${part}`, name: PART_NAMES[part] })));

function handoverPages(stats: Stats): string[] {
  const { headline, lines } = handoverNotes(stats);
  const lead = `<div class="rvs-lead"><b>${escape(headline)}</b>${lines.map((text) => `<p>${escape(text)}</p>`).join("")}</div>`;
  const driveIntro = `<div class="rvs-title"><h3>The drive, as a share of each rower's own drive</h3>${partKey()}</div><p class="rvs-small">Each line climbs from 0 at the catch to 100% when that part has done its movement. Good hand-over: green, then purple, then orange.</p>`;
  const caveat = "Median of each rower's strokes. Measured from body angles, not force: it shows when each part moves, not how hard.";
  const header = head("Power hand-over", "How each rower passes the drive from legs to back to arms, and the order coming forward", false);
  if (stats.rowers.length <= 2) {
    return [`<article class="rvs-sheet">${header}${lead}<section>${driveIntro}<div class="rvs-two">${stats.rowers.map((item) => drivePanel(item)).join("")}</div></section>
      ${boatTimeline(stats)}<div class="rvs-two rvs-split">${backStrip(stats)}${recoveryMinis(stats, 1)}</div>${foot(caveat)}</article>`];
  }
  const panels: string[] = [];
  for (let start = 0; start < stats.rowers.length; start += 8) {
    panels.push(`<article class="rvs-sheet">${head("Power hand-over, rower by rower", "", false)}<section>${driveIntro}<div class="rvs-panels">${stats.rowers.slice(start, start + 8).map((item) => drivePanel(item, 340)).join("")}</div></section>${foot(caveat)}</article>`);
  }
  return [
    `<article class="rvs-sheet">${header}${lead}${boatTimeline(stats)}<div class="rvs-two rvs-split">${backStrip(stats)}${recoveryMinis(stats, 2)}</div>${foot(caveat)}</article>`,
    ...panels,
  ];
}

// ---- The whole report ----

export function statsPages(stats: Stats): string[] {
  if (stats.rowers.length === 0) return [];
  const pages = [overviewPage(stats), ...detailPages(stats), ...handoverPages(stats)];
  return pages.map((page, index) => page.replace(`<span class="rvs-page">RowVision</span>`, `<span class="rvs-page">RowVision · page ${index + 1} of ${pages.length}</span>`));
}

export function statsDocument(stats: Stats, css: string, fonts: { family: string; src: string }[]): string {
  const faces = fonts.map(({ family, src }) => `@font-face{font-family:"${family}";src:url(${src}) format("woff2");font-weight:100 1000;font-display:block}`).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escape(stats.title)}</title><style>${faces}html,body{margin:0;padding:0}${css}</style></head>`
    + `<body class="rvs-doc">${statsPages(stats).join("")}</body></html>`;
}
