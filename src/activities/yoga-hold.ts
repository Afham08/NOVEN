// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping.
import type { LandmarkEventPayload, PosePresence } from '../../modules/pose-tracker';

import { evaluateYogaPose, type YogaPoseEvaluation } from './yoga-pose-rules';
import type { YogaPoseRule } from './yoga-poses';

/**
 * ============================================================================
 * How long a pose has been genuinely held.
 * ============================================================================
 *
 * A class rather than a function, because the one thing that cannot be derived
 * from a single frame is time: whether the pose has been valid for the last twenty
 * seconds is a question about the frames before this one. Held as state, with the
 * caller handing over the timestamp it already has, so nothing here reads a clock
 * of its own. That makes the whole thing deterministic under test - a sequence of
 * frames with chosen timestamps, no waiting, no sleeping, no flakes.
 *
 * WHY TIMESTAMPS AND NOT FRAME COUNTS
 * "Twenty frames" is only twenty seconds if the camera happens to be delivering
 * twenty frames a second, which it does not: phones drop frames, screens dim, apps
 * go to the background, and a slower device delivers fewer of them. Counting frames
 * would quietly reward a struggling phone with shorter holds. Milliseconds from the
 * frame's own timestamp measure the thing that was actually asked for - time spent
 * in the pose.
 *
 * THE FOUR STAGES, AND WHY THEY ARE NOT THREE
 *   waiting     - not in the pose, or not visible. Nothing banked, nothing owed.
 *   stabilizing - in the pose, but only just. A hold starts from the moment the
 *                 shape has been steady for a moment, so stepping into position
 *                 and being credited straight away cannot complete a pose.
 *   holding     - steady and banking time.
 *   completed   - the full hold elapsed. Terminal, and reached exactly once.
 *
 * WHY A BROKEN POSE RESETS RATHER THAN PAUSES
 * Pausing would let somebody hold a pose for nineteen seconds, step out of it for
 * one frame, and finish it - which is not holding a pose. A break in validity ends
 * the hold and the next hold starts from zero, so the number shown at the end is a
 * stretch of unbroken time that can be pointed at honestly.
 *
 * WHY COMPLETION IS TERMINAL
 * Once a hold is banked, the tracker ignores every later frame. Frames keep
 * arriving for as long as the camera runs, and each one arriving after completion
 * must not re-complete the pose - otherwise the completion that reaches the rest of
 * the app would fire again and again for the remainder of the step.
 */

export type YogaHoldPhase = 'waiting' | 'stabilizing' | 'holding' | 'completed';

/**
 * The display state, which merges the camera's verdict with the clock's.
 *
 * `not-ready` is the stage the evaluator has no opinion about: the shape is right,
 * it has simply not been held long enough yet. `completed` is separate from `valid`
 * because reaching the end of a hold is an event, not a frame state, and the rest
 * of the app needs to be able to notice it exactly once.
 */
export type YogaHoldState = 'not-tracked' | 'not-ready' | 'invalid' | 'valid' | 'completed';

export type YogaHoldSnapshot = {
  phase: YogaHoldPhase;
  /** Merged verdict, ready to render. */
  state: YogaHoldState;
  /** True exactly on the frame that completed the hold, and never again. */
  justCompleted: boolean;
  /** Banked hold time in milliseconds - always one continuous stretch. */
  holdMs: number;
  holdSeconds: number;
  requiredMs: number;
  requiredSeconds: number;
  /** Seconds still owed. Never below zero. */
  remainingSeconds: number;
  /** 0 to 1 against the required hold. */
  progress: number;
  /** The instruction to show or speak, or null when there is nothing to fix. */
  correction: string | null;
  failingConstraintId: string | null;
  /** The camera could not see enough to judge. Distinct from being out of pose. */
  notTracked: boolean;
  /** The underlying geometry verdict, for callers that want the raw call. */
  evaluation: YogaPoseEvaluation | null;
};

/**
 * How long the pose must already be correct before any hold time is banked.
 *
 * The same shape as the seated-posture settle window, and its own constant
 * because this is a different measurement with a different job: there it decides
 * when to believe a seated person is upright, here it stops somebody stepping into
 * position from completing a hold they never held.
 */
export const YOGA_HOLD_SETTLE_MS = 1200;

/**
 * The largest stretch one frame is allowed to contribute.
 *
 * Time does not really disappear between two consecutive camera frames, so a
 * naive implementation would happily credit a two-second gap - the phone locked,
 * the app backgrounded, the camera stalled - as two seconds of holding. Capping
 * each frame's contribution means a gap can never pay for a hold the person did
 * not do, and a stalled camera slows the hold down instead of finishing it.
 *
 * Comfortably above the ~33ms of a 30fps phone, and far below the settle window,
 * so a camera that has stalled long enough to hit this cap has already stopped
 * being able to claim anybody is holding anything.
 */
export const YOGA_HOLD_MAX_FRAME_GAP_MS = 250;

export class YogaHoldTracker {
  private readonly rule: YogaPoseRule;

  private readonly requiredMs: number;

  private phase: YogaHoldPhase = 'waiting';

  private holdMs = 0;

  private completed = false;

  /** Set only on the frame that completes the hold, and cleared as it is read. */
  private completedThisFrame = false;

  /** Timestamp the current unbroken run in the pose began. */
  private runStartMs: number | null = null;

  /** Timestamp the banked time was last extended from. Null until it first extends. */
  private creditedMs: number | null = null;

  /** The most recent timestamp seen at all, used to reject time that did not pass. */
  private lastTimestampMs: number | null = null;

  private paused = false;

  constructor(rule: YogaPoseRule) {
    this.rule = rule;
    this.requiredMs = Math.round(rule.holdSeconds * 1000);
  }

