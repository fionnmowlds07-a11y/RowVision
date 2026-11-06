import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIT,
  overallGap,
  ratingNote,
  TARGET_WINDOW,
  targetMarks,
  timingText,
  JOINT_ORDER,
  labelCount,
  labelResults,
  labelView,
  nextJoint,
  playStart,
  playbackFrame,
  clipTime,
  previewLabel,
  previewStart,
  labelSpot,
  STACK_AT,
  VIDEO_DEFAULT,
  laneMarks,
  savedShare,
  videoLayout,
  measureKind,
  modelRequest,
  nearestMeasure,
  referenceUrl,
  toScene,
  angleMarks,
  arcBetween,
  bodyCentre,
  centreOn,
  clampView,
  evidenceFrames,
  formatTarget,
  formatValue,
  median,
  overallVisible,
  sourceLink,
  viewPoint,
  zoomAt,
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
} from "../rowvision_preview/static/logic.mjs";

test("seats run from bow to stroke", () => {
  assert.deepEqual(seatOptions(4).map((seat) => seat.label), ["1 (bow)", "2", "3", "4 (stroke)"]);
  assert.deepEqual(seatOptions(1), [{ value: 1, label: "1 (single)" }]);
});

test("frames stay inside the clip", () => {
  assert.equal(clampFrame(-3, 100), 0);
  assert.equal(clampFrame(100, 100), 99);
  assert.equal(clampFrame(4.6, 100), 5);
  assert.equal(clampFrame(4, 0), 0);
});

test("jumping skips the marker you are on", () => {
  const markers = [10, 20, 30];
  assert.equal(nextMarker(20, markers, 1), 30);
  assert.equal(nextMarker(20, markers, -1), 10);
  assert.equal(nextMarker(15, markers, 1), 20);
  assert.equal(nextMarker(15, markers, -1), 10);
});

test("jumping past the ends finds nothing", () => {
  assert.equal(nextMarker(30, [10, 30], 1), null);
  assert.equal(nextMarker(10, [10, 30], -1), null);
  assert.equal(nextMarker(5, [], 1), null);
});

test("frame zero can be jumped to", () => {
  assert.equal(nextMarker(9, [0], -1), 0);
});

test("limbs need both ends, and unsure ones are flagged", () => {
  const pose = Array(17).fill(null);
  pose[5] = [1, 2, 0.9];
  pose[7] = [3, 4, 0.9];
  pose[9] = [5, 6, 0.1];
  const segments = limbSegments(pose);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { start: [1, 2, 0.9], end: [3, 4, 0.9], side: "left", sure: true });
  assert.equal(segments[1].sure, false);
});

test("the viewer opens on the first catch, else the first pose", () => {
  assert.equal(openingFrame({ catches: [40], poses: [null, []] }), 40);
  assert.equal(openingFrame({ catches: [], poses: [null, null, []] }), 2);
  assert.equal(openingFrame({ catches: [], poses: [null] }), 0);
  assert.equal(openingFrame(null), 0);
});

test("a frame with no pose draws nothing", () => {
  assert.deepEqual(limbSegments(null), []);
});

test("the shot end frame belongs to the next shot", () => {
  const shots = [{ start: 0, end: 10, kind: "a" }, { start: 10, end: 20, kind: "b" }];
  assert.equal(shotAt(shots, 9).kind, "a");
  assert.equal(shotAt(shots, 10).kind, "b");
  assert.equal(shotAt(shots, 20), null);
});

test("taps convert from the scaled canvas to video pixels", () => {
  const rect = { left: 100, top: 50, width: 424, height: 239 };
  assert.deepEqual(toVideoPoint(312, 169.5, rect, 848, 478), { x: 424, y: 239 });
});

test("a tap picks the boat it is in, or the nearest", () => {
  const boats = [
    { outline: [0, 0, 10, 10] },
    { outline: null },
    { outline: [100, 0, 110, 10] },
  ];
  assert.equal(boatAt(boats, { x: 5, y: 5 }), 0);
  assert.equal(boatAt(boats, { x: 105, y: 5 }), 2);
  assert.equal(boatAt(boats, { x: 80, y: 5 }), 2);
});

test("overlapping boats go to the first, as boat_at does", () => {
  const boats = [{ outline: [0, 0, 10, 10] }, { outline: [5, 0, 15, 10] }];
  assert.equal(boatAt(boats, { x: 7, y: 5 }), 0);
});

test("no boat in view gives no choice", () => {
  assert.equal(boatAt([{ outline: null }], { x: 1, y: 1 }), null);
});

