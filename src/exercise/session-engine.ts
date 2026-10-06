import type { LandmarkEventPayload, PoseFrameEventPayload } from '../../modules/pose-tracker';

import { PositiveFeedbackLatch, pausedFeedback, phaseFeedback, presenceFeedback, priorityPhase, readinessFeedback, setupFeedback, type FeedbackCue } from './feedback';
import { isTrustedSide } from './landmark-trust';
import { angleFromTriplet } from './pose-utils';
import { RepDetector } from './rep-detector';
import { createDiagnostics, readinessDiagnostics, readinessDiagnosticsEnabled } from './readiness-diagnostics';
import { ReadinessGate, type ReadinessPhase } from './stabilize';
import type { ExerciseConfig, Side } from './types';

/** What the session HUD should display after processing one pose frame. */
export type SessionFrameResult = {
  reps: number;
  feedback: FeedbackCue;
  /** True only on the frame a rep was counted. */
  repCompletedThisFrame: boolean;
};

/** The joints the readiness gate must see, derived from the exercise triplets. */
function requiredJoints(config: ExerciseConfig) {
  return [
    ...new Set(
      config.sides.flatMap((side) => {
        const triplet = config.triplets[side];
        return [triplet.hip, triplet.knee, triplet.ankle];
      }),
    ),
  ];
}

/** Torso anchor the gate watches to catch whole-body movement during counting. */
function requiredAnchor(config: ExerciseConfig) {
  return [...new Set(config.sides.map((side) => config.triplets[side].hip))];
}

/**
 * The per-frame exercise pipeline, extracted from the session screen so the
 * ordering rules that decide whether a rep may be counted are testable without a
 * React renderer or a device.
 *
 * The order of operations is the contract and must not be rearranged:
 *
 *   1. an untracked person loses the gate AND both detectors are frozen, so a
 *      half-finished rep can never be completed across a tracking loss;
 *   2. a tracked frame with missing / invisible / non-finite landmarks fails the
 *      gate, which drops readiness and freezes the detectors again;
 *   3. only while the gate is 'ready' are joint angles computed, and only finite
 *      angles reach a detector or update the observed range.
 *
 * Every rejection path preserves already-counted reps. The engine is pure state
 * driven by `handlePoseFrame`, with no timers, no native calls, and no globals.
 *
 * Reps are counted per SESSION, not per leg: a completion is only a new rep if
 * no rep was counted within `minRepIntervalMs`. In a side view the two legs
 * project onto each other and the occluded leg's inferred landmarks move with
 * the visible one, so a single physical extension completes both detectors a
 * frame apart. See countRep() for the full reasoning.
 */
export class SessionEngine {
  private readonly detectors: Record<Side, RepDetector>;
  private readonly gate: ReadinessGate;
  private readonly latch = new PositiveFeedbackLatch();
  private range: { min: number; max: number } | null = null;
  /** Set by end(); makes the engine permanently inert until reset(). */
  private stopped = false;
  private lastFeedback: FeedbackCue;

  /**
   * The session's authoritative rep tally.
   *
   * This is deliberately NOT the sum of the two detectors. See countRep() for
   * why summing them double-counts a single physical movement.
   */
  private countedReps = 0;
  /** One entry per counted rep, so `repRanges.length === reps` always holds. */
  private countedRanges: number[] = [];
  /** Timestamp of the last COUNTED rep; drives the session-scoped cooldown. */
  private lastCountedAtMs: number | null = null;
  /** TEMPORARY: rate-limit state for the device readiness trace. */
  private readonly diagnostics = createDiagnostics();

  constructor(private readonly config: ExerciseConfig) {
    this.detectors = {
      left: new RepDetector(config.thresholds),
      right: new RepDetector(config.thresholds),
    };
    this.gate = new ReadinessGate(requiredJoints(config), config.readiness, requiredAnchor(config));
    this.lastFeedback = setupFeedback();
  }

  get reps(): number {
    return this.countedReps;
  }

  /** Ranges (deg) of every counted rep, in completion order. */
  get repRanges(): number[] {
    return [...this.countedRanges];
  }

  /** Observed knee/hip angle range across the session; null until one is seen. */
  get observedRange(): { min: number; max: number } | null {
    return this.range === null ? null : { ...this.range };
  }

  get readinessPhase(): ReadinessPhase {
    return this.gate.currentPhase;
  }

  /** Pre-Start HUD cue. */
  initialFeedback(): FeedbackCue {
    return setupFeedback();
  }

  /** Clears all per-session state for a fresh Start. */
  reset(): void {
    this.detectors.left.reset();
    this.detectors.right.reset();
    this.gate.reset();
    this.latch.clear();
    this.range = null;
    this.stopped = false;
    this.countedReps = 0;
    this.countedRanges = [];
    this.lastCountedAtMs = null;
    this.lastFeedback = setupFeedback();
  }

