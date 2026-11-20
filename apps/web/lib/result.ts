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

/** What the accuracy rating was worked out from, saved so the clip can be measured again. */
export type Evidence = { trunk_px: number | null; coverage: number | null; agreement: number | null };

export type Card = {
  overall: number | null;
  phases: Record<string, number | null>;
  metrics: Metric[];
  /** Measures that are shown and never scored. Missing on results from before they existed. */
  extras?: Metric[];
};

export type Rower = {
  seat: number | null;
  rate_spm: number | null;
  catches: number[];
  finishes: number[];
  strokes: Stroke[];
  timing: Timing | null;
  card: Card;
  rating: Rating;
  /** Why no scores were given, when the footage cannot support any. */
  no_scores?: string | null;
  /** Catch frames of strokes filmed end-on, which are listed but do not count. */
  left_out?: number[];
  evidence?: Evidence | null;
  /** The change in each measure from the first half of the strokes to the second. */
  fade?: Record<string, number | null>;
};

/** One seat's headline figures, for reading a crew side by side. */
export type CrewSeat = {
  seat: number | null;
  overall: number | null;
  band: Rating["band"];
  catch_lean_deg: number | null;
  finish_lean_deg: number | null;
  leader_seat: number | null;
  catch_ms: number | null;
  finish_ms: number | null;
};

export type CrewSummary = {
  seats: CrewSeat[];
  /** True for a sweep crew, where only seats on the same side are compared. Missing on older results. */
  along_sides?: boolean;
  /** The gap in degrees between the seats furthest apart. */
  catch_lean_range_deg: number | null;
  finish_lean_range_deg: number | null;
};

export type Shot = { start: number; end: number; kind: string };

export type Summary = {
  fps: number;
  frames: number;
  view_deg: number | null;
  film_closer: string | null;
  /** Stretches of frames, as [start, end), filmed from the other side of the boat. Missing on older results. */
  other_side?: number[][];
  warnings: string[];
  shots: Shot[];
  facing: number;
  rower: Rower | null;
  /** Every seat, when the whole crew was measured. */
  crew?: Rower[] | null;
  crew_summary?: CrewSummary | null;
};

/** Stored apart from the summary, and deleted with the video. */
export type FrameData = {
  views: Series | null;
  poses?: Pose[];
  angles?: { trunk: Series; knee: Series; elbow: Series };
  /** Each seat's own poses and angles, by seat number, when the whole crew was measured. */
  crew?: Record<string, { poses?: Pose[]; angles?: { trunk: Series; knee: Series; elbow: Series } }>;
};
