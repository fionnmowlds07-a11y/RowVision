import {
  boatAt,
  boatLabel,
  clampFrame,
  limbSegments,
  nextMarker,
  openingFrame,
  resultSummary,
  seatOptions,
  shotAt,
  stageText,
  toVideoPoint,
} from "./logic.mjs";

const POLL_MS = 500;
const PREFETCH_FRAMES = 6;
const SCALE = 2; // Canvas pixels per video pixel, so lines stay sharp when the page enlarges them.
const COLOURS = { left: "#22d3ee", right: "#e879f9", centre: "#fde047" };
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
let clip = null; // { name, fps, frames, width, height }
let result = null;
let picker = null; // { boats, preview, chosen }
let frame = 0;
let image = null;
let requested = 0;
let pollTimer = null;
let stageName = null;
let stageStart = 0;

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
}

// After a reload, show the settings of the job the server still holds.
function fillForm(settings) {
  $("clip").value = settings.clip;
  $("boat-class").value = settings.boat_class;
  fillSeats();
  $("seat").value = settings.seat;
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
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  context.drawImage(image, 0, 0, clip.width, clip.height);
  if (picker) drawBoats();
  else if ($("show-lines").checked) drawPose();
}

function drawPose() {
  const pose = result?.rower?.poses[frame];
  context.lineWidth = 1.5;
  context.lineCap = "round";
  for (const { start, end, side, sure } of limbSegments(pose)) {
    context.strokeStyle = COLOURS[side];
    context.setLineDash(sure ? [] : [3, 3]);
    context.beginPath();
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
    context.stroke();
  }
  context.setLineDash([]);
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
}

function goTo(target) {
  const next = clampFrame(target, clip.frames);
  const direction = next < frame ? -1 : 1;
  frame = next;
  updateReadout();
  showFrame(frame);
  prefetch(direction);
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

function showViewer(data) {
  result = data;
  picker = null;
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
  });
});

$("cancel").addEventListener("click", () => submit("/api/job/cancel", {}));

canvas.addEventListener("click", (event) => {
  if (!picker) return;
  const point = toVideoPoint(
    event.clientX, event.clientY, canvas.getBoundingClientRect(), clip.width, clip.height,
  );
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
  } else return;
  event.preventDefault();
});

async function start() {
  const { clips, boats } = await api("/api/clips");
  boatSeats = boats;
  $("clip").replaceChildren(...clips.map((name) => new Option(name, name)));
  $("boat-class").replaceChildren(...Object.keys(boats).map((name) => new Option(name, name)));
  fillSeats();
  const job = await api("/api/job");
  if (job.settings) fillForm(job.settings);
  await render(job);
}

start().catch((error) => showFailed(`Could not load the page. ${error.message}`));
