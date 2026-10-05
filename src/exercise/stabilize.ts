import { isTrustedLandmark } from './landmark-trust';
import type { LandmarkEventPayload, PoseLandmarkName } from '../../modules/pose-tracker';

import type { ReadinessConfig } from './types';

/**
 * Readiness phases. Counting is only legal in 'ready'. Once 'ready', the gate
 * stays 'ready' while the required joints stay visible and finite AND the body
 * anchor (hip midpoint) does not shift in a way that implies the whole body is
 * moving through the frame. Losing tracking, showing invalid geometry, or
 * walking toward/away from the camera drops the gate back to 'waiting' so the
 * user must settle again before counting resumes.
 */
export type ReadinessPhase = 'waiting' | 'stabilizing' | 'ready';

/**
 * Groups required landmark names by the body side they belong to, using the
 * MediaPipe `LEFT_`/`RIGHT_` naming convention. A name with no side prefix
 * becomes its own single-landmark group, so a side-less required joint is still
 * all-or-nothing on its own rather than being folded into an unrelated side.
 */
function groupBySide(
  names: readonly PoseLandmarkName[],
): readonly (readonly PoseLandmarkName[])[] {
  const groups = new Map<string, PoseLandmarkName[]>();
  for (const name of names) {
    const key = name.startsWith('LEFT_')
      ? 'left'
      : name.startsWith('RIGHT_')
        ? 'right'
        : name;
    const group = groups.get(key);
    if (group) group.push(name);
    else groups.set(key, [name]);
  }
  return [...groups.values()];
}

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
 *  2. fast whole-body translation Î“Ã‡Ã¶ the `anchorLandmarks` (torso/hip midpoint)
 *     drifting more than `maxAnchorDrift` for `anchorDriftSuspendFrames`
 *     consecutive frames, or one extreme teleport; and
 *  3. slow whole-body relocation Î“Ã‡Ã¶ that anchor ending up further than
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
  /** The anchor landmarks `anchorBaseline` was measured from. */
  private anchorBaselineNames: PoseLandmarkName[] = [];
  private anchorViolations = 0;

  /**
   * The required landmarks grouped per body side, derived from
   * `requiredLandmarks` by its `LEFT_`/`RIGHT_` prefix. Grouping is what makes
   * the gate able to reason about a WHOLE side at once instead of counting
   * individual landmarks: a side is trustworthy only when every landmark that
   * side's geometry needs is trustworthy, and an untrustworthy side may neither
   * veto readiness nor contribute to it.
   */
  private readonly requiredSides: readonly (readonly PoseLandmarkName[])[];

  constructor(
    private readonly requiredLandmarks: PoseLandmarkName[],
    private readonly config: ReadinessConfig,
    /** Torso points that must stay put while counting (e.g. the two hips). */
    private readonly anchorLandmarks: PoseLandmarkName[],
  ) {
    this.requiredSides = groupBySide(requiredLandmarks);
  }

  get currentPhase(): ReadinessPhase {
    return this.phase;
  }

  /** The resting-posture anchor captured on the frame readiness was reached. */
  get baselinePose(): readonly LandmarkEventPayload[] | null {
    return this.baseline;
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
   * anchor Î“Ã‡Ã¶ the hip midpoint built from `anchorLandmarks` Î“Ã‡Ã¶ drifts too much
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
      this.anchorBaselineNames = this.sharedAnchor(valid, valid);
      this.anchorBaseline = this.anchorCentroid(valid, this.anchorBaselineNames);
      return { phase: this.phase, becameReady: true };
    }

    this.phase = 'stabilizing';
    return { phase: this.phase, becameReady: false };
  }

  /**
   * The trustworthiness of one required landmark set, per side.
   *
   * Returns null when NO side is trustworthy — that is the only case where the
   * gate has nothing to measure and must fall back to 'waiting'. A frame where
   * one side is trustworthy and the other is not is deliberately NOT a failure:
   * a far leg hidden behind the near leg is the normal side-view case, and
   * letting it veto readiness is exactly the bug this trust policy exists to
   * fix. The returned map therefore contains only landmarks from trustworthy
   * sides, so drift, stillness and the body anchor can never be computed from
   * a model-inferred point.
   */
  private extractValid(
    landmarks: LandmarkEventPayload[],
  ): Map<PoseLandmarkName, LandmarkEventPayload> | null {
    const valid = new Map<PoseLandmarkName, LandmarkEventPayload>();
    let trustworthySides = 0;

    for (const side of this.requiredSides) {
      const byName = new Map(landmarks.map((landmark) => [landmark.name, landmark]));
      const sideIsTrusted = side.every((name) =>
        isTrustedLandmark(byName.get(name), this.config.minVisibility),
      );
      if (!sideIsTrusted) continue;
      trustworthySides += 1;
      for (const name of side) {
        valid.set(name, byName.get(name)!);
      }
    }

    return trustworthySides === 0 ? null : valid;
  }

  /**
   * Max normalized planar drift of any tracked landmark vs the previous frame,
   * measured only over landmarks that are trustworthy in BOTH frames.
   *
   * Landmarks that dropped out of the trustworthy set are simply not compared,
   * rather than resetting the window: a far leg that stops being visible is not
   * the body moving, and letting it do so would re-introduce the same veto this
   * file exists to remove.
   */
  private maxDrift(
    current: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): number | null {
    if (!this.previous) return null;
    let max = 0;
    let compared = 0;
    for (const [name, after] of current) {
      const before = this.previous.get(name);
      if (!before) continue;
      compared += 1;
      const d = Math.hypot(after.x - before.x, after.y - before.y);
      if (d > max) max = d;
    }
    return compared === 0 ? 0 : max;
  }

  /**
   * Drift of the body anchor vs the previous frame. The anchor is the centroid
   * of `anchorLandmarks` (the two hips for seated knee extension), so knee/ankle
   * movement during a rep does not move it but walking does. Returns null when
   * there is no reference yet.
   *
   * The centroid is taken over the anchor landmarks trustworthy in BOTH frames,
   * so the anchor can never appear to jump merely because tracking moved from one
   * side to the other.
   */
  private anchorDrift(
    current: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): number | null {
    if (!this.previous) return null;
    const shared = this.sharedAnchor(this.previous, current);
    const before = this.anchorCentroid(this.previous, shared);
    const after = this.anchorCentroid(current, shared);
    if (before === null || after === null) return 0;
    return Math.hypot(after.x - before.x, after.y - before.y);
  }

  /**
   * Distance of the current body anchor from the anchor captured at readiness.
   * This is the slow-motion counterpart to `anchorDrift`: a person who sits
   * down or walks up to the phone never moves the hips fast enough to breach
   * `maxAnchorDrift` in a single frame, but they end up far from where they
   * were when counting was enabled. Returns null when no anchor was captured
   * yet (first frame after readiness is impossible, but the type is honest).
   *
   * Like `anchorDrift`, this compares only the anchor landmarks that were
   * trustworthy when the baseline was captured.
   */
  private anchorOffset(
    current: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): number | null {
    if (!this.anchorBaseline || this.anchorBaselineNames.length === 0) return null;
    const after = this.anchorCentroid(current, this.anchorBaselineNames);
    if (after === null) return 0;
    return Math.hypot(after.x - this.anchorBaseline.x, after.y - this.anchorBaseline.y);
  }

  /**
   * The anchor landmark names present and trustworthy in BOTH landmark sets.
   * An empty result means there is nothing to compare, which callers read as "no
   * motion signal" rather than "no motion at all".
   */
  private sharedAnchor(
    a: Map<PoseLandmarkName, LandmarkEventPayload>,
    b: Map<PoseLandmarkName, LandmarkEventPayload>,
  ): PoseLandmarkName[] {
    return this.anchorLandmarks.filter((name) => a.has(name) && b.has(name));
  }

  /**
   * Centroid of the anchor landmarks that are both configured and present in
   * `landmarks`, optionally restricted to `only`. Null when that leaves nothing,
   * which is the honest "the anchor is unobservable right now" answer.
   */
  private anchorCentroid(
    landmarks: Map<PoseLandmarkName, LandmarkEventPayload>,
    only: readonly PoseLandmarkName[] = this.anchorLandmarks,
  ): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let count = 0;
    for (const name of only) {
      const lm = landmarks.get(name);
      if (lm && Number.isFinite(lm.x) && Number.isFinite(lm.y)) {
        x += lm.x;
        y += lm.y;
        count += 1;
      }
    }
    if (count === 0) return null;
    return { x: x / count, y: y / count };
  }

  private dropToWaiting(): void {
    this.phase = 'waiting';
    this.stableFrames = 0;
    this.stableSinceMs = null;
    this.previous = null;
    this.baseline = null;
    this.anchorBaseline = null;
    this.anchorBaselineNames = [];
    this.anchorViolations = 0;
  }
}
