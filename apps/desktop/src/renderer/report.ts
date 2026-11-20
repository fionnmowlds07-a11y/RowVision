// The PDF report: every rower at every catch and finish, laid out one of four ways.
// Everything here is plain data in, HTML text out, so it is the same in the preview and the PDF.
import { clipTime, formatTarget, formatValue } from "@/lib/logic";
import type { Metric, Rower, Target } from "@/lib/result";

export type Layout = "contact" | "frames" | "summary" | "stroke";

export const LAYOUTS: { id: Layout; name: string; about: string }[] = [
  { id: "contact", name: "Contact sheet", about: "White paper, a row for each stroke" },
  { id: "frames", name: "Big frames", about: "Dark, three strokes a page" },
  { id: "summary", name: "Report with summary", about: "Averages, then every catch and finish" },
  { id: "stroke", name: "One stroke per page", about: "Biggest pictures, with a table each" },
];

/** One number read at a catch or finish, and whether it is inside its target. */
export type Reading = { name: string; label: string; text: string; inside: boolean | null; target: string | null };
export type Moment = { kind: "catch" | "finish"; frame: number; time: string; numbers: Reading[] };
export type ReportStroke = { n: number; catch: Moment; finish: Moment };
export type ReportRower = { key: string; title: string; note: string; overall: number | null; stats: { label: string; text: string }[]; strokes: ReportStroke[] };
export type Report = { heading: string; rowers: ReportRower[] };
/** Each picture, by rower key and frame. */
export type Pictures = Record<string, Record<number, string>>;

const READ = {
  catch: [["catch_lean_deg", "Body"], ["catch_knee_deg", "Knee"], ["catch_elbow_deg", "Elbow"]],
  finish: [["finish_lean_deg", "Body"], ["finish_knee_deg", "Knee"], ["finish_elbow_deg", "Elbow"]],
} as const;
const AT = { catch: "at the catch", finish: "at the finish" };

const PER_PAGE: Record<Layout, number> = { contact: 4, frames: 3, summary: 6, stroke: 1 };

export function inside(value: number | null | undefined, target: Pick<Target, "low" | "high"> | null | undefined): boolean | null {
  if (value === null || value === undefined || !target) return null;
  return value >= target.low && value <= (target.high ?? Infinity);
}

/** The rower's title in the report: their seat, and who they are in the boat. */
export function rowerTitle(rower: Rower, seats: number, ownSeat: number | null): { title: string; note: string } {
  if (rower.seat === null) return { title: "Rower", note: "" };
  const where = seats > 1 && rower.seat === seats ? "Stroke seat" : seats > 1 && rower.seat === 1 ? "Bow seat" : "";
  const you = rower.seat === ownSeat && seats > 1 ? "you" : "";
  return { title: seats === 1 ? "Single" : `Seat ${rower.seat}`, note: [where, you].filter(Boolean).join(", ") };
}

/** The report's numbers for one rower, from their measured strokes. */
export function reportRower(rower: Rower, fps: number, seats: number, ownSeat: number | null): ReportRower {
  const metrics: Metric[] = [...rower.card.metrics, ...(rower.card.extras ?? [])];
  const metric = (name: string) => metrics.find((item) => item.name === name) ?? null;
  const moment = (kind: "catch" | "finish", frame: number, values: Record<string, number | null>): Moment => ({
    kind,
    frame,
    time: clipTime(frame, fps),
    numbers: READ[kind].map(([name, label]) => {
      const target = metric(name)?.target ?? null;
      return { name, label, text: formatValue(name, values[name]), inside: inside(values[name], target), target: target ? formatTarget(name, target) : null };
    }),
  });
  const stat = (label: string, name: string) => ({ label, text: metric(name)?.value === null || !metric(name) ? "–" : formatValue(name, metric(name)!.value) });
  return {
    key: String(rower.seat ?? "rower"),
    ...rowerTitle(rower, seats, ownSeat),
    overall: rower.card.overall === null || rower.rating.band === "Poor" ? null : Math.round(rower.card.overall),
    stats: [stat("Body at the catch", "catch_lean_deg"), stat("Layback at the finish", "finish_lean_deg"), stat("Knee at the catch", "catch_knee_deg")],
    strokes: rower.strokes.map((stroke, index) => ({ n: index + 1, catch: moment("catch", stroke.catch_frame, stroke), finish: moment("finish", stroke.finish_frame, stroke) })),
  };
}

/** Every frame a report needs a picture of. */
export function framesFor(rower: ReportRower): number[] {
  return [...new Set(rower.strokes.flatMap((stroke) => [stroke.catch.frame, stroke.finish.frame]))].sort((a, b) => a - b);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out.length ? out : [[]];
}