test("boat labels say how many people and whether it is too far", () => {
  assert.equal(boatLabel({ people: 1, too_far: false }, 1), "Boat 1: 1 person");
  assert.equal(boatLabel({ people: 8, too_far: true }, 2), "Boat 2: 8 people, too far");
});

test("progress shows a percentage when known, and otherwise the time passing", () => {
  assert.equal(stageText({ stage: "Measuring", progress: 0.256 }, 9), "Measuring: 26%");
  assert.equal(stageText({ stage: "Loading", progress: null }, 8.6), "Loading... 9 s");
});

test("the summary leaves out what is unknown", () => {
  const rower = { seat: null, catches: [1], finishes: [], rate_spm: null };
  assert.equal(resultSummary({ rower, view_deg: null }), "Seat unknown · 1 catches · 0 finishes");
  const known = { seat: 2, catches: [], finishes: [], rate_spm: 24.04 };
  assert.match(resultSummary({ rower: known, view_deg: 12.4 }), /24\.0 strokes a minute · camera 12°/);
});


test("a Poor overall score stays hidden until the warning is accepted", () => {
  assert.equal(overallVisible({ band: "Poor" }, false), false);
  assert.equal(overallVisible({ band: "Poor" }, true), true);
  assert.equal(overallVisible({ band: "Fair" }, false), true);
  assert.equal(overallVisible({ band: "Excellent" }, false), true);
});

test("values read in rowing terms", () => {
  assert.equal(formatValue("catch_lean_deg", 25.4), "25° forward");
  assert.equal(formatValue("finish_lean_deg", -22.6), "23° back");
  assert.equal(formatValue("catch_knee_deg", 50.2), "50°");
  assert.equal(formatValue("drive_share", 0.42), "42%");
  assert.equal(formatValue("catch_knee_deg", null), "not measured");
});

test("targets read in rowing terms", () => {
  assert.equal(formatTarget("catch_lean_deg", { low: 20, high: 35 }), "20–35° forward");
  assert.equal(formatTarget("finish_lean_deg", { low: -30, high: -15 }), "15–30° back");
  assert.equal(formatTarget("drive_share", { low: 0.34, high: 0.44 }), "34–44%");
  assert.equal(formatTarget("legs_lead", { low: 0, high: null }), "at least 0%");
  assert.equal(formatTarget("catch_knee_deg", null), "no target");
});

test("evidence uses the frame each measure was read on", () => {
  const strokes = [{ catch_frame: 10, finish_frame: 40, catch_lean_deg: 25, finish_lean_deg: -20 }];
  assert.deepEqual(evidenceFrames("catch_lean_deg", strokes), [{ stroke: 1, frame: 10, value: 25 }]);
  assert.deepEqual(evidenceFrames("finish_lean_deg", strokes), [{ stroke: 1, frame: 40, value: -20 }]);
  assert.equal(evidenceFrames("drive_share", strokes)[0].frame, 10);
});

test("sources link to PubMed or to their own page", () => {
  assert.equal(sourceLink("39275598").href, "https://pubmed.ncbi.nlm.nih.gov/39275598/");
  assert.equal(sourceLink("https://example.org/model.pdf").label, "example.org");
});

function pose() {
  const joints = Array(17).fill(null);
  const place = (left, right, x, y) => {
    joints[left] = [x, y, 0.9];
    joints[right] = [x, y, 0.9];
  };
  place(5, 6, 90, 40);
  place(7, 8, 70, 60);
  place(9, 10, 50, 60);
  place(11, 12, 100, 80);
  place(13, 14, 60, 60);
  place(15, 16, 30, 90);
  return joints;
}

test("each visible angle gets a mark", () => {
  const marks = angleMarks(pose(), { trunk: 14, knee: 90, elbow: null });
  assert.deepEqual(marks.map((item) => item.kind), ["trunk", "knee"]);
  assert.equal(marks[0].label, "14° forward");
});

test("angles on unsure joints are flagged", () => {
  const unsure = pose();
  unsure[13] = [60, 60, 0.1];
  const [, knee] = angleMarks(unsure, { trunk: 14, knee: 90, elbow: null });
  assert.equal(knee.sure, false);
});

test("a frame with no pose has no angle marks", () => {
  assert.deepEqual(angleMarks(null, {}), []);
});

test("arcs take the short way round", () => {
  const vertex = { x: 0, y: 0 };
  const short = arcBetween({ vertex, a: { x: 1, y: 0 }, b: { x: 0, y: 1 } });
  assert.equal(short.anticlockwise, false);
  const reverse = arcBetween({ vertex, a: { x: 0, y: 1 }, b: { x: 1, y: 0 } });
  assert.equal(reverse.anticlockwise, true);
});

