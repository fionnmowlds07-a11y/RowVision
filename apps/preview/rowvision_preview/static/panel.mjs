// Draws the rating, scores and evidence panel. Actions come back through the handlers it is given.
import {
  evidenceFrames,
  formatTarget,
  formatValue,
  measureKind,
  median,
  overallVisible,
  sourceLink,
} from "./logic.mjs";

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
  block.append(
    element("span", "rating-value", `${Math.round(rating.accuracy)}%`),
    element("span", "rating-band", rating.band),
    element(
      "span",
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
    block.append(element("span", "muted", "No overall score: nothing could be measured reliably."));
  } else if (overallVisible(rower.rating, revealed)) {
    block.append(element("span", "overall-value", String(Math.round(overall))));
    block.append(element("span", "muted", "Overall score"));
    if (rower.rating.band === "Poor") {
      block.append(element("span", "caution", "Likely to be misleading on this footage"));
    }
  } else {
    const button = element("button", null, "Show score anyway");
    button.type = "button";
    button.addEventListener("click", onReveal);
    block.append(element("span", "muted", "Overall score hidden, as the accuracy is Poor."), button);
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
      element("span", "muted", label),
    );
    block.append(item);
  }
  return block;
}

function metricRow(metric, active, onOpen) {
  const row = element("tr", metric.name === active ? "active" : "");
  const name = element("td");
  const button = element("button", "link", metric.label);
  button.type = "button";
  button.setAttribute("aria-expanded", String(metric.name === active));
  button.addEventListener("click", () => onOpen(metric));
  name.append(button);
  const score = metric.score === null ? "Not scored" : String(Math.round(metric.score));
  row.append(
    name,
    element("td", "", formatValue(metric.name, metric.value)),
    element("td", "", formatTarget(metric.name, metric.target)),
    element("td", metric.score === null ? "muted" : "", score),
  );
  return row;
}

function metricsTable(metrics, active, onOpen) {
  const table = element("table", "metrics");
  const head = element("tr");
  for (const title of ["Measure", "You", "Target", "Score"]) head.append(element("th", "", title));
  const thead = element("thead");
  thead.append(head);
  const body = element("tbody");
  body.append(...metrics.map((metric) => metricRow(metric, active, onOpen)));
  table.append(thead, body);
  return table;
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
  block.append(element("h3", "", metric.label));
  if (metric.reason) block.append(element("p", "caution", metric.reason));
  if (metric.spread !== null && metric.spread !== undefined) {
    block.append(
      element("p", "muted", `Typical stroke-to-stroke spread: ${formatValue(metric.name, metric.spread).replace(/ (back|forward)$/, "")}`),
    );
  }
  if (metric.target) block.append(sources(metric.target));
  if (metric.name.endsWith("_deg")) {
    const model = element("button", null, "See this on the 3D model");
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
  const top = element("div", "score-top");
  top.append(
    ratingBlock(rower.rating),
    overallBlock(rower, state.revealed, handlers.onReveal),
    phaseBlock(rower.card),
  );
  container.replaceChildren(top, metricsTable(metrics, state.active, handlers.onOpen));
  const chosen = metrics.find((metric) => metric.name === state.active);
  if (chosen) container.append(evidenceBlock(chosen, rower, handlers));
}
