import type { PoseLandmarkName } from '../../modules/pose-tracker';

/** Which side of the body a triplet tracks. */
export type Side = 'left' | 'right';

/**
 * The three landmarks that define a joint angle, measured at `vertex`.
 * E.g. for the left knee: hip / knee (vertex) / ankle.
 */
export type AngleTriplet = {
  hip: PoseLandmarkName;
  knee: PoseLandmarkName;
  ankle: PoseLandmarkName;
};

/** Deterministic, per-exercise thresholds shared by the rep detector. */
export type RepThresholds = {
  /** Knee angle (deg) at or below which the leg is considered bent / at rest. */
  bentAngleDeg: number;
  /** Knee angle (deg) at or above which the leg is considered extended. */
  extendedAngleDeg: number;
  /** Minimum observed range (deg) inside a cycle for it to count as a rep. */
  minRangeDeg: number;
  /** Minimum time between two counted reps, to reject jitter / double counts. */
  minRepIntervalMs: number;
  /** Consecutive qualifying frames required to confirm the extended phase. */
  holdFrames: number;
  /** Minimum landmark visibility (0..1) to accept a frame. */
  minVisibility: number;
};

/** Complete static definition of an exercise for the tracker engine. */
export type ExerciseConfig = {
  id: string;
  name: string;
  sides: Side[];
  /** Joint angle triplets per side. */
  triplets: Record<Side, AngleTriplet>;
  thresholds: RepThresholds;
};

/** Rep detector phase machine states. */
export type RepPhase = 'rest' | 'extending' | 'extended' | 'returning';

/** Single frame fed into a rep detector. */
export type RepFrame = {
  /** Joint angle in degrees. */
  angle: number;
  /** Monotonic camera frame timestamp (ms). */
  timestampMs: number;
};

/** What a rep detector returns for a single processed frame. */
export type RepOutcome = {
  repCompleted: boolean;
  /** Observed min/max range (deg) across the completed cycle, if any. */
  repRange: number | null;
  phase: RepPhase;
};

/** Accumulated real session metrics for the result screen. */
export type SessionMetrics = {
  reps: number;
  /** Elapsed active seconds (timer time). */
  durationSeconds: number;
  /** Reps per minute; null when there is not enough data. */
  paceRpm: number | null;
  /** Observed min knee angle (deg); null when no tracked data. */
  rangeMinDeg: number | null;
  /** Observed max knee angle (deg); null when no tracked data. */
  rangeMaxDeg: number | null;
  /** 0..100 similarity of completed rep ranges; null when insufficient. */
  consistencyPct: number | null;
};