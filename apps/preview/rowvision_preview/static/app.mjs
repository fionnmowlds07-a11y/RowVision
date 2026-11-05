import {
  FIT,
  angleMarks,
  arcBetween,
  boatAt,
  boatLabel,
  bodyCentre,
  centreOn,
  clampFrame,
  clampView,
  formatValue,
  limbSegments,
  nextMarker,
  openingFrame,
  resultSummary,
  seatOptions,
  shotAt,
  stageText,
  toVideoPoint,
  viewPoint,
  zoomAt,
} from "./logic.mjs";
import { renderPanel } from "./panel.mjs";

const POLL_MS = 500;
const PREFETCH_FRAMES = 6;
const SCALE = 2; // Canvas pixels per video pixel, so lines stay sharp when the page enlarges them.
const COLOURS = { left: "#22d3ee", right: "#e879f9", centre: "#fde047" };
const ANGLE_COLOUR = "#fde047";
const ZOOM_STEP = 1.5;
const ROWER_ZOOM = 5;
const FREEZE_SPAN = 120; // Video pixels across a freeze frame.
const SHOT_NAMES = {
  side_on: "side-on",
  oblique: "oblique",
  end_on: "end-on",
  no_rowing: "no rowing",
};

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const context = canvas.getContext("2d");

let boatSeats = {};
let boatSides = {};
let sideNames = {};
let clip = null; // { name, fps, frames, width, height }
let result = null;
let picker = null; // { boats, preview, chosen }
let frame = 0;
let image = null;
let requested = 0;
let pollTimer = null;
let stageName = null;
let stageStart = 0;
let view = FIT;
let panelState = { revealed: false, active: null };
const pointers = new Map();
let pinch = null;

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

const frameUrl = (index) =>
  `/api/clips/${encodeURIComponent(clip.name)}/frames/${index}.jpg`;

function fillSeats() {
  const options = seatOptions(boatSeats[$("boat-class").value]);
  $("seat").replaceChildren(...options.map(({ value, label }) => new Option(label, value)));
  const sides = boatSides[$("boat-class").value];
  $("side").replaceChildren(...sides.map((side) => new Option(sideNames[side], side)));
}

// After a reload, show the settings of the job the server still holds.
function fillForm(settings) {
  $("clip").value = settings.clip;
  $("boat-class").value = settings.boat_class;
  fillSeats();
  $("seat").value = settings.seat;
  $("side").value = settings.side;
  $("boats").value = settings.boats_in_video;
}

function hideResults() {
  for (const id of ["progress", "failed", "film-closer", "warnings", "picker", "stage-area", "viewer"]) {
    $(id).hidden = true;
  }
  $("form-error").hidden = true;
}

async function openClip(name) {
  if (clip?.name === name) return;
  clip = { name, ...(await api(`/api/clips/${encodeURIComponent(name)}`)) };
  canvas.width = clip.width * SCALE;
  canvas.height = clip.height * SCALE;
}

// Only the newest request draws, so holding an arrow key cannot leave an old frame under new lines.
function showFrame(index) {
  const ticket = ++requested;
  const next = new Image();
  next.onload = () => {
    if (ticket !== requested) return;
    image = next;
    draw();
  };
  next.onerror = () => {
    if (ticket === requested) $("readout").textContent = `Frame ${index} could not be read.`;
  };
  next.src = frameUrl(index);
}

function draw() {
  if (!image) return;
  const scale = SCALE * view.scale;
  context.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, clip.width, clip.height);
  if (picker) {
    drawBoats();
    return;
  }
  const pose = result?.rower?.poses[frame];
  if ($("show-lines").checked) drawPose(context, pose, 1 / view.scale);
  if ($("show-angles").checked) drawAngles(context, pose, frame, 1 / view.scale);
}

