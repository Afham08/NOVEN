import type { LandmarkEventPayload, PoseLandmarkName } from '../../modules/pose-tracker';

import type { ReadinessConfig } from './types';
import { getLandmark } from './pose-utils';

/**
 * Readiness phases. Counting is only legal in 'ready'. Once 'ready', the gate
 * stays 'ready' while the required joints stay visible and finite AND the body
 * anchor (hip midpoint) does not shift in a way that implies the whole body is
 * moving through the frame. Losing tracking, showing invalid geometry, or
 * walking toward/away from the camera drops the gate back to 'waiting' so the
 * user must settle again before counting resumes.
 */
export type ReadinessPhase = 'waiting' | 'stabilizing' | 'ready';

export type ReadinessOutcome = {
  phase: ReadinessPhase;
  /** True exactly once, on the frame the gate flipped into 'ready'. */
  becameReady: boolean;
};

/**
 * Pre-count stabilization gate that sits BEFORE the rep detector. It exists to
 * stop the rep counter from ever recording movement that is not an exercise
 * rep (walking into the frame, re-adjusting the phone, settling into a chair).
 *
 * A frame qualifies only when every required joint is present, has finite
 * coordinates, and is at least `minVisibility` visible. While qualifying, the
 * gate measures how far each required joint drifts between consecutive frames;
 * frames where the pose is nearly still count toward the calm window. Only
 * after `minStableFrames` consecutive calm frames spanning at least
 * `minStableMs` does the gate reach 'ready', at which point it anchors the
 * resting baseline pose.
 *
 * Once ready, rep movement is expected and does NOT demote the gate, but three
 * kinds of motion do:
 *  1. a validity break (person lost or joints below threshold);
 *  2. fast whole-body translation — the `anchorLandmarks` (torso/hip midpoint)
 *     drifting more than `maxAnchorDrift` for `anchorDriftSuspendFrames`
 *     consecutive frames, or one extreme teleport; and
 *  3. slow whole-body relocation — that anchor ending up further than
 *     `maxAnchorOffset` from where it sat when readiness was granted, which is
 *     what a person sitting down, standing up, or strolling toward the phone
 *     looks like.
 * Together these separate "the knee moved" (a rep) from "the whole body moved"
 * to a new place (setup), so setup can never be scored as a rep. Neither signal
 * fires for a genuine seated rep, because a knee extension leaves the hips put.
 * All of them drop the gate back to 'waiting', and re-entry always needs a
 * fresh calm window. This is a stateful but pure class: no timers, no globals,
 * tests can drive it frame-by-frame with synthetic poses.
 */
export class ReadinessGate {
  private phase: ReadinessPhase = 'waiting';
  private stableFrames = 0;
  private stableSinceMs: number | null = null;
  private previous: Map<PoseLandmarkName, LandmarkEventPayload> | null = null;
  private baseline: readonly LandmarkEventPayload[] | null = null;
  private anchorBaseline: { x: number; y: number } | null = null;
  private anchorViolations = 0;

  constructor(
    private readonly requiredLandmarks: PoseLandmarkName[],
    private readonly config: ReadinessConfig,
    /** Torso points that must stay put while counting (e.g. the two hips). */
    private readonly anchorLandmarks: PoseLandmarkName[],
  ) {}

  get currentPhase(): ReadinessPhase {
    return this.phase;
  }

  /** The resting-posture anchor captured on the frame readiness was reached. */
  get baselinePose(): readonly LandmarkEventPayload[] | null {
    return this.baseline;
  }

  // TEMPORARY DIAGNOSTIC — remove with src/exercise/pose-diagnostics.ts after the
  // physical-device retest. Read-only view of the value that drops readiness, so
  // the log can show HOW FAR the hips were from the anchor when the gate let a
  // frame through. Callers must not branch on this.
  get anchorOffsetFromAnchor(): number | null {
    return this.previous === null ? null : this.anchorOffset(this.previous);
  }

  /** Restarts the full gate (session start). */
  reset(): void {
    this.dropToWaiting();
  }

  /** Call on frames where the model reports the person is not tracked. */
  markLost(): void {
    this.dropToWaiting();
  }