  /**
   * Freezes the hold.
   *
   * The banked time is kept - the pose was held, and a pause does not undo that -
   * but the current run is ended, so the time spent paused is credited to neither
   * side of it. Without that, the first frame after resuming would count the whole
   * gap.
   */
  pause(): void {
    this.paused = true;
    this.runStartMs = null;
    this.creditedMs = null;
  }

  /**
   * Restarts the clock from the next frame.
   *
   * Deliberately takes no timestamp. The only timestamps this class understands
   * are the ones the camera stamps on its frames, and those come from the
   * MediaPipe stream timeline, whose origin is arbitrary and unrelated to the
   * device clock. Handing it a wall-clock time would mix two timelines and could
   * make the very next frame look like it had arrived early, or late by minutes.
   *
   * So resuming forgets the last frame it saw and lets the next one establish the
   * timeline. That costs one frame of banking, which the cap and the nulled
   * `creditedMs` already handle, and the time spent paused is credited to neither
   * side of it.
   */
  resume(): void {
    this.paused = false;
    this.lastTimestampMs = null;
    this.runStartMs = null;
    this.creditedMs = null;
  }

  /** Forgets everything. Used when the step changes or the session is abandoned. */
  reset(): void {
    this.phase = 'waiting';
    this.holdMs = 0;
    this.completed = false;
    this.completedThisFrame = false;
    this.runStartMs = null;
    this.creditedMs = null;
    this.lastTimestampMs = null;
    this.paused = false;
  }

  /**
   * Offers the next frame.
   *
   * `presence` and `landmarks` go through to the evaluator rather than a finished
   * evaluation, so this stays the single place a frame enters the pose system and
   * the camera cannot be read by two different code paths.
   */
  advance(
    presence: PosePresence,
    landmarks: readonly LandmarkEventPayload[],
    timestampMs: number,
  ): YogaHoldSnapshot {
    if (!Number.isFinite(timestampMs) || this.paused) return this.snapshot(null);
    if (this.completed) return this.snapshot(null);

    return this.settle(evaluateYogaPose(this.rule, presence, landmarks), timestampMs);
  }

  private settle(evaluation: YogaPoseEvaluation, timestampMs: number): YogaHoldSnapshot {
    /*
     * A timestamp that has not moved forward is not time passing. Frames can
     * arrive out of order when a camera restarts, and two can share a
     * millisecond. Neither banks anything, and `lastTimestampMs` is deliberately
     * NOT advanced, so the next real frame still measures from the last genuine
     * moment rather than from a duplicate.
     */
    if (this.lastTimestampMs !== null && timestampMs <= this.lastTimestampMs) {
      return this.snapshot(evaluation);
    }
    this.lastTimestampMs = timestampMs;

    if (evaluation.state !== 'valid') {
      /*
       * Out of the pose, out of frame, or not enough of the person visible: all
       * three end the run. `not-tracked` clears the banked time as well, because
       * nobody can say the pose survived a frame the camera did not see.
       */
      this.holdMs = 0;
      this.runStartMs = null;
      this.creditedMs = null;
      this.phase = 'waiting';
      return this.snapshot(evaluation);
    }

    if (this.runStartMs === null) this.runStartMs = timestampMs;

    if (timestampMs - this.runStartMs < YOGA_HOLD_SETTLE_MS) {
      this.phase = 'stabilizing';
      this.creditedMs = null;
      return this.snapshot(evaluation);
    }

    this.phase = 'holding';

    /*
     * Credit the gap since the previous crediting frame, capped. The first frame
     * after the settle window extends nothing: it marks where banking starts.
     */
    if (this.creditedMs === null) {
      this.creditedMs = timestampMs;
    } else {
      const gap = timestampMs - this.creditedMs;
      if (gap > 0) this.holdMs += Math.min(gap, YOGA_HOLD_MAX_FRAME_GAP_MS);
      this.creditedMs = timestampMs;
    }

    if (!this.completed && this.holdMs >= this.requiredMs) {
      this.phase = 'completed';
      this.completed = true;
      this.completedThisFrame = true;
    }

    return this.snapshot(evaluation);
  }

  /**
   * Builds the snapshot the UI reads.
   *
   * `justCompleted` is consumed by being read: the flag is set on one frame and
   * cleared here, so a caller rendering on a timer cannot miss it and cannot be
   * told about it twice.
   */
  private snapshot(evaluation: YogaPoseEvaluation | null): YogaHoldSnapshot {
    const justCompleted = this.completedThisFrame;
    this.completedThisFrame = false;

    const progress = this.requiredMs === 0 ? 1 : Math.min(1, this.holdMs / this.requiredMs);
    const remainingMs = Math.max(0, this.requiredMs - this.holdMs);

    let state: YogaHoldState;
    if (this.completed) {
      state = 'completed';
    } else if (evaluation?.state === 'not-tracked') {
      state = 'not-tracked';
    } else if (evaluation?.state === 'invalid') {
      state = 'invalid';
    } else if (this.phase === 'holding') {
      state = 'valid';
    } else {
      /* In the pose but still settling, or waiting to be put into it. */
      state = 'not-ready';
    }

    return {
      phase: this.phase,
      state,
      justCompleted,
      holdMs: this.holdMs,
      holdSeconds: this.holdMs / 1000,
      requiredMs: this.requiredMs,
      requiredSeconds: this.requiredMs / 1000,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      progress,
      correction: evaluation?.correction ?? null,
      failingConstraintId: evaluation?.failingConstraintId ?? null,
      notTracked: evaluation?.state === 'not-tracked',
      evaluation,
    };
  }
}