// `size` keeps lines and labels the same on screen at any zoom.
function drawPose(target, pose, size) {
  target.lineWidth = 1.5 * size;
  target.lineCap = "round";
  for (const { start, end, side, sure } of limbSegments(pose)) {
    target.strokeStyle = COLOURS[side];
    target.setLineDash(sure ? [] : [3 * size, 3 * size]);
    target.beginPath();
    target.moveTo(start[0], start[1]);
    target.lineTo(end[0], end[1]);
    target.stroke();
  }
  target.setLineDash([]);
}

function anglesAt(index) {
  const { trunk, knee, elbow } = result.rower.angles;
  return { trunk: trunk[index], knee: knee[index], elbow: elbow[index] };
}

function drawAngles(target, pose, index, size) {
  if (!pose) return;
  target.font = `${11 * size}px system-ui, sans-serif`;
  target.lineWidth = 1.5 * size;
  for (const item of angleMarks(pose, anglesAt(index))) {
    const { start, end, anticlockwise } = arcBetween(item);
    const { x, y } = item.vertex;
    target.strokeStyle = ANGLE_COLOUR;
    target.setLineDash(item.sure ? [] : [2 * size, 2 * size]);
    target.beginPath();
    target.arc(x, y, 12 * size, start, end, anticlockwise);
    target.stroke();
    target.setLineDash([]);
    const label = item.sure ? item.label : `${item.label}?`;
    const width = target.measureText(label).width + 6 * size;
    target.fillStyle = "rgba(0, 0, 0, 0.7)";
    target.fillRect(x + 14 * size, y - 14 * size, width, 15 * size);
    target.fillStyle = "#fff";
    target.fillText(label, x + 17 * size, y - 3 * size);
  }
}

function drawBoats() {
  context.font = "13px system-ui, sans-serif";
  const order = picker.boats.map((boat, index) => ({ boat, index }));
  // The chosen boat goes last, so its label stays readable where outlines overlap.
  order.sort((a, b) => (a.index === picker.chosen) - (b.index === picker.chosen));
  for (const { boat, index } of order) {
    if (boat.outline) drawBoat(boat, index);
  }
}

function drawBoat(boat, index) {
  const [x1, y1, x2, y2] = boat.outline;
  const chosen = index === picker.chosen;
  context.lineWidth = chosen ? 3 : 1.5;
  context.strokeStyle = chosen ? "#fde047" : boat.too_far ? "#94a3b8" : "#22d3ee";
  context.strokeRect(x1, y1, x2 - x1, y2 - y1);
  const label = boatLabel(boat, index + 1);
  const top = Math.max(y1 - 18, 0);
  context.fillStyle = "rgba(0, 0, 0, 0.7)";
  context.fillRect(x1, top, context.measureText(label).width + 8, 18);
  context.fillStyle = "#fff";
  context.fillText(label, x1 + 4, top + 14);
}

function prefetch(direction) {
  for (let step = 1; step <= PREFETCH_FRAMES; step += 1) {
    const index = frame + step * direction;
    if (index >= 0 && index < clip.frames) new Image().src = frameUrl(index);
  }
}

function markerName(index) {
  const rower = result?.rower;
  if (rower?.catches.includes(index)) return "catches";
  if (rower?.finishes.includes(index)) return "finishes";
  return null;
}

function updateReadout() {
  const rower = result?.rower;
  const seconds = (frame / clip.fps).toFixed(2);
  const parts = [`Frame ${frame} of ${clip.frames - 1}`, `about ${seconds} s`];
  const shot = result ? shotAt(result.shots, frame) : null;
  if (shot) parts.push(SHOT_NAMES[shot.kind]);
  if (rower && !rower.poses[frame]) parts.push("no pose on this frame");
  $("readout").textContent = parts.join(" · ");
  const name = markerName(frame);
  if (name) {
    const tag = document.createElement("span");
    tag.className = `tag ${name}`;
    tag.textContent = name === "catches" ? "CATCH" : "FINISH";
    $("readout").append(" · ", tag);
  }
  $("cursor").style.left = `${(frame / Math.max(clip.frames - 1, 1)) * 100}%`;
  updateLiveAngles();
}

