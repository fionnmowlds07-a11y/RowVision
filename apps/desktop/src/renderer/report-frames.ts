// Pictures for the PDF report: the rower cropped from the video at each catch and finish,
// with their lines and angles drawn bold on top.
import { drawAngles, drawPose, type Scene } from "@/app/clips/[id]/draw";
import type { Pose } from "@/lib/result";

export const WIDTH = 960;
export const HEIGHT = 540;
/** How much room is left round the rower, as a share of their size. */
const ROOM = 1.7;
const MIN_SPAN = 220;
/** Line and label sizes in picture pixels, much bolder than on screen. */
const LINE = 7;
const LABEL = 3.4;

/** The part of the video to crop, round the rower's joints, in 16 by 9. */
export function cropAround(pose: Pose | undefined, videoWidth: number, videoHeight: number): { x: number; y: number; width: number; height: number } {
  const seen = (pose ?? []).filter((joint): joint is NonNullable<typeof joint> => joint !== null);
  if (seen.length === 0) return { x: 0, y: 0, width: videoWidth, height: videoHeight };
  const xs = seen.map((joint) => joint[0]);
  const ys = seen.map((joint) => joint[1]);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const width = Math.min(videoWidth, Math.max(MIN_SPAN, (right - left) * ROOM, (bottom - top) * ROOM * (16 / 9)));
  const height = width * (9 / 16);
  return { x: (left + right) / 2 - width / 2, y: (top + bottom) / 2 - height / 2, width, height };
}

/** Seeks through the clip once and returns a JPEG for each frame asked for, by frame. */
export async function capture(
  link: string,
  fps: number,
  jobs: { scene: Scene | null; frames: number[]; done: (frame: number, picture: string) => void }[],
  onStep: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<void> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.src = link;
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error("The video could not be read.")), { once: true });
  });
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const paint = canvas.getContext("2d")!;
  const total = jobs.reduce((sum, job) => sum + job.frames.length, 0);
  let count = 0;
  try {
    for (const { scene, frames, done } of jobs) {
      for (const frame of frames) {
        if (cancelled()) return;
        await new Promise<void>((resolve) => {
          video.addEventListener("seeked", () => resolve(), { once: true });
          video.currentTime = (frame + 0.5) / fps;
        });
        const crop = cropAround(scene?.poses[frame], video.videoWidth, video.videoHeight);
        const scale = WIDTH / crop.width;
        paint.setTransform(1, 0, 0, 1, 0, 0);
        paint.fillStyle = "#000";
        paint.fillRect(0, 0, WIDTH, HEIGHT);
        paint.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
        paint.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        if (scene) {
          drawPose(paint, scene, frame, LINE / scale);
          drawAngles(paint, scene, frame, LABEL / scale);
        }
        done(frame, canvas.toDataURL("image/jpeg", 0.86));
        count += 1;
        onStep(count, total);
      }
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