  /**
   * Suspends counting mid-session, keeping already-counted reps.
   *
   * Unlike end(), this is NOT terminal: frames fed after a pause are processed
   * again, because resume() has to be able to count. It is the caller's job not
   * to feed frames while paused — the session screen does this by dropping every
   * pose frame unless its phase is 'running'. What pause() guarantees is that
   * the partial cycle in progress is discarded, so the movement that caused the
   * pause can never be completed by whatever happens after the resume.
   */
  pause(): SessionFrameResult {
    this.detectors.left.freeze();
    this.detectors.right.freeze();
    this.latch.clear();
    this.lastFeedback = pausedFeedback();
    return { reps: this.reps, feedback: this.lastFeedback, repCompletedThisFrame: false };
  }

  /**
   * Stops all counting and freezes the final numbers before navigating away.
   *
   * This is terminal: the engine refuses every later frame until reset(). The
   * session screen also drops frames once its phase is 'completed', but making
   * the guarantee here means a completed session cannot be revived even if that
   * guard is later refactored away.
   */
  end(): void {
    this.stopped = true;
    this.detectors.left.freeze();
    this.detectors.right.freeze();
    this.latch.clear();
  }

  /**
   * Processes one native `onPoseFrame` payload. Safe to call for every frame the
   * view emits, in any order, including frames that arrive after `end()` — those
   * are ignored, because `end()` is terminal.
   */
  handlePoseFrame(event: { nativeEvent: PoseFrameEventPayload }): SessionFrameResult {
    if (this.stopped) {
      return { reps: this.reps, feedback: this.lastFeedback, repCompletedThisFrame: false };
    }

    const { timestampMs, presence, landmarks } = event.nativeEvent;
    const left = this.detectors.left;
    const right = this.detectors.right;

    if (presence !== 'tracked') {
      // Requirement A/I: the person left. Lose the gate and freeze both
      // detectors, so the partial cycle is discarded and re-entry has to earn
      // readiness again from scratch.
      this.gate.markLost();
      left.freeze();
      right.freeze();
      this.latch.clear();
      return this.emit(presenceFeedback(presence));
    }

    // Requirements B/C/D: incomplete, non-finite, or low-visibility landmarks
    // fail here. The gate drops to 'waiting' and freezes the detectors, so an
    // occluded frame can neither count a rep nor corrupt the observed range.
    const outcome = this.gate.process(landmarks, timestampMs);

    // The stillness window alone cannot tell postures apart: standing is still
    // and hip-stable, so a person who never sat down is granted counting with a
    // straight leg. Check the STARTING POSTURE at the moment counting would be
    // enabled, and refuse it if the tracked joints are not in the rest regime.
    // Evaluated only here (never per frame) because a genuine rep deliberately
    // leaves that regime when the knee extends. See ReadinessConfig.
    if (outcome.becameReady && !this.restingPostureSatisfied(landmarks)) {
      this.gate.markLost();
      left.freeze();
      right.freeze();
      this.latch.clear();
      this.traceReadiness(landmarks, timestampMs, outcome);
      return this.emit(readinessFeedback(this.gate.currentPhase));
    }

    if (this.gate.currentPhase !== 'ready') {
      left.freeze();
      right.freeze();
      this.latch.clear();
      this.traceReadiness(landmarks, timestampMs, outcome);
      return this.emit(readinessFeedback(this.gate.currentPhase));
    }

    let repCompletedThisFrame = false;
    for (const side of this.config.sides) {
      const angle = angleFromTriplet(
        landmarks,
        this.config.triplets[side],
        this.config.thresholds.minVisibility,
      );
      // Requirement C: a non-finite angle never reaches a detector and never
      // widens the observed range.
      if (!Number.isFinite(angle)) continue;

      this.range =
        this.range === null
          ? { min: angle, max: angle }
          : { min: Math.min(this.range.min, angle), max: Math.max(this.range.max, angle) };

      const outcome = this.detectors[side].process({ angle, timestampMs });
      if (outcome.repCompleted && this.countRep(timestampMs, outcome.repRange)) {
        repCompletedThisFrame = true;
      }
    }

    // Requirement F: timestamps are only used for the rep cooldown, which
    // rejects (rather than invents) reps, so out-of-order or duplicated stamps
    // cannot fabricate a count or an impossible pace.
    const repPhase = priorityPhase(left.currentPhase, right.currentPhase);
    const celebrating = this.latch.observe(repPhase, repCompletedThisFrame);
    this.traceReadiness(landmarks, timestampMs, outcome);
    return this.emit(phaseFeedback(repPhase, celebrating, this.config.id), repCompletedThisFrame);
  }

  /**
   * TEMPORARY: emits the sampled `[NOVEN-READINESS]` device trace.
   *
   * Pure observation — it reads state and logs it, and returns nothing the
   * pipeline uses. Enabled only in a DEV bundle, so release builds do no
   * per-frame work. See `readiness-diagnostics.ts` for the fields and the rate
   * limit.
   */
  private traceReadiness(
    landmarks: LandmarkEventPayload[],
    timestampMs: number,
    outcome: { phase: ReadinessPhase; becameReady: boolean },
  ): void {
    if (!readinessDiagnosticsEnabled()) return;
    const line = readinessDiagnostics(
      this.config,
      landmarks,
      timestampMs,
      this.diagnostics,
      outcome.phase,
      outcome.becameReady,
    );
    if (line !== null) console.log(line);
  }

