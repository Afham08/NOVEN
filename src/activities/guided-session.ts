import type { GuidedActivity, GuidedStep } from './types';
import { totalStepSeconds } from './types';

/**
 * ============================================================================
 * The guided session clock: start, pause, resume, and step through an activity.
 * ============================================================================
 *
 * WHY THIS IS A SEPARATE, PURE MODULE
 * The rule about what may be counted belongs in code that can be driven a
 * millisecond at a time in a test, with no renderer and no device. This is that
 * code. It is a class rather than a set of functions so a screen can hold one
 * instance in a ref and read from it, and so nothing here depends on React.
 *
 * WHY IT READS A CLOCK INSTEAD OF COUNTING TICKS
 * The session screen asks for the elapsed time whenever it re-renders, which is
 * driven by a one-second interval. If the elapsed time were incremented by that
 * interval, then anything that skipped ticks would silently lose time: the app
 * backgrounded, a slow frame, a phone that throttled a backgrounded timer. So the
 * clock is READ, never accumulated. `nowMs` is injected purely so a test can
 * drive it; the app passes the real clock, and elapsed time is always the
 * difference between now and when the run began, plus whatever was banked by the
 * pauses in between.
 *
 * WHY THE ELAPSED TIME IS CAPPED AT THE ACTIVITY'S LENGTH
 * Because the elapsed time is read rather than counted, a user who pauses a
 * two-minute meditation and comes back an hour later would otherwise be credited
 * with an hour of sitting. A guided activity is over when its steps are over, so
 * the total is a ceiling rather than a target. The user still ended up at
 * "finished", which is the truthful description of where they are.
 */

export type GuidedPhase = 'ready' | 'running' | 'paused' | 'finished';

/** A snapshot of where the session is. Everything the screen shows comes from this. */
export type GuidedSnapshot = {
  phase: GuidedPhase;
  /** Whole seconds the session has actually been running. Never above the total. */
  elapsedSeconds: number;
  /** Whole seconds still to go, counting down. Zero once finished. */
  remainingSeconds: number;
  /** 0..1 through the activity, for the progress bar. */
  progress: number;
  /** Index of the step under way, clamped to the last step. */
  stepIndex: number;
  /** The step under way, or null for an activity with no steps. */
  currentStep: GuidedStep | null;
  /** Seconds into the current step. */
  stepElapsedSeconds: number;
  /**
   * Milliseconds into the current step, at the precision the clock actually has.
   *
   * Exposed because something inside a step needs sub-second accuracy and must not
   * therefore keep a second clock of its own. A breathing phase is four seconds
   * long, and seeding its engine from `stepElapsedSeconds` would start it up to a
   * whole second late - which is a quarter of the phase. Reading this instead means
   * the breathing and the step that contains it are two views of ONE clock, so they
   * cannot drift apart.
   */
  stepElapsedMs: number;
  /** Steps fully finished. Equals the step count once the activity is finished. */
  stepsCompleted: number;
  /** True once every step has run out. */
  finished: boolean;
  /**
   * How far through the CURRENT step the session is, 0..PROGRESS_MAX, for the bar
   * that fills as one step runs into the next.
   */
  stepProgress: number;
};

/** Milliseconds in a second, named so the arithmetic below reads as arithmetic. */
const MS_PER_SECOND = 1000;

/** The highest percentage the step progress bar is allowed to show. */
export const PROGRESS_MAX = 1;

export class GuidedSession {
  private readonly steps: readonly GuidedStep[];
  private readonly totalSeconds: number;
  private readonly nowMs: () => number;

  private phase: GuidedPhase = 'ready';
  /** Time banked by previous run spans, in ms. Survives a pause. */
  private bankedMs = 0;
  /** When the current run span began, or null while not running. */
  private runningSinceMs: number | null = null;

  constructor(activity: GuidedActivity, nowMs: () => number = Date.now) {
    this.steps = activity.steps;
    this.totalSeconds = totalStepSeconds(activity.steps);
    this.nowMs = nowMs;
  }

  /** The activity's full running time, in seconds. */
  get totalSecondsTotal(): number {
    return this.totalSeconds;
  }

  /**
   * Time the session has been running, in ms, capped at the activity's own
   * length. Capped rather than merely reported, so no downstream caller can
   * derive an over-long duration from it.
   */
  private elapsedMs(): number {
    if (this.runningSinceMs === null) return Math.min(this.bankedMs, this.totalSeconds * MS_PER_SECOND);
    const running = Math.max(0, this.nowMs() - this.runningSinceMs);
    return Math.min(this.bankedMs + running, this.totalSeconds * MS_PER_SECOND);
  }

