import type { GuidedActivity, GuidedStep } from './types';
import { guidedStepCompletion, totalStepSeconds } from './types';

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
 *
 * ============================================================================
 * WHY A STEP IS COMPLETED BY SOMETHING HAPPENING, NOT BY THE CLOCK
 * ============================================================================
 * This session used to count a step as finished the moment the clock passed the
 * step's end, and that was wrong in a way that reached the history. Nobody has to
 * achieve anything for that to happen: a Yoga step whose hold was never once met
 * still counted, because its thirty-five seconds ran out, and the record said so.
 *
 * So completion is now an EVENT, and this class keeps the set of steps that have
 * legitimately been completed. `completedStepIndices` is the single source of
 * truth: `stepsCompleted` is its length, and the step under way is the next index
 * after the last one in it. Nothing else may claim a step.
 *
 * Three things can legitimately complete a step, and only one of them is a clock:
 *
 * - A TIMED step is finished by the session's own step clock reaching its budget.
 *   Nothing is being measured, so the time really is the whole condition - which is
 *   why every Wellness routine, and most Meditation steps, behave exactly as before.
 * - A HOLD step is finished by the pose tracker having watched one unbroken valid
 *   hold of the length the pose requires. This class never inspects a landmark; it
 *   is told, by the screen, on the frame that completed the hold.
 * - A REPS step is finished by the camera engine reaching the target the step
 *   declares. Also told, never measured here.
 *
 * The last two are refused from the clock DELIBERATELY. A timeout is not evidence
 * that anybody did anything, so a hold or a repetition count that has not arrived
 * is simply never granted.
 *
 * WHY A HELD POSE THAT IS NEVER HELD ENDS THE SESSION
 * A pose step's budget is deliberately longer than the hold the pose requires, so
 * there is room to settle into the shape before the step's clock runs out. If the
 * hold still has not arrived by then, the honest reading is that this step was not
 * done - and a session cannot move to the next step it is not allowed to skip.
 * Rather than strand somebody on a step they cannot pass, the budget running out
 * finishes the activity with the step uncounted, and the history says "5 of 6
 * poses" because five of them were done.
 *
 * WHY A STEP IS TOLD APART FROM THE SESSION
 * Advancing on an event means a step can end before its budget is used up, so the
 * session's elapsed time and the step's elapsed time stop being the same number.
 * One offset records where the current step began, which keeps the two from drifting
 * and means a pause needs no separate handling for the step: the session's banked
 * clock already excludes the time spent paused, so neither a held pose finishing
 * early nor a long gap can shift a step's own progress.
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
  /**
   * The steps that have been legitimately completed, in order.
   *
   * THE SOURCE OF TRUTH FOR `stepsCompleted`, and serializable as-is: an ordered
   * list of plain integers, which is what a store can hold and a history can be
   * read back from. It is never empty-but-true and never contains a step that has
   * not happened, and a step can appear at most once.
   *
   * A step that is missing from this list was NOT done - it was abandoned when the
   * session ended, which is a different thing and is reported differently.
   */
  completedStepIndices: readonly number[];
  /** Steps fully finished. Equals the step count once every step has completed. */
  stepsCompleted: number;
  /** True once the session is over, by finishing or by ending early. */
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
  /**
   * Where the CURRENT step began, in the session's own running-time timeline.
   *
   * One number instead of a second pair of clock fields, and it is what makes both
   * kinds of completion behave. A step's own elapsed time is simply the session's
   * elapsed time minus this, so the two can never drift and a pause needs no
   * separate handling for the step - the session's banked clock already excludes
   * the time spent paused.
   *
   * Advancing it is the only place a step boundary is recorded, and WHERE it moves
   * to is what distinguishes the two ways a step ends:
   *
   * - A step the CLOCK finished moves the boundary on by its own budget, so the next
   *   step inherits whatever time is left over. That is what lets a long gap settle
   *   every timed step it really passed rather than stalling on the first one.
   * - A step something ACTUALLY HAPPENED finished moves the boundary to the moment
   *   it was completed, so the next step starts at zero however much of its budget
   *   the old one left unused.
   */
  private stepStartOffsetMs = 0;
  /**
   * Every step legitimately completed, in ascending order.
   *
   * Appended to only by `creditStep`, which is the only method that may do so, so
   * it is ordered and duplicate-free by construction: the step under way only ever
   * moves forwards, and an index already in the list is refused.
   */
  private completedStepIndices: number[] = [];

  constructor(activity: GuidedActivity, nowMs: () => number = Date.now) {
    this.steps = activity.steps;
    this.totalSeconds = totalStepSeconds(activity.steps);
    this.nowMs = nowMs;
  }

  /** The activity's full running time, in seconds. */
  get totalSecondsTotal(): number {
    return this.totalSeconds;
  }

  /** One step's own budget, in ms, clamped so a bad step cannot go negative. */
  private durationMs(step: GuidedStep | undefined): number {
    return Math.max(0, Math.floor(step?.seconds ?? 0)) * MS_PER_SECOND;
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
   * Time the CURRENT step has been running, in ms, capped at that step's budget.
   *
   * Capped for the same reason the session's is, and because a step that is not
   * finished yet and cannot be - a hold whose pose has not been held - would
   * otherwise report more elapsed time than it was ever given.
   */
  private stepElapsedMsNow(): number {
    const duration = this.durationMs(this.steps[this.stepIndex()]);
    const sinceStepStart = this.elapsedMs() - this.stepStartOffsetMs;
    return Math.max(0, Math.min(sinceStepStart, duration));
  }

  /**
   * The index of the step under way: the first one not yet in the completed list.
   *
   * Read from the list rather than kept as its own counter, so the two can never
   * disagree. Clamped to the last step, which is what makes the final step stay on
   * screen once it has been completed instead of running off the end.
   */
  private stepIndex(): number {
    if (this.steps.length === 0) return 0;
    const next = this.completedStepIndices.length;
    return Math.min(Math.max(0, next), this.steps.length - 1);
  }

  /**
   * Records a step as completed and moves the boundary on to the next one.
   *
   * The only writer of `completedStepIndices`, called by `settleTimedSteps` for a
   * budget the clock used up and by `creditCurrentStep` for a hold or a repetition
   * count that actually arrived. Nothing else can credit a step.
   *
   * `usedUpItsBudget` is the whole difference between the two callers, and it says
   * only one thing: whether the step's time was spent. True, the next step inherits
   * the leftover. False, the next step starts from now, because a hold finished at
   * twenty seconds of a thirty-five second budget leaves fifteen seconds that
   * belong to the pose and not to the session.
   */
  private creditStep(index: number, usedUpItsBudget: boolean): void {
    if (index < 0 || index >= this.steps.length) return;
    if (this.completedStepIndices.includes(index)) return;
    this.completedStepIndices.push(index);
    this.stepStartOffsetMs = usedUpItsBudget
      ? this.stepStartOffsetMs + this.durationMs(this.steps[index])
      : this.elapsedMs();
  }

  /**
   * Credits the step whose completion has been reported, and says whether this
   * call was the one that did it.
   *
   * The guards are the whole contract, and each is there because the alternative
   * is a false claim in someone's history:
   *
   * - Only the step UNDER WAY may be completed, so a later step cannot be credited
   *   by reporting out of order, and the completed list can never contain a gap.
   * - Only while running, so a paused session cannot be advanced - and no wall
   *   clock time spent paused can be read as satisfying anything.
   * - Only once per step, so a tracker that reports the same hold on every frame
   *   for the rest of the step counts it once.
   * - Never once finished, so a late frame from a step the session has left cannot
   *   reopen a session that has already been recorded.
   */
  private creditCurrentStep(): boolean {
    if (this.phase !== 'running') return false;
    const index = this.stepIndex();
    if (index >= this.steps.length) return false;
    if (this.completedStepIndices.includes(index)) return false;
    this.creditStep(index, false);
    return true;
  }

  /**
   * Reports that the step under way has actually been completed, and moves on.
   *
   * THIS IS THE WHOLE OF THE EXTERNAL CONTRACT. The caller is not asked to prove
   * anything: it has watched the pose, or counted the repetitions, and this is how
   * that fact reaches the session. It returns true only for the call that really
   * completed the step, so a caller that runs per frame can react once.
   */
  completeStep(stepIndex: number): boolean {
    if (stepIndex !== this.stepIndex()) return false;
    return this.creditCurrentStep();
  }

  /**
   * Reports the repetitions counted for the step under way.
   *
   * Completes the step only if the step actually declares a target AND the count
   * has reached it. A step with no target reports its repetitions and nothing else
   * happens: it is a timed budget that finishes on time exactly as it always did,
   * and it must not become a step that ends whenever somebody moved once.
   *
   * The kind is asked of `guidedStepCompletion` rather than tested here, so that
   * this path and the clock's own settlement cannot disagree about what a step is.
   * A step carrying both a `poseRuleId` and a `targetReps` is a HOLD step, because
   * that function gives the pose priority: asking one camera frame to satisfy two
   * different measurements is not a step that should finish on either one quietly.
   * Without this the repetition count would finish a pose nobody ever held, which
   * is the one false record this whole class exists to prevent.
   *
   * Returns true only for the call that reached the target, so a frame rate that
   * reports the same total thirty times a second still completes the step once.
   */
  reportStepReps(reps: number): boolean {
    const step = this.steps[this.stepIndex()];
    if (step === undefined || step.targetReps === undefined) return false;
    if (guidedStepCompletion(step) !== 'reps') return false;
    if (!Number.isFinite(reps) || reps < step.targetReps) return false;
    return this.creditCurrentStep();
  }

  /**
   * Settles the session against the clock, and the step under way with it.
   *
   * Three things happen here, in this order, and the order is the whole reason it
   * is one function:
   *
   * 1. A TIMED step whose own budget has run out is credited, and the loop
   *    continues so a long gap - a phone that was asleep, a test that jumped the
   *    clock twenty minutes - settles every step it genuinely passed rather than
   *    leaving the session stuck on the first one.
   * 2. The session is finished once every step has been completed. That, and not
   *    the clock, is what finishing now means: an activity whose steps all really
   *    happened is over, even if it happened sooner than its budget allowed for.
   * 3. The session is finished once the activity's whole time is used up, even
   *    though a step is still unaccounted for. That is the "held pose never held"
   *    case, and it finishes with the step uncounted rather than stranding somebody
   *    on a step they cannot pass.
   *
   * Called by every read, so a screen that is merely re-rendering is enough to
   * notice the end of a meditation - and, because it is guarded on `running`, a
   * paused session settles nothing at all: wall-clock time spent paused can never
   * satisfy a step or finish anything.
   */
  private settle(): boolean {
    if (this.phase !== 'running') return this.phase === 'finished';

    this.settleTimedSteps();

    if (this.completedStepIndices.length >= this.steps.length) {
      this.bankRunning();
      this.phase = 'finished';
      return true;
    }

    if (this.elapsedMs() >= this.totalSeconds * MS_PER_SECOND) {
      this.bankRunning();
      this.phase = 'finished';
      return true;
    }
    return false;
  }

  /**
   * Credits every TIMED step whose own budget has genuinely been used up.
   *
   * The loop rather than a single check, so a long gap settles every step it really
   * passed: a phone left asleep, or a test that jumped the clock twenty minutes,
   * must not leave the session stuck on the first step it was asleep through. Each
   * credit moves the step boundary on by that step's own budget, so the next step
   * inherits whatever time is genuinely left over and no step is credited by time
   * that had already been spent before it began.
   *
   * It stops at the first step it may NOT settle - a hold or a repetition count,
   * which only the thing watching the person may declare done. That is the reason
   * a routine with a pose step in the middle of it settles up to the pose and no
   * further, and finishes with the rest uncounted once the activity's time is up.
   */
  private settleTimedSteps(): void {
    if (this.phase !== 'running') return;
    while (this.completedStepIndices.length < this.steps.length) {
      const index = this.stepIndex();
      const step = this.steps[index];
      if (step === undefined || guidedStepCompletion(step) !== 'timed') break;
      if (this.stepElapsedMsNow() < this.durationMs(step)) break;
      this.creditStep(index, true);
    }
  }

  /**
   * Stops the run span, keeping the time it produced.
   *
   * Only the session clock is banked: `stepStartOffsetMs` is a point in that same
   * timeline, so it needs nothing of its own to stay correct while paused. The
   * banked time is not clamped here - an early end keeps the time it really ran -
   * and the session total remains the ceiling that `elapsedMs` reports.
   */
  private bankRunning(): void {
    this.bankedMs = this.elapsedMs();
    this.runningSinceMs = null;
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
   *
   * Settled first, so a step whose budget had already run out by the time they
   * pressed the button is credited - it really had run. Nothing is settled after
   * the clock stops, so the banked time is what decides whether the activity is
   * over or merely paused.
   */
  pause(): void {
    if (this.phase !== 'running') return;
    const finishedBySettling = this.settle();
    this.bankRunning();
    this.phase =
      finishedBySettling || this.bankedMs >= this.totalSeconds * MS_PER_SECOND ? 'finished' : 'paused';
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
   *
   * It settles before it stops, so the steps that had genuinely finished are
   * credited and the step under way is not. Ending here therefore reports exactly
   * what was really done - which is the whole question this class now answers.
   */
  finishEarly(): void {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    this.settle();
    this.bankRunning();
    this.phase = 'finished';
  }

  /** Back to the beginning: no time banked, not running, nothing finished. */
  reset(): void {
    this.phase = 'ready';
    this.bankedMs = 0;
    this.runningSinceMs = null;
    this.stepStartOffsetMs = 0;
    this.completedStepIndices = [];
  }

  /**
   * Where the session has got to, for the screen to render.
   *
   * The step under way is the first step not yet completed, so a session sitting
   * exactly on a boundary shows the step that is beginning rather than the one
   * that just ended - which is now true by construction rather than by arithmetic.
   */
  snapshot(): GuidedSnapshot {
    this.settle();
    const elapsedMs = this.elapsedMs();
    const elapsedSeconds = Math.floor(elapsedMs / MS_PER_SECOND);

    const stepIndex = this.stepIndex();
    const stepElapsedMs = this.stepElapsedMsNow();
    const stepElapsedSeconds = Math.floor(stepElapsedMs / MS_PER_SECOND);

    const finished = this.phase === 'finished';
    const stepsCompleted = this.completedStepIndices.length;
    /*
     * Every step done means there is nothing left to work on, whichever way the
     * last one ended. The step under way is then the last step - it is clamped, not
     * advanced off the end - and it is a step that is COMPLETE, so its own bar is
     * full and there is no time left in it. Without this the step that finished the
     * activity would report a bar at zero and a countdown that had seconds still
     * supposedly remaining, on the one screen where nothing is left.
     */
    const allStepsCompleted = stepsCompleted >= this.steps.length;
    const stepSeconds = Math.max(0, Math.floor(this.steps[stepIndex]?.seconds ?? 0));
    const stepProgress = allStepsCompleted
      ? PROGRESS_MAX
      : stepSeconds === 0
        ? PROGRESS_MAX
        : Math.min(PROGRESS_MAX, stepElapsedMs / (stepSeconds * MS_PER_SECOND));

    return {
      phase: this.phase,
      elapsedSeconds,
      remainingSeconds: allStepsCompleted
        ? 0
        : this.remainingSeconds(stepIndex, stepElapsedSeconds, stepSeconds),
      /*
       * How far through the ACTIVITY, counted in steps rather than in seconds.
       *
       * Steps, because a session can now end sooner than its budget allows - a
       * held pose that completes early - and a bar still reading 60% on a finished
       * screen would be claiming the person had not finished. For an activity made
       * entirely of timed steps this is the same shape it always was: every step
       * runs to its budget, so "N steps done plus a bit of the next" and "seconds
       * elapsed over seconds planned" both reach 1 together, and the bar is never
       * seen to go backwards.
       */
      progress:
        this.steps.length === 0
          ? PROGRESS_MAX
          : Math.min(PROGRESS_MAX, (stepsCompleted + stepProgress) / this.steps.length),
      stepIndex,
      currentStep: this.steps[stepIndex] ?? null,
      stepElapsedSeconds,
      stepElapsedMs,
      completedStepIndices: [...this.completedStepIndices],
      stepsCompleted,
      finished,
      stepProgress,
    };
  }

  /**
   * How much scheduled time is still ahead of the session, in whole seconds.
   *
   * The current step's own unused budget, plus the full budget of every step after
   * it. For an activity of timed steps this is exactly the countdown it always was
   * - the total minus the elapsed time - because each step's budget is spent in
   * order. It differs in exactly one case, and only because a step can now end
   * before its budget is used up: the unused remainder of a step that was completed
   * early is no longer ahead of the session, so the count carries on rather than
   * reporting seconds that are never going to be spent.
   */
  private remainingSeconds(stepIndex: number, stepElapsedSeconds: number, stepSeconds: number): number {
    const currentRemaining = Math.max(0, stepSeconds - stepElapsedSeconds);
    let laterRemaining = 0;
    for (let index = stepIndex + 1; index < this.steps.length; index += 1) {
      laterRemaining += Math.max(0, Math.floor(this.steps[index].seconds));
    }
    return currentRemaining + laterRemaining;
  }
}