test("zooming keeps the pointer's spot in place", () => {
  const zoomed = zoomAt(FIT, { x: 400, y: 200 }, 2, 800, 400);
  assert.equal(zoomed.scale, 2);
  assert.deepEqual(viewPoint(zoomed, { x: 400, y: 200 }), { x: 400, y: 200 });
});

test("the view cannot leave the video or zoom out past it", () => {
  assert.deepEqual(clampView({ scale: 0.5, x: 90, y: -5 }, 800, 400), FIT);
  const edge = clampView({ scale: 2, x: 900, y: 900 }, 800, 400);
  assert.deepEqual(edge, { scale: 2, x: 400, y: 200 });
  assert.equal(clampView({ scale: 99, x: 0, y: 0 }, 800, 400).scale, 12);
});

test("following centres the rower where the edges allow", () => {
  const view = centreOn({ scale: 4, x: 0, y: 0 }, { x: 400, y: 200 }, 800, 400);
  assert.deepEqual(view, { scale: 4, x: 300, y: 150 });
});

test("the body centre ignores missing joints", () => {
  assert.deepEqual(bodyCentre([[0, 0, 1], null, [10, 20, 1]]), { x: 5, y: 10 });
  assert.equal(bodyCentre(null), null);
  assert.equal(bodyCentre([null]), null);
});

test("the median skips missing values", () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([1, 2]), 1.5);
  assert.equal(median([null]), null);
});


const METRICS = [
  { name: "catch_lean_deg", label: "Body angle at the catch", value: 25, score: 100, target: { low: 20, high: 35 } },
  { name: "catch_knee_deg", label: "Knee angle at the catch", value: 95, score: null, target: { low: 45, high: 60 } },
  { name: "finish_lean_deg", label: "Layback at the finish", value: -18, score: 100, target: { low: -30, high: -15 } },
  { name: "finish_knee_deg", label: "Knee angle at the finish", value: 165, score: 100, target: { low: 160, high: 170 } },
];

test("the model poses the middle of the target at the right stroke moment", () => {
  const request = modelRequest("finish_lean_deg", METRICS);
  assert.equal(request.phase, "finish");
  assert.deepEqual(request.target, { lean: -22.5, knee: 165, reach: 0.33 });
  assert.equal(request.shaded, "lean");
  assert.deepEqual(request.range, { low: -30, high: -15 });
});

test("an unreliable angle is never shown as the athlete's own", () => {
  const request = modelRequest("catch_knee_deg", METRICS);
  assert.equal(request.yours.knee, request.target.knee);
  assert.equal(request.yours.lean, 25);
  assert.deepEqual(request.assumed, ["Knee angle at the catch"]);
});

test("the elbow has no shaded range", () => {
  const request = modelRequest("finish_elbow_deg", METRICS);
  assert.equal(request.phase, "finish");
  assert.equal(request.shaded, null);
});

test("the reference request carries the rowing side", () => {
  const url = referenceUrl({ lean: 25, knee: 50, reach: 0.58 }, "bow");
  assert.equal(url, "/api/reference?lean=25&knee=50&reach=0.58&style=bow");
});

test("a live angle opens the nearest stroke moment", () => {
  assert.equal(nearestMeasure("trunk", 12, [10, 90], [40]), "catch_lean_deg");
  assert.equal(nearestMeasure("knee", 42, [10, 90], [40]), "finish_knee_deg");
  assert.equal(nearestMeasure("elbow", 5, [10], [40]), "finish_elbow_deg");
  assert.equal(nearestMeasure("trunk", 5, [], []), "catch_lean_deg");
});

test("the scene keeps a right-handed layout with height upwards", () => {
  assert.deepEqual(toScene([1, 2, 3]), [1, 3, -2]);
});


test("a freeze frame shows only the angle being checked", () => {
  assert.equal(measureKind("catch_lean_deg"), "trunk");
  assert.equal(measureKind("finish_knee_deg"), "knee");
  assert.equal(measureKind("finish_elbow_deg"), "elbow");
  assert.equal(measureKind("drive_share"), null);
});


test("the scores sit beside the video until the video gets large", () => {
  assert.deepEqual(videoLayout(62, 1400), { video: 62, stacked: false });
  assert.equal(videoLayout(STACK_AT, 1400).stacked, false);
  assert.equal(videoLayout(STACK_AT + 1, 1400).stacked, true);
});

test("narrow screens always stack", () => {
  assert.equal(videoLayout(50, 700).stacked, true);
});