function updateLiveAngles() {
  const rower = result?.rower;
  if (!rower) {
    $("live-angles").textContent = "";
    return;
  }
  const { trunk, knee, elbow } = anglesAt(frame);
  const text = (name, value) => (value === null ? "not seen" : formatValue(name, value));
  $("live-angles").textContent =
    `Body ${text("lean", trunk)} · Knee ${text("knee", knee)} · Elbow ${text("elbow", elbow)}`;
}

function goTo(target) {
  const next = clampFrame(target, clip.frames);
  const direction = next < frame ? -1 : 1;
  frame = next;
  followRower();
  updateReadout();
  showFrame(frame);
  prefetch(direction);
}

function followRower() {
  const centre = bodyCentre(result?.rower?.poses[frame]);
  if ($("follow").checked && centre) view = centreOn(view, centre, clip.width, clip.height);
}

function setView(next) {
  view = clampView(next, clip.width, clip.height);
  canvas.classList.toggle("zoomed", view.scale > 1);
  draw();
}

function zoomCentre(factor) {
  const middle = viewPoint(view, { x: clip.width / 2, y: clip.height / 2 });
  setView(zoomAt(view, middle, factor, clip.width, clip.height));
}

function zoomToRower() {
  const centre = bodyCentre(result?.rower?.poses[frame]);
  if (centre) setView(centreOn({ ...view, scale: ROWER_ZOOM }, centre, clip.width, clip.height));
}

function pointerVideo(event) {
  const unzoomed = toVideoPoint(
    event.clientX, event.clientY, canvas.getBoundingClientRect(), clip.width, clip.height,
  );
  return viewPoint(view, unzoomed);
}

function jump(kind, direction) {
  const target = nextMarker(frame, result?.rower?.[kind] ?? [], direction);
  if (target !== null) goTo(target);
}

function drawTicks() {
  const timeline = $("timeline");
  timeline.querySelectorAll(".tick").forEach((tick) => tick.remove());
  for (const kind of ["catches", "finishes"]) {
    for (const marker of result?.rower?.[kind] ?? []) {
      const tick = document.createElement("div");
      tick.className = `tick ${kind}`;
      tick.style.left = `${(marker / Math.max(clip.frames - 1, 1)) * 100}%`;
      timeline.append(tick);
    }
  }
}

function showMessages() {
  $("film-closer").hidden = !result.film_closer;
  $("film-closer").textContent = result.film_closer ?? "";
  $("warnings").hidden = result.warnings.length === 0;
  $("warnings").replaceChildren(...result.warnings.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}

function showSummary() {
  const rower = result.rower;
  $("summary").textContent = rower ? resultSummary(result) : "No limb lines for this clip.";
}

function drawFreeze(target, index) {
  const pose = result.rower.poses[index];
  const centre = bodyCentre(pose);
  const picture = new Image();
  picture.onload = () => {
    const paint = target.getContext("2d");
    const scale = target.width / FREEZE_SPAN;
    const x = (centre?.x ?? clip.width / 2) - FREEZE_SPAN / 2;
    const y = (centre?.y ?? clip.height / 2) - target.height / scale / 2;
    paint.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    paint.imageSmoothingQuality = "high";
    paint.drawImage(picture, 0, 0, clip.width, clip.height);
    drawPose(paint, pose, 0.5);
    drawAngles(paint, pose, index, 0.5);
  };
  picture.src = frameUrl(index);
}

function showPanel() {
  const rower = result?.rower;
  $("panel").hidden = !rower;
  if (!rower) return;
  renderPanel($("panel"), rower, panelState, {
    onReveal: () => $("reveal-dialog").showModal(),
    onOpen: (metric) => {
      panelState.active = panelState.active === metric.name ? null : metric.name;
      showPanel();
    },
    onFrame: (index) => {
      goTo(index);
      $("canvas").scrollIntoView({ behavior: "smooth", block: "center" });
    },
    onFreeze: drawFreeze,
  });
}

async function showSaved() {
  const { results } = await api("/api/results");
  $("saved-area").hidden = results.length === 0;
  $("saved").replaceChildren(...results.map((item) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "link";
    open.textContent = item.settings.clip;
    open.addEventListener("click", () => openSaved(item.name).catch((error) => showFailed(error.message)));
    name.append(open);
    const hidden = item.band === "Poor";
    const cells = [
      item.settings.boat_class,
      item.settings.seat,
      item.film_closer ? "Too small" : item.band ? `${Math.round(item.accuracy)}% ${item.band}` : "–",
      hidden ? "Hidden" : item.overall === null ? "–" : Math.round(item.overall),
    ];
    row.append(name, ...cells.map((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      return cell;
    }));
    return row;
  }));
}

