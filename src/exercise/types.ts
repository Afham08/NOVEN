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
  /**
   * Whether counting may only begin once the tracked joints are actually inside
   * the exercise's REST regime, i.e. at least one tracked side's joint angle is
   * at or below `RepThresholds.bentAngleDeg` — the boundary this config already
   * defines as "bent / at rest". No new number is introduced: it reuses
   * `bentAngleDeg` as the definition of the starting posture.
   *
   * WHY THIS EXISTS — "standing still counted a rep"
   * -----------------------------------------------
   * A rep cycle is defined purely by ABSOLUTE angle bands, so any movement that
   * carries a joint from bent to straight and back to bent is indistinguishable
   * from an exercise rep. That is fine while the person is in the posture the
   * exercise is defined from, but the stillness gate cannot tell postures apart:
   * standing is still, and standing is hip-stable, so a person who never sat
   * down was granted counting with a knee angle of ~174deg.
   *
   * A standing person then shifts their weight — an ordinary, non-exercise
   * movement in which the knee genuinely bends past 140deg and straightens
   * again. The `armed` precondition does not and cannot stop this: 130deg really
   * is a bent knee, so arming is the correct response to it. The machine then
   * observes the textbook `bent -> extended -> bent` cycle and counts a rep that
   * was never an exercise movement. Reproduced deterministically at range 44deg
   * and 54deg, with the gate READY and the hips at anchorOffset 0.000 throughout.
   *
   * Requiring the starting posture at the moment counting is granted separates
   * the two cases on the one axis that actually differs: a seated exerciser is
   * bent at rest, a standing bystander is not.
   *
   * It is evaluated ONLY on the frame readiness is granted, never continuously:
   * a genuine rep deliberately leaves the rest regime (the knee extends past
   * 160deg), so checking it per-frame would suppress every real repetition.
   */
  requireRestingPosture: boolean;
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