import { expect, test } from "vitest";
import type { Rower } from "@/lib/result";
import { escape, framesFor, inside, pageCount, reportDocument, reportPages, reportRower, rowerTitle, type Report } from "../../src/renderer/report";

const target = { low: 26, high: 31, sources: [], evidence: "Test." };
function rower(seat: number, strokes: number): Rower {
  return {
    seat, rate_spm: 30, catches: [], finishes: [], timing: null,
    strokes: Array.from({ length: strokes }, (_, n) => ({ catch_frame: 10 + n * 30, finish_frame: 25 + n * 30, catch_lean_deg: 28, finish_lean_deg: -40, catch_knee_deg: null })),
    card: { overall: 81.6, phases: {}, metrics: [
      { name: "catch_lean_deg", label: "Body angle at the catch", phase: "catch", value: 28, spread: 1, target, score: 90, reason: null },
      { name: "finish_lean_deg", label: "Layback at the finish", phase: "finish", value: -40, spread: 1, target: { ...target, low: -25, high: -20 }, score: 40, reason: null },
    ] },
    rating: { accuracy: 76, band: "Good", calibrated: true, labelled_frames: 100, warnings: [] },
  };
}

test("a reading is inside its target only when there is a target and a value", () => {
  expect(inside(28, target)).toBe(true);
  expect(inside(32, target)).toBe(false);
  expect(inside(null, target)).toBeNull();
  expect(inside(28, null)).toBeNull();
  expect(inside(90, { low: 50, high: null })).toBe(true);
});

test("each seat is named, with the ends of the boat and the athlete marked", () => {
  expect(rowerTitle(rower(4, 1), 4, 2)).toEqual({ title: "Seat 4", note: "Stroke seat" });
  expect(rowerTitle(rower(1, 1), 4, 2)).toEqual({ title: "Seat 1", note: "Bow seat" });
  expect(rowerTitle(rower(2, 1), 4, 2)).toEqual({ title: "Seat 2", note: "you" });
  expect(rowerTitle(rower(1, 1), 1, 1)).toEqual({ title: "Single", note: "" });
});

test("every stroke gives a catch and a finish, with each number against its target", () => {
  const item = reportRower(rower(2, 3), 30, 2, 2);
  expect(item.overall).toBe(82);
  expect(item.strokes.map((stroke) => [stroke.n, stroke.catch.frame, stroke.finish.frame])).toEqual([[1, 10, 25], [2, 40, 55], [3, 70, 85]]);
  const [body, knee] = item.strokes[0].catch.numbers;
  expect(body).toMatchObject({ label: "Body", text: "28° forward", inside: true, target: "26–31° forward" });
  expect(knee).toMatchObject({ label: "Knee", text: "not measured", inside: null, target: null });
  expect(item.strokes[0].finish.numbers[0]).toMatchObject({ text: "40° back", inside: false });
  expect(framesFor(item)).toEqual([10, 25, 40, 55, 70, 85]);
});

test("a poor rating gives no overall in the report", () => {
  const poor = rower(1, 1);
  poor.rating = { ...poor.rating, band: "Poor" };
  expect(reportRower(poor, 30, 1, 1).overall).toBeNull();
});

test("each layout fits its own number of strokes on a page, for every rower", () => {
  const report: Report = { heading: "Quad (4x), Friday 20 November", rowers: [reportRower(rower(1, 9), 30, 4, 1), reportRower(rower(2, 4), 30, 4, 1)] };
  expect(pageCount("contact", report.rowers)).toBe(3 + 1);
  expect(pageCount("frames", report.rowers)).toBe(3 + 2);
  expect(pageCount("summary", report.rowers)).toBe(2 + 1);
  expect(pageCount("stroke", report.rowers)).toBe(9 + 4);
  for (const layout of ["contact", "frames", "summary", "stroke"] as const) {
    expect(reportPages(layout, report, {})).toHaveLength(pageCount(layout, report.rowers));
  }
});

test("the summary layout gives the averages once, on each rower's first page", () => {
  const report: Report = { heading: "Pair", rowers: [reportRower(rower(1, 9), 30, 2, 1)] };
  const pages = reportPages("summary", report, {});
  expect(pages[0]).toContain("rvr-stats");
  expect(pages[1]).not.toContain("rvr-stats");
});

test("pictures go on the page by rower and frame, and text is escaped", () => {
  const item = reportRower(rower(1, 1), 30, 1, 1);
  const report: Report = { heading: "<Pair> & co", rowers: [item] };
  const page = reportPages("contact", report, { [item.key]: { 10: "data:image/jpeg;base64,AAA" } })[0];
  expect(page).toContain('<img src="data:image/jpeg;base64,AAA" alt="">');
  expect(page).toContain("&lt;Pair&gt; &amp; co");
  expect(escape(`"it's"`)).toBe("&quot;it&#39;s&quot;");
});

test("the PDF document carries its own styles and fonts, and loads nothing else", () => {
  const report: Report = { heading: "Pair", rowers: [reportRower(rower(1, 2), 30, 2, 1)] };
  const html = reportDocument("stroke", report, {}, ".rvr-sheet{color:red}", [{ family: "DM Sans Variable", src: "data:font/woff2;base64,AAAA" }]);
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('@font-face{font-family:"DM Sans Variable";src:url(data:font/woff2;base64,AAAA)');
  expect(html).toContain(".rvr-sheet{color:red}");
  expect(html.match(/<article/g)).toHaveLength(2);
  expect(html).not.toMatch(/(src|href)="(https?:|file:)/);
});
