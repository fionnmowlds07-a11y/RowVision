"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  FIT, bodyCentre, centreOn, clampFrame, clampView, clipTime, nextMarker, viewPoint, zoomAt,
  type Point, type View,
} from "@/lib/logic";
import type { Rower } from "@/lib/result";
import { drawAngles, drawPose, drawTargets, type Scene } from "./draw";
import styles from "./clip.module.css";

const ZOOM_STEP = 1.5;
const ROWER_ZOOM = 5;
const SPEEDS = [[1, "Full"], [0.5, "Half"], [0.25, "Quarter"]] as const;

export type Jump = { frame: number; nonce: number };

type Props = {
  link: string;
  fps: number;
  frames: number;
  rower: Rower;
  scene: Scene | null;
  jump: Jump | null;
  fullScreen: boolean;
  onOpen: () => void;
  onClose: () => void;
};

export function Viewer({ link, fps, frames, rower, scene, jump, fullScreen, onOpen, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const wanted = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef(0);
  const [frame, setFrame] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [view, setView] = useState<View>(FIT);
  const [layers, setLayers] = useState({ limbs: true, angles: true, targets: true });
  const [follow, setFollow] = useState(false);
  const [shown, setShown] = useState({ width: 0, height: 0 });

  // The overlay is painted at the stage's real size, so it stays sharp however far the video is zoomed.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setShown({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const goTo = useCallback((target: number) => {
    const next = clampFrame(target, frames);
    wanted.current = next;
    video.current?.pause();
    if (video.current) video.current.currentTime = (next + 0.5) / fps;
  }, [fps, frames]);

  // The browser says exactly which frame it is showing, so the overlay always matches the picture.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Rounded, not floored: a phone clip's frame times can sit up to a quarter of a frame early.
    const show = (seconds: number) => setFrame(clampFrame(Math.round(seconds * fps), frames));
    if (typeof element.requestVideoFrameCallback === "function") {
      let handle = 0;
      const shown: VideoFrameRequestCallback = (_, data) => {
        show(data.mediaTime);
        handle = element.requestVideoFrameCallback(shown);
      };
      handle = element.requestVideoFrameCallback(shown);
      return () => element.cancelVideoFrameCallback(handle);
    }
    const update = () => show(element.currentTime);
    element.addEventListener("seeked", update);
    element.addEventListener("timeupdate", update);
    return () => {
      element.removeEventListener("seeked", update);
      element.removeEventListener("timeupdate", update);
    };
  }, [fps, frames]);

  useEffect(() => {
    if (jump) goTo(jump.frame);
  }, [jump, goTo]);

  const shownView = follow && scene ? followView(view, scene, frame, size) : view;

  useEffect(() => {
    const element = canvas.current;
    const paint = element?.getContext("2d");
    if (!paint || !element || !size.width || !shown.width) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(shown.width * ratio);
    const height = Math.round(shown.height * ratio);
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    paint.setTransform(1, 0, 0, 1, 0, 0);
    paint.clearRect(0, 0, width, height);
    if (!scene) return;
    const scale = (width / size.width) * shownView.scale;
    paint.setTransform(scale, 0, 0, scale, -shownView.x * scale, -shownView.y * scale);
    const line = size.width / (shown.width * shownView.scale);
    if (layers.targets) drawTargets(paint, scene, frame, line);
    if (layers.limbs) drawPose(paint, scene, frame, line);
    if (layers.angles) drawAngles(paint, scene, frame, line);
  }, [frame, layers, scene, shown, shownView.scale, shownView.x, shownView.y, size]);

  const zoom = useCallback((factor: number, point?: Point) => {
    setView((current) => {
      const middle = viewPoint(current, { x: size.width / 2, y: size.height / 2 });
      return zoomAt(current, point ?? middle, factor, size.width, size.height);
    });
  }, [size]);

  const zoomToRower = useCallback(() => {
    const centre = scene && bodyCentre(scene.poses[frame]);
    if (centre) setView(centreOn({ scale: ROWER_ZOOM, x: 0, y: 0 }, centre, size.width, size.height));
  }, [frame, scene, size]);

  const jumpTo = useCallback((markers: number[], direction: number) => {
    const next = nextMarker(frame, markers, direction);
    if (next !== null) goTo(next);
  }, [frame, goTo]);

  const togglePlay = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      element.playbackRate = speed;
      void element.play();
    } else {
      element.pause();
    }
  }, [speed]);

  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea")) return;
      const step = event.shiftKey ? 10 : 1;
      const actions: Record<string, () => void> = {
        " ": togglePlay,
        ArrowLeft: () => goTo(frame - step),
        ArrowRight: () => goTo(frame + step),
        c: () => jumpTo(rower.catches, 1),
        C: () => jumpTo(rower.catches, -1),
        f: () => jumpTo(rower.finishes, 1),
        F: () => jumpTo(rower.finishes, -1),
        l: () => setLayers((old) => ({ ...old, limbs: !old.limbs })),
        a: () => setLayers((old) => ({ ...old, angles: !old.angles })),
        "+": () => zoom(ZOOM_STEP),
        "=": () => zoom(ZOOM_STEP),
        "-": () => zoom(1 / ZOOM_STEP),
        "0": () => setView(FIT),
        z: zoomToRower,
      };
      const action = actions[event.key];
      if (!action || (event.key === " " && target.closest("button, a"))) return;
      event.preventDefault();
      action();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [frame, goTo, jumpTo, rower, togglePlay, zoom, zoomToRower]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, pointIn(element!, event.clientX, event.clientY, view, size));
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [size, view, zoom]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch.current = spread(pointers.current);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId);
    if (!last || !stage.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const now = spread(pointers.current);
      if (pinch.current) zoom(now / pinch.current);
      pinch.current = now;
      return;
    }
    const perPixel = size.width / stage.current.clientWidth;
    setView((current) => clampView({
      ...current,
      x: current.x - ((event.clientX - last.x) * perPixel) / current.scale,
      y: current.y - ((event.clientY - last.y) * perPixel) / current.scale,
    }, size.width, size.height));
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    pinch.current = 0;
  }

  const across = size.width ? (shownView.x / size.width) * shownView.scale * 100 : 0;
  const down = size.height ? (shownView.y / size.height) * shownView.scale * 100 : 0;
  const transform = `translate(${-across}%, ${-down}%) scale(${shownView.scale})`;
  const angle = (values: (number | null)[] | undefined) => {
    const value = values?.[frame];
    return value === null || value === undefined ? "–" : `${Math.round(Math.abs(value))}°`;
  };
  const moment = rower.catches.includes(frame) ? "Catch" : rower.finishes.includes(frame) ? "Finish" : null;

  return (
    <section className={fullScreen ? styles.viewerFull : styles.viewer} aria-label="Frame viewer">
      <div className={styles.viewerBar}>
        <p aria-live="polite">{moment ? `${moment}, frame ${frame}` : `Frame ${frame}`} <span className={styles.time}>{clipTime(frame, fps)}</span></p>
        <button type="button" className={`button quiet ${styles.close}`} onClick={onClose}>Back to results</button>
      </div>
      <div
        ref={stage}
        className={styles.stage}
        style={size.width ? { aspectRatio: `${size.width} / ${size.height}`, "--ratio": size.width / size.height } as CSSProperties : undefined}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        <div className={styles.picture} style={{ transform }}>
          <video
            ref={video}
            src={link}
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(event) => {
              const { videoWidth: width, videoHeight: height } = event.currentTarget;
              setSize({ width, height });
              goTo(rower.catches[0] ?? 0);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>
        <canvas ref={canvas} className={styles.overlay} aria-hidden="true" />
        <button
          type="button"
          className={styles.fullButton}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={fullScreen ? onClose : onOpen}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {fullScreen
              ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
          {fullScreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      <div className={styles.lane} aria-hidden="true">
        {rower.catches.map((marker) => <i key={`c${marker}`} className={styles.catchMark} style={{ left: `${(marker / frames) * 100}%` }} />)}
        {rower.finishes.map((marker) => <i key={`f${marker}`} className={styles.finishMark} style={{ left: `${(marker / frames) * 100}%` }} />)}
        <i className={styles.cursor} style={{ left: `${(frame / frames) * 100}%` }} />
      </div>
      <input
        type="range"
        className={styles.scrub}
        min={0}
        max={Math.max(frames - 1, 0)}
        value={frame}
        onChange={(event) => goTo(Number(event.target.value))}
        aria-label="Move through the video"
      />

      {scene ? (
        <div className={styles.liveTiles}>
          <div><span>Body</span><strong>{angle(scene.angles.trunk)}</strong></div>
          <div><span>Knee</span><strong>{angle(scene.angles.knee)}</strong></div>
          <div><span>Elbow</span><strong>{angle(scene.angles.elbow)}</strong></div>
        </div>
      ) : null}

      <div className={styles.controls}>
        <div className={styles.controlRow} role="group" aria-label="Step through the frames">
          <span className={styles.group} aria-hidden="true">Step</span>
          <button type="button" className={`button quiet ${styles.wide}`} onClick={() => goTo(frame - 10)}>Back 10</button>
          <button type="button" className="button quiet" onClick={() => goTo(frame - 1)}>Back 1</button>
          <button type="button" className={`button primary ${styles.play}`} onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
          <button type="button" className="button quiet" onClick={() => goTo(frame + 1)}>Forward 1</button>
          <button type="button" className={`button quiet ${styles.wide}`} onClick={() => goTo(frame + 10)}>Forward 10</button>
        </div>
        <div className={styles.controlRow} role="group" aria-label="Jump to a catch or finish">
          <span className={styles.group} aria-hidden="true">Jump</span>
          <button type="button" className="button quiet" onClick={() => jumpTo(rower.catches, -1)}>Last catch</button>
          <button type="button" className="button quiet" onClick={() => jumpTo(rower.catches, 1)}>Next catch</button>
          <button type="button" className="button quiet" onClick={() => jumpTo(rower.finishes, 1)}>Next finish</button>
          <label className={styles.speed}>
            Speed
            <select value={speed} onChange={(event) => {
              const value = Number(event.target.value);
              setSpeed(value);
              if (video.current) video.current.playbackRate = value;
            }}>
              {SPEEDS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.controlRow} role="group" aria-label="The picture">
          <span className={styles.group} aria-hidden="true">Picture</span>
          <button type="button" className={`button quiet ${styles.wide}`} onClick={() => zoom(1 / ZOOM_STEP)}>Zoom out</button>
          <button type="button" className={`button quiet ${styles.wide}`} onClick={() => zoom(ZOOM_STEP)}>Zoom in</button>
          <button type="button" className={`button quiet ${styles.wide}`} onClick={() => setView(FIT)}>Fit</button>
          <button type="button" className="button quiet" onClick={zoomToRower} disabled={!scene}>Zoom to rower</button>
        </div>
        {scene ? (
          <div className={styles.controlRow} role="group" aria-label="Drawn on the picture">
            <span className={styles.group} aria-hidden="true">Show</span>
            {(["limbs", "angles", "targets"] as const).map((layer) => (
              <label key={layer} className={styles.toggle}>
                <input type="checkbox" checked={layers[layer]} onChange={() => setLayers((old) => ({ ...old, [layer]: !old[layer] }))} />
                {layer[0].toUpperCase() + layer.slice(1)}
              </label>
            ))}
            <label className={styles.toggle}>
              <input type="checkbox" checked={follow} onChange={() => setFollow((old) => !old)} />
              Follow
            </label>
          </div>
        ) : null}
      </div>
      <p className={styles.hint}>Turn your phone sideways for a bigger picture.</p>
    </section>
  );
}

function followView(view: View, scene: Scene, frame: number, size: { width: number; height: number }): View {
  const centre = bodyCentre(scene.poses[frame]);
  return centre ? centreOn(view, centre, size.width, size.height) : view;
}

function spread(pointers: Map<number, Point>): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function pointIn(element: HTMLElement, x: number, y: number, view: View, size: { width: number; height: number }): Point {
  const box = element.getBoundingClientRect();
  const unzoomed = { x: ((x - box.left) / box.width) * size.width, y: ((y - box.top) / box.height) * size.height };
  return viewPoint(view, unzoomed);
}