async function openSaved(name) {
  clearTimeout(pollTimer);
  const saved = await api(`/api/results/${encodeURIComponent(name)}`);
  await openClip(saved.settings.clip);
  fillForm(saved.settings);
  showViewer(saved);
}

function showViewer(data) {
  result = data;
  picker = null;
  view = FIT;
  canvas.classList.remove("zoomed");
  panelState = { revealed: false, active: null };
  hideResults();
  showMessages();
  showSummary();
  document.activeElement?.blur(); // Arrow keys would otherwise change a focused form field.
  $("stage-area").hidden = false;
  $("viewer").hidden = false;
  canvas.classList.remove("tappable");
  drawTicks();
  frame = openingFrame(result.rower);
  updateReadout();
  showFrame(frame);
  showPanel();
  showSaved().catch(() => {});
}

function showPicker(job) {
  result = null;
  picker = { boats: job.boats, preview: job.preview, chosen: null };
  hideResults();
  $("picker").hidden = false;
  $("stage-area").hidden = false;
  $("use-boat").disabled = true;
  $("use-boat").textContent = "Use this boat";
  canvas.classList.add("tappable");
  const unseen = job.boats.filter((boat) => !boat.outline).length;
  $("picker-note").textContent =
    `Found ${job.boats.length} boat(s), and you said ${job.settings.boats_in_video}.` +
    (unseen ? ` ${unseen} not in this frame, so not outlined.` : "");
  frame = job.preview;
  showFrame(frame);
}

function showProgress(job) {
  picker = null;
  hideResults();
  $("progress").hidden = false;
  if (job.stage !== stageName) {
    stageName = job.stage;
    stageStart = Date.now();
  }
  $("stage").textContent = stageText(job, (Date.now() - stageStart) / 1000);
  if (job.progress === null) $("bar").removeAttribute("value");
  else $("bar").value = job.progress;
}

function showFailed(message) {
  picker = null;
  hideResults();
  $("failed").textContent = message;
  $("failed").hidden = false;
}

async function render(job) {
  clearTimeout(pollTimer);
  if (job.state === "idle" || job.state === "cancelled") {
    picker = null;
    hideResults();
    return;
  }
  await openClip(job.settings.clip);
  if (job.state === "running") {
    showProgress(job);
    pollTimer = setTimeout(poll, POLL_MS);
  } else if (job.state === "needs_boat") {
    showPicker(job);
  } else if (job.state === "done") {
    showViewer(job.result);
  } else {
    showFailed(`The analysis failed. ${job.error}`);
  }
}

async function poll() {
  try {
    await render(await api("/api/job"));
  } catch (error) {
    showFailed(`Lost contact with the server. ${error.message}`);
  }
}

async function submit(path, body) {
  try {
    clearTimeout(pollTimer);
    await render(await api(path, body));
  } catch (error) {
    $("form-error").textContent = error.message;
    $("form-error").hidden = false;
  }
}

$("boat-class").addEventListener("change", fillSeats);

$("setup").addEventListener("submit", (event) => {
  event.preventDefault();
  submit("/api/job", {
    clip: $("clip").value,
    boat_class: $("boat-class").value,
    boats_in_video: Number($("boats").value),
    seat: Number($("seat").value),
    side: $("side").value,
  });
});

$("cancel").addEventListener("click", () => submit("/api/job/cancel", {}));