test("the video size stays within its limits", () => {
  assert.equal(videoLayout(10, 1400).video, 40);
  assert.equal(videoLayout(140, 1400).video, 100);
});

test("a missing or damaged saved size falls back to the default", () => {
  assert.equal(savedShare(null), VIDEO_DEFAULT);
  assert.equal(savedShare("nonsense"), VIDEO_DEFAULT);
  assert.equal(savedShare("70"), 70);
  assert.equal(savedShare("500"), 100);
});

test("the small lane places the buoy against the target band", () => {
  const inside = laneMarks(25, { low: 20, high: 35 });
  assert.ok(inside.buoy > inside.bandStart && inside.buoy < inside.bandStart + inside.bandWidth);
  const beyond = laneMarks(50, { low: 20, high: 35 });
  assert.ok(beyond.buoy > beyond.bandStart + beyond.bandWidth);
  assert.ok(beyond.buoy <= 100);
});

test("an open-ended target still has a band", () => {
  const marks = laneMarks(0.1, { low: 0, high: null });
  assert.ok(marks.bandWidth > 0);
});

test("a measure with no target or value has no lane", () => {
  assert.equal(laneMarks(5, null), null);
  assert.equal(laneMarks(null, { low: 1, high: 2 }), null);
});


test("angle labels sit on different sides of their joints", () => {
  const vertex = { x: 100, y: 100 };
  const trunk = labelSpot("trunk", vertex, 40, 15, 14);
  const knee = labelSpot("knee", vertex, 40, 15, 14);
  const elbow = labelSpot("elbow", vertex, 40, 15, 14);
  assert.ok(trunk.x + 40 <= vertex.x);
  assert.ok(knee.y + 15 <= vertex.y);
  assert.ok(elbow.x >= vertex.x);
});


test("a clip preview opens part way through", () => {
  assert.equal(previewStart(1000), 500);
  assert.equal(previewStart(1), 0);
  assert.equal(previewStart(0), 0);
});

test("clip times read as minutes and seconds", () => {
  assert.equal(clipTime(0, 30), "0:00");
  assert.equal(clipTime(95, 30), "0:03");
  assert.equal(clipTime(1830, 30), "1:01");
  assert.equal(previewLabel(300, 901, 30), "0:10 of 0:30");
});


test("playback follows the clock at each speed", () => {
  assert.equal(playbackFrame(10, 1000, 30, 1, 500), 40);
  assert.equal(playbackFrame(10, 1000, 30, 0.5, 500), 25);
  assert.equal(playbackFrame(10, 1000, 30, 0.25, 500), 17);
});

test("playback stops at the last frame", () => {
  assert.equal(playbackFrame(490, 5000, 30, 1, 500), 500);
});

test("pressing play at the end restarts the clip", () => {
  assert.equal(playStart(500, 500), 0);
  assert.equal(playStart(120, 500), 120);
});


test("labelling moves through the joints in order", () => {
  assert.equal(nextJoint({}), "shoulder");
  assert.equal(nextJoint({ shoulder: [1, 2], elbow: null }), "wrist");
  const done = Object.fromEntries(JOINT_ORDER.map((name) => [name, null]));
  assert.equal(nextJoint(done), null);
});

test("a labelling frame centres on the rower", () => {
  const view = labelView([400, 240], 200, 800, 480);
  assert.equal(view.scale, 4);
  assert.deepEqual(viewPoint(view, { x: 400, y: 240 }), { x: 400, y: 240 });
});

test("labelling progress reads plainly", () => {
  assert.equal(labelCount({ usable: 3, target: 100, available: 50 }), "3 of 100 usable frames labelled");
  assert.match(labelCount({ usable: 0, target: 100, available: 0 }), /Analyse a clip first/);
});

test("results stay quiet until there is something to report", () => {
  assert.equal(labelResults({ keypoint_error_px: null }), "");
  const text = labelResults({
    keypoint_error_px: 2.34, trunk_within_5_deg: 81.2, knee_within_5_deg: null, labelled: 10, target: 100,
  });
  assert.match(text, /2\.3 pixels/);
  assert.match(text, /81%/);
  assert.doesNotMatch(text, /Knee/);
  assert.match(text, /label more/);
});


test("timing only reports gaps it can stand behind", () => {
  assert.equal(timingText(100, 40), "About 100 ms late");
  assert.equal(timingText(-67, 34), "About 70 ms early");
  assert.equal(timingText(30, 34), "In time");
  assert.equal(timingText(120, 110), "Too variable to read on this footage");
  assert.equal(timingText(null, null), "Not enough strokes");
});

