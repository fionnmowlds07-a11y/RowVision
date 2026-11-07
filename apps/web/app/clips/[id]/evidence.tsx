"use client";

import { useEffect, useMemo, useRef } from "react";
import { bodyCentre, evidenceFrames, formatValue, measureKind } from "@/lib/logic";
import type { Metric, Rower } from "@/lib/result";
import { drawAngles, drawPose, drawTargets, type Scene } from "./draw";
import styles from "./clip.module.css";

const MIN_SPAN = 120; // Video pixels across a freeze frame.
const SPAN_SHARE = 1 / 8;
const WIDTH = 160;
const HEIGHT = 120;
const MAX_SHOWN = 12;

type Props = {
  link: string;
  fps: number;
  metric: Metric;
  rower: Rower;
  scene: Scene | null;
  onPick: (frame: number) => void;
};

/** One freeze frame a stroke, at the moment the measure was read. */
export function Evidence({ link, fps, metric, rower, scene, onPick }: Props) {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const items = useMemo(() => evidenceFrames(metric.name, rower.strokes).slice(0, MAX_SHOWN), [metric.name, rower.strokes]);
  const kind = measureKind(metric.name) ?? undefined;

  useEffect(() => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = link;
    let index = 0;
    let live = true;

    function next() {
      if (!live || index >= items.length) return;
      video.currentTime = (items[index].frame + 0.5) / fps;
    }

    function paint() {
      const target = canvases.current[index];
      const paintbrush = target?.getContext("2d");
      if (paintbrush) {
        const { frame } = items[index];
        const span = Math.max(MIN_SPAN, video.videoWidth * SPAN_SHARE);
        const scale = WIDTH / span;
        const line = 1 / scale;
        const centre = scene && bodyCentre(scene.poses[frame]);
        const x = (centre?.x ?? video.videoWidth / 2) - span / 2;
        const y = (centre?.y ?? video.videoHeight / 2) - HEIGHT / scale / 2;
        paintbrush.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
        paintbrush.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        if (scene) {
          drawTargets(paintbrush, scene, frame, line, kind);
          drawPose(paintbrush, scene, frame, line);
          drawAngles(paintbrush, scene, frame, line, kind);
        }
      }
      index += 1;
      next();
    }

    video.addEventListener("loadeddata", next, { once: true });
    video.addEventListener("seeked", paint);
    return () => {
      live = false;
      video.removeEventListener("seeked", paint);
      video.removeAttribute("src");
      video.load();
    };
  }, [fps, items, kind, link, scene]);

  if (items.length === 0) return null;
  return (
    <ul className={styles.freezes}>
      {items.map(({ stroke, frame, value }, index) => (
        <li key={stroke}>
          <button type="button" onClick={() => onPick(frame)} aria-label={`Stroke ${stroke}, go to frame ${frame}`}>
            <canvas ref={(element) => { canvases.current[index] = element; }} width={WIDTH} height={HEIGHT} />
            <span>Stroke {stroke}: {formatValue(metric.name, value)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
