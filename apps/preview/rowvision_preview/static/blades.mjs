import { bladeCount, bladeSplit, canvasScaleFor, labelView, toVideoPoint, viewPoint } from "./logic.mjs";

const HANDS_COLOUR = "#22d3ee";
const BLADE_COLOUR = "#ffd23f";
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const context = canvas.getContext("2d");

let item = null;
let size = null; // Clip frame size in video pixels.
let canvasScale = 1;
let image = null;
let view = null;
let blade = null;
let saving = false; // A save in progress ignores extra presses.

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
  const scale = canvasScale * view.scale;
  context.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
  const unit = size.width / canvas.clientWidth / view.scale; // One screen pixel, at any clip size.
  context.lineWidth = 2 * unit;
  const [x, y] = item.top;
  context.fillStyle = HANDS_COLOUR;
  context.beginPath();
  context.moveTo(x, y - 26 * unit);
  context.lineTo(x - 10 * unit, y - 44 * unit);
  context.lineTo(x + 10 * unit, y - 44 * unit);
  context.closePath();
  context.fill();
  if (item.hands) {
    context.strokeStyle = HANDS_COLOUR;
    context.beginPath();
    context.arc(item.hands[0], item.hands[1], 10 * unit, 0, Math.PI * 2);
    context.stroke();
  }
  if (blade) {
    context.strokeStyle = BLADE_COLOUR;
    context.beginPath();
    context.moveTo(blade[0] - 9 * unit, blade[1]);
    context.lineTo(blade[0] + 9 * unit, blade[1]);
    context.moveTo(blade[0], blade[1] - 9 * unit);
    context.lineTo(blade[0], blade[1] + 9 * unit);
    context.stroke();
  }
}

function update() {
  $("prompt").textContent = !item
    ? "All frames labelled"
    : blade ? "Is the blade in the water?" : "Click this rower's blade";
  $("air").disabled = saving || !blade;
  $("water").disabled = saving || !blade;
  $("hidden").disabled = saving || !item;
  $("undo-frame").disabled = saving;
  draw();
}

async function showSummary() {
  const summary = await api("/api/blades/summary");
  $("count").textContent = bladeCount(summary);
  $("bar").max = summary.target;
  $("bar").value = Math.min(summary.usable, summary.target);
  $("split").textContent = bladeSplit(summary);
}

async function load() {
  showError("");
  const next = await api("/api/blades/next");
  item = next.item;
  blade = null;
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
  canvasScale = canvasScaleFor(size.width);
  canvas.width = size.width * canvasScale;
  canvas.height = size.height * canvasScale;
  view = labelView(item.centre, item.span, size.width, size.height);
  $("frame-note").textContent = `${item.clip}, frame ${item.frame}`;
  update();
}

async function run(action) {
  if (saving) return;
  saving = true;
  update();
  try {
    await action();
    saving = false;
    await load();
  } catch (error) {
    saving = false;
    update();
    showError(`That was not saved, so try again. ${error.message}`);
  }
}

function submit(state) {
  if (!item || (state !== "hidden" && !blade)) return;
  run(() => api("/api/blades", { id: item.id, blade: state === "hidden" ? null : blade, state }));
}

canvas.addEventListener("click", (event) => {
  if (!view || saving) return;
  const point = toVideoPoint(
    event.clientX, event.clientY, canvas.getBoundingClientRect(), size.width, size.height,
  );
  const spot = viewPoint(view, point);
  blade = [Math.round(spot.x * 10) / 10, Math.round(spot.y * 10) / 10];
  update();
});

$("air").addEventListener("click", () => submit("air"));
$("water").addEventListener("click", () => submit("water"));
$("hidden").addEventListener("click", () => submit("hidden"));
$("undo-frame").addEventListener("click", () => run(() => api("/api/blades/undo", {})));

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "a") submit("air");
  else if (key === "w") submit("water");
  else if (key === "s") submit("hidden");
  else if (key === "z") run(() => api("/api/blades/undo", {}));
  else return;
  event.preventDefault();
});

load().catch((error) => showError(`Could not load frames to label. ${error.message}`));
