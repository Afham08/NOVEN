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
  /**
   * Largest tolerated gap (ms) between consecutive pose frames. A larger gap
   * means tracking stalled (camera hiccup, device throttle, app backgrounded),
   * so the frames on either side of it are not continuous evidence of one
   * movement and an in-progress rep cycle is discarded rather than joined
   * across the gap. Counted reps are never affected.
   */
  maxFrameGapMs: number;
};

/**
 * Thresholds for the readiness gate. Counting only starts after the tracked
 * joints are visible enough and have held still long enough that the resting
 * posture is established — so walking into the frame, adjusting the phone, or
 * settling into the chair are never counted by the initial stabilization.
 * After counting starts, only a validity break (lost tracking / missing joints)
 * or a large whole-body translation (the body anchor moving too fast between
 * frames, i.e. walking toward or away from the camera) suspends counting, and
 * counting resumes only after the person holds still again.
 */
export type ReadinessConfig = {
  /** Minimum per-landmark visibility (0..1) for the tracked joints. */
  minVisibility: number;
  /** Maximum normalized drift per tracked joint between consecutive frames
   * while considered "still". */
  maxStableDrift: number;
  /** Consecutive stable frames required before counting is enabled. */
  minStableFrames: number;
  /** Minimum continuous stable tracking time (ms) before counting is enabled. */
  minStableMs: number;
  /** Maximum normalized drift per frame of the body anchor (hip midpoint)
   * tolerated while counting. Larger continuous drift, e.g. walking toward the
   * camera, suspends counting. */
  maxAnchorDrift: number;
  /** Consecutive frames where the anchor drifts past `maxAnchorDrift` before
   * counting is suspended. An extreme single-frame jump suspends immediately. */
  anchorDriftSuspendFrames: number;
  /** Maximum normalized distance the body anchor may travel from the position
   * captured at readiness. This catches SLOW whole-body relocation — sitting
   * down, standing up, or walking up to the phone over a second or more — which
   * moves the hips far from the resting baseline but never fast enough to trip
   * `maxAnchorDrift` on any single frame. Generous enough to allow the small
   * postural shifts of a genuine seated rep. */
  maxAnchorOffset: number;
};

/** Complete static definition of an exercise for the tracker engine. */
export type ExerciseConfig = {
  id: string;
  name: string;
  sides: Side[];
  /** Joint angle triplets per side. */
  triplets: Record<Side, AngleTriplet>;
  thresholds: RepThresholds;
  /** Pre-count readiness / stabilization thresholds. */
  readiness: ReadinessConfig;
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