test("the rating says how far it has been checked", () => {
  assert.match(ratingNote({ calibrated: false, labelled_frames: 0 }), /not yet checked/);
  assert.match(ratingNote({ calibrated: false, labelled_frames: 78 }), /78 hand-labelled frames so far/);
  assert.match(ratingNote({ calibrated: true, labelled_frames: 120 }), /calibrated on 120/);
});

function targetRower(overrides = {}) {
  const metric = (name, low, high, score = 80) => ({ name, score, target: { low, high } });
  return {
    catches: [100],
    finishes: [130],
    angles: { trunk: Array(200).fill(25), knee: Array(200).fill(50) },
    card: {
      metrics: [
        metric("catch_lean_deg", 20, 35),
        metric("finish_lean_deg", -30, -15),
        metric("catch_knee_deg", 45, 60),
        metric("finish_knee_deg", 165, 180, null),
      ],
    },
    ...overrides,
  };
}

function targetPose() {
  const pose = Array(17).fill(null);
  const joint = (left, right, x, y) => {
    pose[left] = [x, y, 0.9];
    pose[right] = [x, y, 0.9];
  };
  joint(5, 6, 100, 50);
  joint(11, 12, 100, 100);
  joint(13, 14, 140, 100);
  joint(15, 16, 140, 140);
  return pose;
}

function degreesFromUp(vertex, point) {
  return (Math.atan2(point.x - vertex.x, vertex.y - point.y) * 180) / Math.PI;
}

test("targets only show close to a catch or finish", () => {
  const rower = targetRower();
  assert.deepEqual(targetMarks(targetPose(), 115, rower, 1, 0), []);
  assert.equal(targetMarks(targetPose(), 100 + TARGET_WINDOW, rower, 1, 0).length, 2);
  assert.deepEqual(targetMarks(targetPose(), 100 + TARGET_WINDOW + 1, rower, 1, 0), []);
  assert.deepEqual(targetMarks(null, 100, rower, 1, 0), []);
});

test("a trunk target leans the way the rower faces, by the target angle", () => {
  const [right] = targetMarks(targetPose(), 100, targetRower(), 1, 0);
  assert.ok(Math.abs(degreesFromUp(right.vertex, right.low) - 20) < 1e-6);
  assert.ok(Math.abs(degreesFromUp(right.vertex, right.high) - 35) < 1e-6);
  const [left] = targetMarks(targetPose(), 100, targetRower(), -1, 0);
  assert.ok(Math.abs(degreesFromUp(left.vertex, left.high) + 35) < 1e-6);
});

test("a target is squeezed along the boat when the camera is not side-on", () => {
  const [flat] = targetMarks(targetPose(), 100, targetRower(), 1, 0);
  const [angled] = targetMarks(targetPose(), 100, targetRower(), 1, 60);
  assert.ok(Math.abs((angled.high.x - 100) / (flat.high.x - 100) - 0.5) < 1e-6);
  assert.equal(angled.high.y, flat.high.y);
});

test("a knee target opens from the thigh towards the shin", () => {
  const knee = targetMarks(targetPose(), 100, targetRower(), 1, 0)[1];
  const opening = (edge) => {
    const thigh = Math.atan2(100 - knee.vertex.y, 100 - knee.vertex.x);
    const shin = Math.atan2(edge.y - knee.vertex.y, edge.x - knee.vertex.x);
    return Math.abs(Math.atan2(Math.sin(shin - thigh), Math.cos(shin - thigh)) * 180) / Math.PI;
  };
  assert.ok(Math.abs(opening(knee.low) - 45) < 1e-6);
  assert.ok(Math.abs(opening(knee.high) - 60) < 1e-6);
  assert.ok(knee.low.x < knee.vertex.x && knee.low.y > knee.vertex.y);
});

test("a measure that is not scored gets no target", () => {
  const marks = targetMarks(targetPose(), 130, targetRower(), 1, 0);
  assert.deepEqual(marks.map(({ kind }) => kind), ["trunk"]);
});

test("a target says whether the measured angle is inside it", () => {
  const rower = targetRower({ angles: { trunk: Array(200).fill(10), knee: Array(200).fill(50) } });
  const [trunk, knee] = targetMarks(targetPose(), 100, rower, 1, 0);
  assert.equal(trunk.inside, false);
  assert.equal(knee.inside, true);
});

test("a missing overall score says what it needs", () => {
  assert.match(overallGap(2, {}, 3), /at least 3 full strokes/);
  assert.match(overallGap(5, {}, 3), /nothing could be measured/);
  assert.match(overallGap(5, { rhythm: 100 }, 3), /both the catch and the finish/);
});
