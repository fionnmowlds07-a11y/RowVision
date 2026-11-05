// Draws the rating, scores and evidence panel. Actions come back through the handlers it is given.
import {
  evidenceFrames,
  formatTarget,
  formatValue,
  laneMarks,
  measureKind,
  median,
  overallVisible,
  sourceLink,
} from "./logic.mjs";

const MIN_STROKES = 3;
const PHASES = [
  ["catch", "Catch"],
  ["drive", "Drive"],
  ["finish", "Finish"],
  ["rhythm", "Rhythm"],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ratingBlock(rating) {
  const block = element("div", `rating band-${rating.band.toLowerCase()}`);
  const line = element("div", "rating-line");
  line.append(
    element("span", "rating-value", `${Math.round(rating.accuracy)}%`),
    element("span", "rating-band", rating.band),
  );
  block.append(
    line,
    element(
      "p",
      "rating-note",
      rating.calibrated
        ? "Estimated accuracy"
        : "Estimated accuracy, not yet checked against hand-labelled footage",
    ),
  );
  return block;
}

function overallBlock(rower, revealed, onReveal) {
  const block = element("div", "overall");
  const { overall } = rower.card;
  if (overall === null) {
    const reason = rower.strokes.length < MIN_STROKES
      ? `No overall score: it needs at least ${MIN_STROKES} full strokes.`
      : "No overall score: nothing could be measured reliably.";
    block.append(element("p", "overall-text", reason));
  } else if (overallVisible(rower.rating, revealed)) {
    const text = element("p", "overall-text", "Overall score");
    if (rower.rating.band === "Poor") {
      text.append(element("span", "caution-tag", "Likely to be misleading on this footage"));
    }
    block.append(element("span", "overall-bubble", String(Math.round(overall))), text);
  } else {
    const button = element("button", null, "Show score anyway");
    button.type = "button";
    button.addEventListener("click", onReveal);
    block.append(element("p", "overall-text", "Overall score hidden, as the accuracy is Poor."), button);
  }
  return block;
}

function phaseBlock(card) {
  const block = element("div", "phases");
  for (const [key, label] of PHASES) {
    const score = card.phases[key];
    const item = element("div", "phase");
    item.append(
      element("span", "phase-value", score === undefined ? "–" : String(Math.round(score))),
      element("span", "phase-name", label),
    );
    block.append(item);
  }
  return block;
}

function miniLane(metric) {
  const marks = laneMarks(metric.value, metric.target);
  if (!marks) return null;
  const lane = element("span", "mini-lane");
  lane.setAttribute("aria-hidden", "true");
  const band = element("span", "mini-band");
  band.style.left = `${marks.bandStart}%`;
  band.style.width = `${marks.bandWidth}%`;
  const buoy = element("span", "mini-buoy");
  buoy.style.left = `${marks.buoy}%`;
  lane.append(band, buoy);
  return lane;
}

function measureItem(metric, active, rower, handlers) {
  const open = metric.name === active;
  const item = element("li", open ? "measure open" : "measure");
  const row = element("button", "measure-row");
  row.type = "button";
  row.setAttribute("aria-expanded", String(open));
  row.addEventListener("click", () => handlers.onOpen(metric));
  const scored = metric.score !== null;
  const detail = element("span", "measure-detail");
  detail.append(
    element("span", "", `You ${formatValue(metric.name, metric.value)}`),
    element("span", "", metric.target ? `Target ${formatTarget(metric.name, metric.target)}` : "No target yet"),
  );
  row.append(
    element("span", "measure-name", metric.label),
    element("span", scored ? "measure-score" : "measure-score none", scored ? String(Math.round(metric.score)) : "Not scored"),
    detail,
  );
  const lane = miniLane(metric);
  if (lane) row.append(lane);
  item.append(row);
  if (open) item.append(evidenceBlock(metric, rower, handlers));
  return item;
}

// Elbow angle has no target, but the athlete should still see it.
function elbowMetric(rower) {
  return {
    name: "finish_elbow_deg",
    label: "Elbow at the finish",
    phase: "finish",
    value: median(rower.strokes.map((stroke) => stroke.finish_elbow_deg)),
    spread: null,
    target: null,
    score: null,
    reason: "No published target yet.",
  };
}

function sources(target) {
  const list = element("p", "muted");
  list.append("Target from: ");
  target.sources.forEach((source, index) => {
    const { href, label } = sourceLink(source);
    const link = element("a", "", label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    if (index) list.append(", ");
    list.append(link);
  });
  list.append(`. Evidence: ${target.evidence}.`);
  return list;
}

function evidenceBlock(metric, rower, handlers) {
  const block = element("div", "evidence");
  if (metric.reason) block.append(element("p", "caution-note", metric.reason));
  if (metric.spread !== null && metric.spread !== undefined) {
    block.append(
      element("p", "muted", `Typical stroke-to-stroke spread: ${formatValue(metric.name, metric.spread).replace(/ (back|forward)$/, "")}`),
    );
  }
  if (metric.target) block.append(sources(metric.target));
  if (metric.name.endsWith("_deg")) {
    const model = element("button", "model-button", "See this on the 3D model");
    model.type = "button";
    model.addEventListener("click", () => handlers.onModel(metric));
    block.append(model);
  }
  const strip = element("div", "strip");
  for (const item of evidenceFrames(metric.name, rower.strokes)) {
    const figure = element("button", "freeze");
    figure.type = "button";
    figure.title = `Open frame ${item.frame}`;
    const canvas = element("canvas");
    canvas.width = 240;
    canvas.height = 180;
    figure.append(
      canvas,
      element("span", "", `Stroke ${item.stroke}: ${formatValue(metric.name, item.value)}`),
    );
    figure.addEventListener("click", () => handlers.onFrame(item.frame));
    strip.append(figure);
    handlers.onFreeze(canvas, item.frame, measureKind(metric.name));
  }
  block.append(strip);
  return block;
}

export function renderPanel(container, rower, state, handlers) {
  const metrics = [...rower.card.metrics, elbowMetric(rower)];
  const headline = element("div", "headline");
  headline.append(ratingBlock(rower.rating), overallBlock(rower, state.revealed, handlers.onReveal));
  const list = element("ul", "measures");
  list.append(...metrics.map((metric) => measureItem(metric, state.active, rower, handlers)));
  const notes = element("ul", "rating-notes");
  notes.append(...rower.rating.warnings.map((text) => element("li", "", text)));
  const parts = rower.rating.warnings.length ? [headline, notes] : [headline];
  container.replaceChildren(...parts, phaseBlock(rower.card), list);
}