canvas.addEventListener("click", (event) => {
  if (!picker) return;
  const point = pointerVideo(event);
  picker.chosen = boatAt(picker.boats, point);
  picker.point = point;
  $("use-boat").disabled = picker.chosen === null;
  if (picker.chosen !== null) {
    $("use-boat").textContent = `Use boat ${picker.chosen + 1}`;
  }
  draw();
});

$("use-boat").addEventListener("click", () => {
  if (picker && picker.chosen !== null) submit("/api/job/boat", picker.point);
});

$("viewer").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button?.dataset.step) goTo(frame + Number(button.dataset.step));
  if (button?.dataset.jump) {
    const [kind, direction] = button.dataset.jump.split(":");
    jump(kind, Number(direction));
  }
});

$("show-lines").addEventListener("change", draw);
$("show-angles").addEventListener("change", draw);
$("zoom-in").addEventListener("click", () => zoomCentre(ZOOM_STEP));
$("zoom-out").addEventListener("click", () => zoomCentre(1 / ZOOM_STEP));
$("zoom-fit").addEventListener("click", () => setView(FIT));
$("zoom-rower").addEventListener("click", zoomToRower);
$("follow").addEventListener("change", () => {
  followRower();
  draw();
});
$("reveal-dialog").addEventListener("close", () => {
  if ($("reveal-dialog").returnValue !== "show") return;
  panelState.revealed = true;
  showPanel();
});

canvas.addEventListener("wheel", (event) => {
  if (picker || !clip) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
  setView(zoomAt(view, pointerVideo(event), factor, clip.width, clip.height));
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  if (picker) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener("pointermove", (event) => {
  const last = pointers.get(event.pointerId);
  if (!last) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    setView(zoomAt(view, pointerVideo(event), distance / pinch, clip.width, clip.height));
    pinch = distance;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const perPixel = clip.width / rect.width / view.scale;
  setView({
    ...view,
    x: view.x - (event.clientX - last.x) * perPixel,
    y: view.y - (event.clientY - last.y) * perPixel,
  });
});

function endPointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

function seek(event) {
  const rect = $("timeline").getBoundingClientRect();
  goTo(((event.clientX - rect.left) / rect.width) * (clip.frames - 1));
}

$("timeline").addEventListener("pointerdown", (event) => {
  $("timeline").setPointerCapture(event.pointerId);
  seek(event);
});
$("timeline").addEventListener("pointermove", (event) => {
  if (event.buttons) seek(event);
});

document.addEventListener("keydown", (event) => {
  if ($("viewer").hidden || event.target.matches("input[type=number], select")) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const size = event.shiftKey ? 10 : 1;
  const direction = event.shiftKey ? -1 : 1;
  const key = event.key.toLowerCase();
  if (key === "arrowleft") goTo(frame - size);
  else if (key === "arrowright") goTo(frame + size);
  else if (key === "c") jump("catches", direction);
  else if (key === "f") jump("finishes", direction);
  else if (key === "l") {
    $("show-lines").checked = !$("show-lines").checked;
    draw();
  } else if (key === "a") {
    $("show-angles").checked = !$("show-angles").checked;
    draw();
  } else if (key === "+" || key === "=") zoomCentre(ZOOM_STEP);
  else if (key === "-") zoomCentre(1 / ZOOM_STEP);
  else if (key === "0") setView(FIT);
  else if (key === "z") zoomToRower();
  else return;
  event.preventDefault();
});

async function start() {
  const { clips, boats, sides, side_names: names } = await api("/api/clips");
  boatSeats = boats;
  boatSides = sides;
  sideNames = names;
  $("clip").replaceChildren(...clips.map((name) => new Option(name, name)));
  $("boat-class").replaceChildren(...Object.keys(boats).map((name) => new Option(name, name)));
  fillSeats();
  const job = await api("/api/job");
  if (job.settings) fillForm(job.settings);
  await showSaved();
  await render(job);
}

start().catch((error) => showFailed(`Could not load the page. ${error.message}`));