  /**
   * Decides whether a detector's completion event is a NEW rep, or the same
   * physical movement seen a second time. Returns true only when the rep is
   * counted.
   *
   * WHY THIS EXISTS — the double-count bug
   * -------------------------------------
   * The exercise is filmed from the SIDE. The two legs are then separated along
   * the camera's optical axis rather than across the image, so they project
   * almost on top of each other. The occluded leg has no direct visual evidence,
   * so the pose model infers its hip/knee/ankle from body priors and the visible
   * leg — which means the far leg's estimated 2D angle tracks the near leg's
   * almost exactly. One physical extension therefore produces a *valid-looking
   * full cycle in both detectors*, a frame or two apart, and the old
   * `left.completedReps + right.completedReps` counted the single movement
   * twice. (Reproduced deterministically: one extension produced ranges of
   * 79.42deg on the left and 80.00deg on the right — the same movement measured
   * twice.)
   *
   * THE RULE
   * A rep counts only if no rep has been counted within `minRepIntervalMs`.
   * That threshold already exists and is already documented as "ignore a new rep
   * that finishes within this window of the last one" — but it was implemented
   * *per detector*, so each side could independently satisfy it for one shared
   * movement. Applying the same window to the whole session is the smallest
   * change that makes the code match its own stated intent; no threshold value
   * is altered and no new one is introduced.
   *
   * WHY IT CANNOT SWALLOW A REAL REP
   * Each detector's own cooldown is the same `minRepIntervalMs`, so one leg
   * already cannot produce two reps inside the window. For two *different* legs
   * to both finish a full cycle within 700ms is not physically possible: a
   * single cycle needs the leg to cross 140deg, hold 160deg for `holdFrames`,
   * then return below 140deg for `holdFrames` again. Genuine alternating
   * repetitions are seconds apart and are unaffected.
   *
   * A collapsed completion is not silent about it: it simply does not raise
   * `repCompletedThisFrame`, so neither the HUD nor the voice announces a rep
   * the user did not perform.
   */
  private countRep(timestampMs: number, repRange: number | null): boolean {
    const { minRepIntervalMs } = this.config.thresholds;
    const lastCountedAtMs = this.lastCountedAtMs;

    if (lastCountedAtMs !== null && timestampMs - lastCountedAtMs < minRepIntervalMs) {
      // Same physical movement, observed by the other leg a frame later.
      return false;
    }

    this.countedReps += 1;
    if (repRange !== null) this.countedRanges.push(repRange);
    this.lastCountedAtMs = timestampMs;
    return true;
  }

  /**
   * Whether the tracked joints are inside the exercise's rest regime at the
   * moment readiness would be granted.
   *
   * The key change: posture is judged ONLY over sides that are TRUSTWORTHY
   * (all three landmarks present, finite, visible and present enough to be an
   * observation, not an inference). An unreliable side must be ignored — it may
   * neither veto readiness nor grant it.
   *
   * Rules:
   *  - If no trustworthy side exists, posture is not satisfied (we have no
   *    reliable evidence of the starting position).
   *  - If exactly one trustworthy side exists, that side alone determines
   *    readiness (prevents a dim far ankle from permanently vetoing).
   *  - If two (or more) trustworthy sides exist, BOTH must satisfy the rest
   *    posture (prevents a badly-inferred standing side from accepting a
   *    standing pose).
   *
   * `bentAngleDeg` is the boundary the config already defines as "bent/at rest";
   * no new threshold is introduced.
   */
  private restingPostureSatisfied(landmarks: LandmarkEventPayload[]): boolean {
    if (!this.config.readiness.requireRestingPosture) return true;
    const { minVisibility, bentAngleDeg } = this.config.thresholds;
    const trustworthySides: Side[] = [];

    for (const side of this.config.sides) {
      const triplet = this.config.triplets[side];
      const required = [triplet.hip, triplet.knee, triplet.ankle];
      if (isTrustedSide(landmarks, required, minVisibility)) {
        trustworthySides.push(side);
      }
    }

    if (trustworthySides.length === 0) {
      return false;
    }

    // Every trustworthy side must satisfy the resting posture.
    return trustworthySides.every((side) => {
      const angle = angleFromTriplet(landmarks, this.config.triplets[side], minVisibility);
      return Number.isFinite(angle) && angle <= bentAngleDeg;
    });
  }

  /** Records the cue the HUD is now showing and builds the frame result. */
  private emit(feedback: FeedbackCue, repCompletedThisFrame = false): SessionFrameResult {
    this.lastFeedback = feedback;
    return { reps: this.reps, feedback, repCompletedThisFrame };
  }
}