  /**
   * Feeds one tracked frame. Returns the resulting phase; inspect
   * `becameReady` to detect the exact moment counting may begin.
   *
   * Stillness (frame-to-frame drift) only gates the initial acquisition: a rep
   * is by definition movement, so once 'ready' the gate does not demote just
   * because the knee moved. It DOES demote when either (a) validity breaks
   * (person lost or joints missing/too far below visibility), (b) the body
   * anchor — the hip midpoint built from `anchorLandmarks` — drifts too much
   * between consecutive frames, i.e. the whole body is translating through the
   * frame quickly (striding across it), or (c) that anchor has travelled
   * further than `maxAnchorOffset` from its resting position, i.e. the body is
   * relocating slowly (sitting down, standing up, walking up to the phone).
   * Re-entry always requires a fresh calm window before counting resumes.
   */
  process(landmarks: LandmarkEventPayload[], timestampMs: number): ReadinessOutcome {
    const valid = this.extractValid(landmarks);
    if (!valid) {
      this.dropToWaiting();
      return { phase: this.phase, becameReady: false };
    }

    if (this.phase === 'ready') {
      const anchorDrift = this.anchorDrift(valid);
      const anchorOffset = this.anchorOffset(valid);
      this.previous = valid;

      const drift = anchorDrift !== null ? anchorDrift : 0;
      const extreme = drift > this.config.maxAnchorDrift * 4;
      if (extreme) {
        // One huge translation (teleport / step across the frame) is an
        // immediate, unambiguous walk-away: suspend right now.
        this.dropToWaiting();
        return { phase: this.phase, becameReady: false };
      }

      // Two independent whole-body motion signals, either of which means the
      // person is relocating rather than exercising:
      //  - `drift`: fast motion, caught frame-to-frame (stride across frame).
      //  - `offset`: slow motion, caught against the resting anchor captured at
      //    readiness (sitting down, standing up, strolling toward the phone).
      // A rep moves the knee and ankle while the hips stay put, so neither
      // signal fires for legitimate exercise.
      const drifting = drift > this.config.maxAnchorDrift;
      const displaced = anchorOffset !== null && anchorOffset > this.config.maxAnchorOffset;
      this.anchorViolations = drifting || displaced ? this.anchorViolations + 1 : 0;

      if (this.anchorViolations >= this.config.anchorDriftSuspendFrames) {
        this.dropToWaiting();
      }
      return { phase: this.phase, becameReady: false };
    }

    const drift = this.maxDrift(valid);
    this.previous = valid;

    if (drift === null) {
      // First tracked frame in this window: only anchors the reference.
      return { phase: this.phase, becameReady: false };
    }

    if (drift > this.config.maxStableDrift) {
      this.dropToWaiting();
      return { phase: this.phase, becameReady: false };
    }

    this.stableSinceMs = this.stableSinceMs ?? timestampMs;
    this.stableFrames += 1;

    const calmEnough =
      this.stableFrames >= this.config.minStableFrames &&
      timestampMs - this.stableSinceMs >= this.config.minStableMs;

    if (calmEnough) {
      this.phase = 'ready';
      this.baseline = landmarks.map((landmark) => ({ ...landmark }));
      this.anchorBaseline = this.anchorCentroid(valid);
      return { phase: this.phase, becameReady: true };
    }

    this.phase = 'stabilizing';
    return { phase: this.phase, becameReady: false };
  }

  /** True when all required joints are present, finite, and visible enough. */
  private extractValid(
    landmarks: LandmarkEventPayload[],
  ): Map<PoseLandmarkName, LandmarkEventPayload> | null {
    const valid = new Map<PoseLandmarkName, LandmarkEventPayload>();
    for (const name of this.requiredLandmarks) {
      const landmark = getLandmark(landmarks, name);
      if (!landmark) return null;
      if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
      if (landmark.visibility < this.config.minVisibility) return null;
      valid.set(name, landmark);
    }
    return valid;
  }

  /** Max normalized planar drift of any required joint vs the previous frame. */
  private maxDrift(
    current: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): number | null {
    if (!this.previous) return null;
    let max = 0;
    for (const name of this.requiredLandmarks) {
      const before = this.previous.get(name);
      const after = current.get(name);
      if (!before || !after) return null;
      const d = Math.hypot(after.x - before.x, after.y - before.y);
      if (d > max) max = d;
    }
    return max;
  }

  /**
   * Drift of the body anchor vs the previous frame. The anchor is the centroid
   * of `anchorLandmarks` (the two hips for seated knee extension), so knee/ankle
   * movement during a rep does not move it — but walking does. Returns null
   * when there is no reference yet or an anchor joint is missing.
   */
  private anchorDrift(
    current: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): number | null {
    if (!this.previous) return null;
    const before = this.anchorCentroid(this.previous);
    const after = this.anchorCentroid(current);
    if (before === null || after === null) return null;
    return Math.hypot(after.x - before.x, after.y - before.y);
  }

  /**
   * Distance of the current body anchor from the anchor captured at readiness.
   * This is the slow-motion counterpart to `anchorDrift`: a person who sits
   * down or walks up to the phone never moves the hips fast enough to breach
   * `maxAnchorDrift` in a single frame, but they end up far from where they
   * were when counting was enabled. Returns null when no anchor was captured
   * yet (first frame after readiness is impossible, but the type is honest).
   */
  private anchorOffset(
    current: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): number | null {
    if (!this.anchorBaseline) return null;
    const now = this.anchorCentroid(current);
    if (now === null) return null;
    return Math.hypot(now.x - this.anchorBaseline.x, now.y - this.anchorBaseline.y);
  }

  private anchorCentroid(
    frames: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): { x: number; y: number } | null {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const name of this.anchorLandmarks) {
      const landmark = frames.get(name);
      if (!landmark) continue;
      sx += landmark.x;
      sy += landmark.y;
      count += 1;
    }
    if (count === 0) return null;
    return { x: sx / count, y: sy / count };
  }

  private dropToWaiting(): void {
    this.phase = 'waiting';
    this.stableFrames = 0;
    this.stableSinceMs = null;
    this.previous = null;
    this.baseline = null;
    this.anchorBaseline = null;
    this.anchorViolations = 0;
  }
}