import type { PoseFrameEventPayload } from '../../modules/pose-tracker';

import { PositiveFeedbackLatch, pausedFeedback, phaseFeedback, presenceFeedback, priorityPhase, readinessFeedback, setupFeedback, type FeedbackCue } from './feedback';
// TEMPORARY DIAGNOSTIC — remove with src/exercise/pose-diagnostics.ts after the
// physical-device retest confirms which detector produced the false rep.
import { emptySideDiagnostic, isDevBuild, logFrameDiagnostic, resetFrameDiagnostics, type SideDiagnostic } from './pose-diagnostics';
import { angleFromTriplet } from './pose-utils';
import { RepDetector } from './rep-detector';
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
    resetFrameDiagnostics(); // TEMPORARY DIAGNOSTIC
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

    // TEMPORARY DIAGNOSTIC — remove with src/exercise/pose-diagnostics.ts.
    const angles: Record<Side, number | null> = { left: null, right: null };
    const completions: Record<Side, SideDiagnostic> = {
      left: emptySideDiagnostic(),
      right: emptySideDiagnostic(),
    };

    if (presence !== 'tracked') {
      // Requirement A/I: the person left. Lose the gate and freeze both
      // detectors, so the partial cycle is discarded and re-entry has to earn
      // readiness again from scratch.
      this.gate.markLost();
      left.freeze();
      right.freeze();
      this.latch.clear();
      this.logDiagnostic(timestampMs, presence, angles, completions);
      return this.emit(presenceFeedback(presence));
    }

    // Requirements B/C/D: incomplete, non-finite, or low-visibility landmarks
    // fail here. The gate drops to 'waiting' and freezes the detectors, so an
    // occluded frame can neither count a rep nor corrupt the observed range.
    this.gate.process(landmarks, timestampMs);

    if (this.gate.currentPhase !== 'ready') {
      left.freeze();
      right.freeze();
      this.latch.clear();
      this.logDiagnostic(timestampMs, presence, angles, completions);
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

      angles[side] = angle; // TEMPORARY DIAGNOSTIC

      this.range =
        this.range === null
          ? { min: angle, max: angle }
          : { min: Math.min(this.range.min, angle), max: Math.max(this.range.max, angle) };

      const outcome = this.detectors[side].process({ angle, timestampMs });
      // TEMPORARY DIAGNOSTIC: record every DETECTOR-level completion, including
      // the ones the session cooldown then rejects, so the log shows whether a
      // false rep came from one side or from both.
      if (outcome.repCompleted) {
        completions[side] = { ...completions[side], completed: true, completedRange: outcome.repRange };
      }
      if (outcome.repCompleted && this.countRep(timestampMs, outcome.repRange)) {
        repCompletedThisFrame = true;
      }
    }

    this.logDiagnostic(timestampMs, presence, angles, completions); // TEMPORARY DIAGNOSTIC

    // Requirement F: timestamps are only used for the rep cooldown, which
    // rejects (rather than invents) reps, so out-of-order or duplicated stamps
    // cannot fabricate a count or an impossible pace.
    const repPhase = priorityPhase(left.currentPhase, right.currentPhase);
    const celebrating = this.latch.observe(repPhase, repCompletedThisFrame);
    return this.emit(phaseFeedback(repPhase, celebrating), repCompletedThisFrame);
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
   * TEMPORARY DIAGNOSTIC — remove with src/exercise/pose-diagnostics.ts after the
   * physical-device retest. Dev-only and change-driven, so it is a no-op in
   * release builds and stays silent on frames where nothing material moved.
   */
  private logDiagnostic(
    timestampMs: number,
    presence: string,
    angles: Record<Side, number | null>,
    completions: Record<Side, SideDiagnostic>,
  ): void {
    if (!isDevBuild()) return;

    const sideState = (side: Side): SideDiagnostic => {
      const { min, max } = this.detectors[side].cycleBounds;
      return {
        angle: angles[side],
        phase: this.detectors[side].currentPhase,
        armed: this.detectors[side].isArmed,
        cycleMin: min,
        cycleMax: max,
        completed: completions[side].completed,
        completedRange: completions[side].completedRange,
      };
    };

    logFrameDiagnostic({
      timestampMs,
      presence,
      gatePhase: this.gate.currentPhase,
      anchorOffset: this.gate.anchorOffsetFromAnchor,
      left: sideState('left'),
      right: sideState('right'),
      sessionReps: this.countedReps,
    });
  }

  /** Records the cue the HUD is now showing and builds the frame result. */
  private emit(feedback: FeedbackCue, repCompletedThisFrame = false): SessionFrameResult {
    this.lastFeedback = feedback;
    return { reps: this.reps, feedback, repCompletedThisFrame };
  }
}
