import {
  JOINT_ORDER,
  jointName,
  labelCount,
  labelResults,
  labelView,
  nextJoint,
  toVideoPoint,
  viewPoint,
} from "./logic.mjs";

const SCALE = 2;
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const context = canvas.getContext("2d");

let item = null;
let size = null; // Clip frame size in video pixels.
let image = null;
let view = null;
let clicks = {};
let order = []; // Joints in the order they were answered, for undo.

async function api(path, body) {
  const response = await fetch(path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function draw() {
  if (!image) return;
  const scale = SCALE * view.scale;
  context.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
  const unit = 1 / view.scale;
  context.font = `${13 * unit}px Rubik, sans-serif`;
  context.lineWidth = 2 * unit;
  JOINT_ORDER.forEach((name, index) => {
    const point = clicks[name];
    if (!point) return;
    context.strokeStyle = "#ffd23f";
    context.beginPath();
    context.moveTo(point[0] - 8 * unit, point[1]);
    context.lineTo(point[0] + 8 * unit, point[1]);
    context.moveTo(point[0], point[1] - 8 * unit);
    context.lineTo(point[0], point[1] + 8 * unit);
    context.stroke();
    context.fillStyle = "#ffd23f";
    context.fillText(String(index + 1), point[0] + 7 * unit, point[1] - 6 * unit);
  });
}

function update() {
  const current = nextJoint(clicks);
  $("prompt").textContent = item
    ? current ? `Click the ${jointName(current)}` : "All done on this frame"
    : "All frames labelled";
  $("joints").replaceChildren(...JOINT_ORDER.map((name) => {
    const entry = document.createElement("li");
    entry.className = name === current ? "current" : "";
    const answer = name in clicks ? (clicks[name] ? "Placed" : "Can't see") : "";
    entry.textContent = jointName(name);
    if (answer) {
      const tag = document.createElement("span");
      tag.textContent = answer;
      entry.append(" ", tag);
    }
    return entry;
  }));
  $("save").disabled = !item || current !== null;
  $("hidden").disabled = !item || current === null;
  $("undo-click").disabled = order.length === 0;
  $("skip").disabled = !item;
  draw();
}

async function showSummary() {
  const summary = await api("/api/labels/summary");
  $("count").textContent = labelCount(summary);
  $("bar").max = summary.target;
  $("bar").value = Math.min(summary.labelled, summary.target);
  const text = labelResults(summary);
  $("results").hidden = !text;
  $("results-text").textContent = text;
}

async function load() {
  showError("");
  const next = await api("/api/labels/next");
  item = next.item;
  clicks = {};
  order = [];
  await showSummary();
  if (!item) {
    image = null;
    $("frame-note").textContent = "";
    $("guide").hidden = true;
    update();
    return;
  }
  const name = encodeURIComponent(item.clip);
  size = await api(`/api/clips/${name}`);
  const picture = new Image();
  await new Promise((resolve, reject) => {
    picture.onload = resolve;
    picture.onerror = () => reject(new Error("This frame could not be read."));
    picture.src = `/api/clips/${name}/frames/${item.frame}.jpg`;
  });
  image = picture;
  canvas.width = size.width * SCALE;
  canvas.height = size.height * SCALE;
  view = labelView(item.centre, item.span, size.width, size.height);
  $("frame-note").textContent = `${item.clip}, frame ${item.frame}`;
  update();
}

function answer(value) {
  const current = nextJoint(clicks);
  if (!item || !current) return;
  clicks[current] = value;
  order.push(current);
  update();
}

function undoClick() {
  const last = order.pop();
  if (last) delete clicks[last];
  update();
}

async function submit(joints) {
  try {
    await api("/api/labels", { id: item.id, joints });
    await load();
  } catch (error) {
    showError(error.message);
  }
}

canvas.addEventListener("click", (event) => {
  if (!view) return;
  const point = toVideoPoint(
    event.clientX, event.clientY, canvas.getBoundingClientRect(), size.width, size.height,
  );
  const spot = viewPoint(view, point);
  answer([Math.round(spot.x * 10) / 10, Math.round(spot.y * 10) / 10]);
});

$("hidden").addEventListener("click", () => answer(null));
$("undo-click").addEventListener("click", undoClick);
$("save").addEventListener("click", () => submit(clicks));
$("skip").addEventListener("click", () => {
  submit(Object.fromEntries(JOINT_ORDER.map((name) => [name, null])));
});
$("undo-frame").addEventListener("click", async () => {
  try {
    await api("/api/labels/undo", {});
    await load();
  } catch (error) {
    showError(error.message);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "s") answer(null);
  else if (key === "z") undoClick();
  else if (key === "enter" && !$("save").disabled) submit(clicks);
  else return;
  event.preventDefault();
});

load().catch((error) => showError(`Could not load frames to label. ${error.message}`));