  /**
   * Settles the phase against the clock: once the activity's time is used up, the
   * session is finished whether or not anyone pressed anything. Called by every
   * read, so a screen that is merely re-rendering is enough to notice the end of
   * a meditation.
   */
  private settle(): void {
    if (this.phase === 'running' && this.elapsedMs() >= this.totalSeconds * MS_PER_SECOND) {
      this.bankedMs = this.totalSeconds * MS_PER_SECOND;
      this.runningSinceMs = null;
      this.phase = 'finished';
    }
  }

  /** Begins the session. Does nothing once it has started or finished. */
  start(): void {
    if (this.phase !== 'ready') return;
    this.runningSinceMs = this.nowMs();
    this.phase = 'running';
  }

  /**
   * Banks the time run so far and stops the clock. Not terminal: resuming
   * continues from the same elapsed time, which is what a person who was
   * interrupted expects.
   */
  pause(): void {
    if (this.phase !== 'running') return;
    this.bankedMs = this.elapsedMs();
    this.runningSinceMs = null;
    this.phase = this.bankedMs >= this.totalSeconds * MS_PER_SECOND ? 'finished' : 'paused';
  }

  /** Starts the clock again from a pause. Ignored unless paused. */
  resume(): void {
    if (this.phase !== 'paused') return;
    this.runningSinceMs = this.nowMs();
    this.phase = 'running';
  }

  /**
   * Ends the session early, banking the time it actually ran. This is the "I have
   * had enough" button, so it is deliberately allowed from both running and
   * paused, and it is terminal like finishing is.
   */
  finishEarly(): void {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    this.bankedMs = this.elapsedMs();
    this.runningSinceMs = null;
    this.phase = 'finished';
  }

  /** Back to the beginning: no time banked, not running, nothing finished. */
  reset(): void {
    this.phase = 'ready';
    this.bankedMs = 0;
    this.runningSinceMs = null;
  }

  /**
   * Where the session has got to, for the screen to render.
   *
   * The step under way is the last step whose starting point the session has
   * passed, so a session sitting exactly on a boundary shows the step that is
   * beginning rather than the one that just ended.
   */
  snapshot(): GuidedSnapshot {
    this.settle();
    const elapsedMs = this.elapsedMs();
    const elapsedSeconds = Math.floor(elapsedMs / MS_PER_SECOND);
    const remainingSeconds = Math.max(0, this.totalSeconds - elapsedSeconds);

    let stepStartMs = 0;
    let stepIndex = 0;
    let stepsCompleted = 0;
    for (const [index, step] of this.steps.entries()) {
      const durationMs = Math.max(0, Math.floor(step.seconds)) * MS_PER_SECOND;
      if (elapsedMs >= stepStartMs) stepIndex = index;
      /*
       * A step counts as done when the session has actually reached its end.
       *
       * Deliberately NOT derived from the phase. Deriving it from "finished"
       * would mean a person who tapped End after five seconds of a one-minute
       * meditation was credited with all three of its stages — and that record
       * goes into the history as though they had sat through the whole thing.
       * The time is the evidence, and only the time is the evidence.
       *
       * A step of zero seconds satisfies this at elapsed zero, which is correct:
       * a step that asks for no time is done the moment it begins.
       */
      if (stepStartMs + durationMs <= elapsedMs) stepsCompleted += 1;
      stepStartMs += durationMs;
    }
    if (this.steps.length === 0) stepIndex = 0;

    // How far into the current step the session is, measured from that step's own
    // start rather than from the beginning of the activity.
    const stepOffsetMs = this.steps
      .slice(0, stepIndex)
      .reduce((total, step) => total + Math.max(0, Math.floor(step.seconds)) * MS_PER_SECOND, 0);
    const stepElapsedMs = Math.max(0, elapsedMs - stepOffsetMs);
    const stepElapsedSeconds = Math.floor(stepElapsedMs / MS_PER_SECOND);

    const finished = this.phase === 'finished';
    const currentStepSeconds = Math.max(
      0,
      Math.floor(this.steps[stepIndex]?.seconds ?? 0),
    );
    return {
      phase: this.phase,
      elapsedSeconds,
      remainingSeconds,
      progress:
        this.totalSeconds === 0
          ? PROGRESS_MAX
          : Math.min(PROGRESS_MAX, elapsedMs / (this.totalSeconds * MS_PER_SECOND)),
      stepIndex,
      currentStep: this.steps[stepIndex] ?? null,
      stepElapsedSeconds,
      stepElapsedMs,
      stepsCompleted,
      finished,
      stepProgress:
        currentStepSeconds === 0
          ? PROGRESS_MAX
          : Math.min(PROGRESS_MAX, (elapsedMs - stepOffsetMs) / (currentStepSeconds * MS_PER_SECOND)),
    };
  }
}
