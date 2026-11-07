/** The shape of a result, as made by rowvision/report.py and split by the worker. */

export type Joint = [x: number, y: number, score: number];
export type Pose = (Joint | null)[] | null;
export type Series = (number | null)[];

export type Target = { low: number; high: number | null; sources: string[]; evidence: string };

export type Metric = {
  name: string;
  label: string;
  phase: string;
  value: number | null;
  spread: number | null;
  target: Target | null;
  score: number | null;
  reason: string | null;
};

export type Rating = {
  accuracy: number;
  band: "Excellent" | "Great" | "Good" | "Fair" | "Poor";
  calibrated: boolean;
  labelled_frames: number;
  warnings: string[];
};

export type Timing = {
  leader_seat: number | null;
  catch_ms: number | null;
  finish_ms: number | null;
  catch_spread_ms: number | null;
  finish_spread_ms: number | null;
  strokes: number;
};

export type Stroke = Record<string, number | null> & { catch_frame: number; finish_frame: number };

export type Rower = {
  seat: number | null;
  rate_spm: number | null;
  catches: number[];
  finishes: number[];
  strokes: Stroke[];
  timing: Timing | null;
  card: { overall: number | null; phases: Record<string, number | null>; metrics: Metric[] };
  rating: Rating;
};

export type Shot = { start: number; end: number; kind: string };

export type Summary = {
  fps: number;
  frames: number;
  view_deg: number | null;
  film_closer: string | null;
  warnings: string[];
  shots: Shot[];
  facing: number;
  rower: Rower | null;
};

/** Stored apart from the summary, and deleted with the video. */
export type FrameData = {
  views: Series | null;
  poses?: Pose[];
  angles?: { trunk: Series; knee: Series; elbow: Series };
};