export function pageCount(layout: Layout, rowers: ReportRower[]): number {
  return rowers.reduce((sum, rower) => sum + chunks(rower.strokes, PER_PAGE[layout]).length, 0);
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const escape = (text: string) => text.replace(/[&<>"']/g, (mark) => ESCAPES[mark]);

const name = (moment: Moment, n: number) => `${moment.kind === "catch" ? "Catch" : "Finish"} ${n} · ${moment.time}`;
const mark = (reading: Reading) => (reading.inside === null ? "" : reading.inside ? "rvr-in" : "rvr-out");

function picture(pictures: Pictures, rower: ReportRower, moment: Moment, n: number): string {
  const src = pictures[rower.key]?.[moment.frame];
  const image = src ? `<img src="${escape(src)}" alt="">` : "";
  return `<div class="rvr-frame">${image}<span class="rvr-tag">${escape(name(moment, n))}</span></div>`;
}

function chips(moment: Moment): string {
  return `<div class="rvr-nums">${moment.numbers.filter((reading) => reading.text !== "not measured")
    .map((reading) => `<span class="${mark(reading)}">${escape(`${reading.label} ${reading.text}`)}</span>`).join("")}</div>`;
}

type Page = (rower: ReportRower, strokes: ReportStroke[], index: number, of: number) => string;

function pagesFor(layout: Layout, report: Report, pictures: Pictures): string[] {
  const head = (rower: ReportRower) => `<h3>${escape(rower.title)}</h3><div class="rvr-meta">${escape([rower.note, report.heading].filter(Boolean).join(" · "))}</div>`;
  const shot = (rower: ReportRower, moment: Moment, n: number) => picture(pictures, rower, moment, n);
  const range = (strokes: ReportStroke[], total: number) => (strokes.length ? `Strokes ${strokes[0].n}–${strokes[strokes.length - 1].n} of ${total}` : "No strokes measured");
  const page: Record<Layout, Page> = {
    contact: (rower, strokes, index, of) => `<article class="rvr-sheet rvr-a"><div class="rvr-top"><div>${head(rower)}</div><div class="rvr-meta">Page ${index + 1} of ${of}</div></div>
      <div class="rvr-grid"><span></span><span class="rvr-h">Catch</span><span class="rvr-h">Finish</span>
      ${strokes.map((stroke) => `<span class="rvr-n">${stroke.n}</span>${shot(rower, stroke.catch, stroke.n)}${shot(rower, stroke.finish, stroke.n)}`).join("")}</div>
      <div class="rvr-foot"><span>RowVision</span><span>${range(strokes, rower.strokes.length)}</span></div></article>`,
    frames: (rower, strokes, index, of) => `<article class="rvr-sheet rvr-b"><div class="rvr-top"><div>${head(rower)}</div>${rower.overall === null ? "" : `<span class="rvr-score">${rower.overall}</span>`}</div>
      ${strokes.map((stroke) => `<div class="rvr-pair"><h4>Stroke ${stroke.n}</h4><div class="rvr-duo">
        <div>${shot(rower, stroke.catch, stroke.n)}${chips(stroke.catch)}</div><div>${shot(rower, stroke.finish, stroke.n)}${chips(stroke.finish)}</div></div></div>`).join("")}
      <div class="rvr-foot"><span>Green inside the target, amber outside. RowVision</span><span>Page ${index + 1} of ${of}</span></div></article>`,
    summary: (rower, strokes, index, of) => {
      const top = index === 0
        ? `<div class="rvr-band"><div>${head(rower)}</div><div class="rvr-stats"><div><small>Overall</small><b>${rower.overall ?? "–"}</b></div>${rower.stats.map((item) => `<div><small>${escape(item.label)}</small><b>${escape(item.text)}</b></div>`).join("")}</div></div>`
        : `<div class="rvr-top"><div>${head(rower)}</div><div class="rvr-meta">Page ${index + 1} of ${of}</div></div>`;
      const rows = (kind: "catch" | "finish") => chunks(strokes, 3).map((row) => `<div class="rvr-row">${row.map((stroke) => shot(rower, stroke[kind], stroke.n)).join("")}</div>`).join("");
      return `<article class="rvr-sheet rvr-c">${top}<div class="rvr-body"><h4>Every catch</h4>${rows("catch")}<h4>Every finish</h4>${rows("finish")}
        <div class="rvr-foot"><span>RowVision</span><span>${range(strokes, rower.strokes.length)}</span></div></div></article>`;
    },
    stroke: (rower, strokes, index, of) => {
      const stroke = strokes[0];
      if (!stroke) return `<article class="rvr-sheet rvr-d"><div class="rvr-top"><div>${head(rower)}</div></div><p>No strokes measured.</p></article>`;
      const row = (reading: Reading, kind: "catch" | "finish") => `<tr><td>${escape(`${reading.label} ${AT[kind]}`)}</td><td class="${mark(reading)}">${escape(reading.text)}</td><td>${escape(reading.target ?? "No target")}</td></tr>`;
      return `<article class="rvr-sheet rvr-d"><div class="rvr-top"><div>${head(rower)}</div><div class="rvr-stroke">Stroke ${stroke.n}</div></div>
        ${shot(rower, stroke.catch, stroke.n)}${shot(rower, stroke.finish, stroke.n)}
        <table><tr><th>Measure</th><th>This stroke</th><th>Target</th></tr>${stroke.catch.numbers.map((reading) => row(reading, "catch")).join("")}${stroke.finish.numbers.map((reading) => row(reading, "finish")).join("")}</table>
        <div class="rvr-foot"><span>RowVision</span><span>Page ${index + 1} of ${of}</span></div></article>`;
    },
  };
  return report.rowers.flatMap((rower) => {
    const parts = chunks(rower.strokes, PER_PAGE[layout]);
    return parts.map((strokes, index) => page[layout](rower, strokes, index, parts.length));
  });
}

/** The pages of one layout, as HTML for the preview. */
export function reportPages(layout: Layout, report: Report, pictures: Pictures): string[] {
  return pagesFor(layout, report, pictures);
}

/** A whole HTML document for the PDF: the pages, their styles and the fonts, with nothing to load from anywhere. */
export function reportDocument(layout: Layout, report: Report, pictures: Pictures, css: string, fonts: { family: string; src: string }[]): string {
  const faces = fonts.map(({ family, src }) => `@font-face{font-family:"${family}";src:url(${src}) format("woff2");font-weight:100 1000;font-display:block}`).join("");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escape(report.heading)}</title><style>${faces}html,body{margin:0;padding:0}${css}</style></head>`
    + `<body class="rvr-doc">${pagesFor(layout, report, pictures).join("")}</body></html>`;
}
