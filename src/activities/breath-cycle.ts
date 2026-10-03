// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping. The same reason `meditation-guidance.ts` and
// `yoga-hold.ts` use relative imports throughout.

/**
 * ============================================================================
 * The breathing guide: when to breathe in, when to hold, when to breathe out.
 * ============================================================================
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * A metronome for the lungs. It knows the shape of a breathing technique - a list
 * of phases with lengths - and it says what phase is due and how far through it
 * the session is. That is the whole of it.
 *
 * It is NOT a measurement, and there is deliberately no way to make it one. NOVEN
 * has no microphone here and no breathing signal from the camera, so this module
 * has no input that could say whether a person actually breathed in, and no
 * threshold anywhere that could be tuned into one. Nothing it produces may be
 * described as detecting, measuring, counting or confirming a breath: it tells
 * the person WHEN to breathe, and it cannot know whether they did. The words on
 * screen and in the voice come from the phase data and nothing else, which is
 * what makes them safe to say out loud to somebody who did the opposite.
 *
 * WHY IT READS A CLOCK INSTEAD OF COUNTING TICKS
 * The same rule `GuidedSession` and `YogaHoldTracker` already follow. Elapsed time
 * is the difference between now and when the current run span began, plus
 * whatever earlier spans banked - never a counter incremented per update. So a
 * delayed update advances the breathing by the delay rather than by one step, a
 * dropped frame loses nothing, and a phone that throttled a backgrounded timer
 * cannot lose a breath. `nowMs` is injected only so a test can drive it.
 *
 * WHY THE PHASES ARE FOUND BY ARITHMETIC AND NOT BY STEPPING
 * Everything a snapshot reports is computed from one number - the elapsed
 * milliseconds - by dividing into cycles and then walking the technique's own
 * phase list once. A step-shaped implementation that advanced one phase per call
 * would need a loop as long as the delay it was handed: a session resuming after
 * a minute of a phone in a pocket would have to be walked a minute's worth of
 * phases before it could answer, and a timestamp from a stuck clock could make
 * that walk never end. Dividing first makes the walk bounded by the number of
 * phases in the technique - four for box breathing - whatever the elapsed time.
 * There is no loop here whose length depends on how long the session has run.
 *
 * WHY THE ENGINE HAS NO LENGTH OF ITS OWN
 * `GuidedSession` owns when an activity is over, and a breathing phase must not be
 * able to disagree with it. So this engine deliberately has no total and no
 * deadline: it runs until whoever owns it says `complete()`. A meditation's
 * breathing step is finished by the step's own clock, exactly like every other
 * step in the app, and the screen calls `complete()` when that step ends. One
 * clock decides how long the session is; this one only decides where in the
 * breath the session currently is.
 */

/** Milliseconds in a second, named so the arithmetic below reads as arithmetic. */
const MS_PER_SECOND = 1000;

/** The highest fraction the progress values below are allowed to reach. */
const PROGRESS_MAX = 1;

/**
 * The identity of a breathing phase.
 *
 * The two holds are separate ids rather than one `hold` used twice, because they
 * are different instructions at different moments: one is the top of the box after
 * breathing in, the other is the bottom before breathing in again. An array index
 * would have been the wrong identity for the same reason - it changes if the
 * technique is reordered, so a stored or compared "phase 2" would quietly come to
 * mean something else.
 */
export type BreathPhaseId =
  | 'inhale'
  | 'hold-after-inhale'
  | 'exhale'
  | 'hold-after-exhale';

/** One phase of a technique: what it is, what to call it, and how long it lasts. */
export type BreathPhaseSpec = {
  id: BreathPhaseId;
  /** The single word the screen and the voice use. Never more than one word. */
  label: string;
  /** How long the phase lasts, in seconds. */
  seconds: number;
};

/**
 * A breathing technique, as data.
 *
 * A technique is a list of phases and nothing else - no callbacks, no rules, no
 * behaviour. That is the whole extension point: a future technique is another
 * entry here with different phases and different lengths, and the engine is
 * unchanged, because everything it does is derived from the numbers below.
 */
export type BreathingTechnique = {
  id: string;
  /** How the technique is named in the interface. */
  name: string;
  /** The phases, in the order they are performed, repeating forever. */
  phases: readonly BreathPhaseSpec[];
};

/**
 * Box breathing: in for four, hold for four, out for four, hold for four.
 *
 * Named for the shape the four equal phases trace - in, across, out, back - which
 * is also why every phase is the same length. Four seconds is long enough to feel
 * unhurried and short enough that a beginner can follow the count without losing
 * the thread, and four of them make sixteen, so a full cycle lines up with a
 * number people already meet in timed breathing.
 *
 * The phases are the equal ones on purpose. A technique whose phases are all the
 * same length is the easiest case to get right, which makes it the right first one
 * to ship: nothing here depends on the phases being equal, and the tests cover a
 * technique whose phases are not.
 */
export const BOX_BREATHING: BreathingTechnique = {
  id: 'box-breathing',
  name: 'Box Breathing',
  phases: [
    { id: 'inhale', label: 'Inhale', seconds: 4 },
    { id: 'hold-after-inhale', label: 'Hold', seconds: 4 },
    { id: 'exhale', label: 'Exhale', seconds: 4 },
    { id: 'hold-after-exhale', label: 'Hold', seconds: 4 },
  ],
};

/**
 * The id of a technique this build implements.
 *
 * Written out rather than derived from the registry's keys, so that it stays a
 * union of real ids instead of widening to `string`. A step naming `'box-breathingg'`
 * must be a type error rather than a breathing step that silently paces nothing: with
 * a widened type the mistake would compile, pass review, and reach a screen.
 *
 * Adding a technique means adding its id here and its entry below, and nothing else.
 */
export type BreathingTechniqueId = 'box-breathing';

/** Every technique this build implements, keyed by id. */
export const BREATHING_TECHNIQUES: Readonly<Record<BreathingTechniqueId, BreathingTechnique>> = {
  'box-breathing': BOX_BREATHING,
};

/**
 * A technique by id, or undefined when the id is not one we implement.
 *
 * Accepts an array because a route parameter arrives as one, and returns undefined
 * rather than a fallback: a step naming a technique that does not exist must run as a
 * plain timed step, not silently breathe somebody through a different pattern than
 * the one its own guidance described.
 *
 * The registry is widened to a string index for the lookup only, because the id being
 * looked up is a string from a route and there is no way to make TypeScript believe
 * in advance that it is one of ours. That is why the answer is `undefined` for
 * anything unknown rather than a crash.
 */
export function getBreathingTechnique(
  id?: string | string[] | null,
): BreathingTechnique | undefined {
  const key = Array.isArray(id) ? id[0] : id;
  if (typeof key !== 'string' || key.length === 0) return undefined;
  const registry = BREATHING_TECHNIQUES as Readonly<Record<string, BreathingTechnique | undefined>>;
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
}

/** True when the value is one of the implemented technique ids. */
export function isBreathingTechniqueId(value: unknown): value is BreathingTechniqueId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BREATHING_TECHNIQUES, value);
}

/** Where the breathing guide has got to. Mirrors `GuidedPhase` deliberately. */
export type BreathCyclePhase = 'ready' | 'running' | 'paused' | 'completed';

/** Everything the screen shows about the breath comes from one of these. */
export type BreathCycleSnapshot = {
  phase: BreathCyclePhase;
  techniqueId: string;
  techniqueName: string;
  /** The phase due now, or null before the guide has started. */
  phaseId: BreathPhaseId | null;
  /** The phase's own word, or an empty string before the guide has started. */
  label: string;
  /** Milliseconds into the current phase. Never above the phase's own length. */
  phaseElapsedMs: number;
  /** Whole seconds into the current phase, for a countdown. */
  phaseRemainingSeconds: number;
  /** The phase's full length in milliseconds. Zero before the guide has started. */
  phaseDurationMs: number;
  /** 0..1 through the current phase. */
  phaseProgress: number;
  /** Whole cycles completed. Increments only when the last phase of a cycle ends. */
  completedCycles: number;
  /** Total breathing time, in ms. Frozen once the guide is completed. */
  elapsedMs: number;
  /** Whole seconds of breathing time. */
  elapsedSeconds: number;
  /** The length of one whole cycle in milliseconds. */
  cycleMs: number;
};

/** A phase's length in milliseconds, floored and never negative. */
function phaseMs(phase: BreathPhaseSpec): number {
  return Math.max(0, Math.floor(phase.seconds)) * MS_PER_SECOND;
}

/**
 * Where a moment inside one cycle falls: which phase, and how far into it.
 *
 * `withinCycleMs` is required to be in `[0, cycleMs)`, which is what makes the
 * walk below always terminate: every iteration consumes at least nothing and
 * advances the cursor, and the final phase covers the end of the cycle by
 * construction. A zero-length phase is skipped rather than looped on, so a
 * malformed technique cannot spin here.
 */
function locatePhase(
  phases: readonly BreathPhaseSpec[],
  withinCycleMs: number,
): { index: number; elapsedMs: number } {
  let cursorMs = 0;
  for (const [index, phase] of phases.entries()) {
    const durationMs = phaseMs(phase);
    /*
     * Strictly less than, and this is the whole boundary rule. A moment exactly
     * on a phase's end belongs to the NEXT phase, so a four-second inhale is still
     * the inhale at 3999ms and is the hold at 4000ms - never both, never neither,
     * and never a phase that is reported for a single millisecond after it ended.
     */
    if (withinCycleMs < cursorMs + durationMs) {
      return { index, elapsedMs: withinCycleMs - cursorMs };
    }
    cursorMs += durationMs;
  }
  /* Unreachable for a non-empty technique with a positive cycle; defensive. */
  const last = phases.length - 1;
  return { index: Math.max(0, last), elapsedMs: phaseMs(phases[last] ?? { id: 'inhale', label: '', seconds: 0 }) };
}

/**
 * The next breathing phase worth announcing, or null when there is nothing new.
 *
 * This is the once-per-transition rule, as a pure function, because it is the one
 * piece of the guide's behaviour that is decided by a CALLER RATE rather than by
 * the clock: a screen reading the breath several times a second would otherwise
 * say the same word hundreds of times, and the only way to test that it does not is
 * to be able to ask the question without a renderer.
 *
 * It takes the phase last announced and the phase now due, and answers with the
 * phase to speak or with null. Null means "say nothing", which is the answer for
 * every tick that lands inside a phase already spoken, for a guide that has not
 * started, and for the frozen state after a pause.
 *
 * Compare on the ID and never on the label: both holds are labelled "Hold", so a
 * label comparison would decide the second hold of every cycle had already been
 * announced and never say it at all.
 */
export function nextBreathAnnouncement(
  lastAnnounced: BreathPhaseId | null,
  current: BreathPhaseId | null,
): BreathPhaseId | null {
  if (current === null) return null;
  return current === lastAnnounced ? null : current;
}

/**
 * The breathing clock for one technique.
 *
 * A class rather than a set of functions for the same reason `GuidedSession` is
 * one: the screen holds an instance in a ref, reads it whenever it re-renders, and
 * nothing here knows React exists.
 */
export class BreathCycleEngine {
  private readonly technique: BreathingTechnique;

  private readonly cycleMs: number;

  private readonly nowMs: () => number;

  private phase: BreathCyclePhase = 'ready';

  /** Time banked by previous run spans, in ms. Survives a pause. */
  private bankedMs = 0;

  /** When the current run span began, or null while not running. */
  private runningSinceMs: number | null = null;

  constructor(technique: BreathingTechnique, nowMs: () => number = Date.now) {
    this.technique = technique;
    this.cycleMs = technique.phases.reduce((total, phase) => total + phaseMs(phase), 0);
    this.nowMs = nowMs;
  }

  /** The technique being breathed, for a caller that has to name it. */
  get techniqueId(): string {
    return this.technique.id;
  }

  /** Total breathing time so far, in ms. Derived, never accumulated. */
  private elapsedMs(): number {
    if (this.runningSinceMs === null) return this.bankedMs;
    /*
     * Clamped at zero, exactly as `GuidedSession.elapsedMs` clamps it, and for the
     * same reason: `Date.now` is a wall clock, so an NTP correction or a person
     * changing the device's time can hand back an instant earlier than the one the
     * current run span began at. That must never produce a negative span, and it
     * must not produce one here and not in the step clock that owns this guide -
     * a breath that disagreed with the session containing it would be the worse bug
     * of the two. A backwards clock rewinds both to the start of the run span; it is
     * the honest reading of a clock that has gone back, and no breathing time is
     * invented to hide it.
     */
    return this.bankedMs + Math.max(0, this.nowMs() - this.runningSinceMs);
  }

  /**
   * Begins the guide. Does nothing once it has started, so a second call cannot
   * restart a session that is already running.
   *
   * `atMs` exists for the one caller that knows better than the clock: a step's
   * own start may already be a moment in the past by the time the screen notices
   * the step changed, and passing that moment keeps the breathing lined up with
   * the step instead of starting late by however long the notice took.
   */
  start(atMs?: number): void {
    if (this.phase !== 'ready') return;
    this.runningSinceMs = atMs ?? this.nowMs();
    this.phase = 'running';
  }

  /**
   * Banks the breathing time run so far and stops the clock.
   *
   * Not terminal, and deliberately symmetrical with `GuidedSession.pause()`: the
   * time spent paused belongs to neither side of it, so a person who is interrupted
   * for half a minute resumes mid-inhale rather than landing somewhere else
   * entirely. Nothing is reset, because nothing about the breath was undone.
   */
  pause(): void {
    if (this.phase !== 'running') return;
    this.bankedMs = this.elapsedMs();
    this.runningSinceMs = null;
    this.phase = 'paused';
  }

  /** Starts the clock again from a pause, continuing the same breath. */
  resume(): void {
    if (this.phase !== 'paused') return;
    this.runningSinceMs = this.nowMs();
    this.phase = 'running';
  }

  /**
   * Ends the guide, freezing it exactly where it is. Terminal.
   *
   * Called by whoever owns the guide when the step it belongs to ends - whether
   * the step's clock ran out or the person pressed End. The cycle count is banked
   * at this moment and never moves again, so a finished guide reads the same on
   * every later read rather than continuing to count in a screen nobody is
   * watching.
   */
  complete(): void {
    if (this.phase === 'completed') return;
    this.bankedMs = this.elapsedMs();
    this.runningSinceMs = null;
    this.phase = 'completed';
  }

  /** Back to the beginning: no time banked, no cycles, nothing finished. */
  reset(): void {
    this.phase = 'ready';
    this.bankedMs = 0;
    this.runningSinceMs = null;
  }

  /**
   * Where the breath has got to, for the screen to render.
   *
   * Reads the clock rather than moving anything, so calling it twice in the same
   * millisecond costs nothing and a screen that never calls it still gets the
   * right answer the first time it does. Everything below is a function of the
   * one elapsed figure.
   */
  snapshot(): BreathCycleSnapshot {
    const elapsedMs = this.elapsedMs();
    const started = this.phase !== 'ready';

    /*
     * A technique whose phases add up to nothing has no cycle to divide into, and
     * one with no phases has nothing to walk. Neither can happen in the catalogue,
     * but a malformed entry must produce an inert panel rather than a division by
     * zero, and the time it has run is still real so it is still reported.
     */
    if (!started || this.cycleMs <= 0 || this.technique.phases.length === 0) {
      return {
        phase: this.phase,
        techniqueId: this.technique.id,
        techniqueName: this.technique.name,
        phaseId: null,
        label: '',
        phaseElapsedMs: 0,
        phaseRemainingSeconds: 0,
        phaseDurationMs: 0,
        phaseProgress: 0,
        completedCycles: 0,
        elapsedMs,
        elapsedSeconds: Math.floor(elapsedMs / MS_PER_SECOND),
        cycleMs: this.cycleMs,
      };
    }

    /*
     * Divide first, then locate. `completedCycles` is the count of whole cycles
     * behind this moment, and it rises only as the elapsed time passes a cycle
     * boundary - so beginning a cycle, beginning the inhale, or reaching the first
     * hold all leave it where it was. The remainder is then guaranteed to be
     * inside the current cycle, which is what lets `locatePhase` walk a fixed
     * number of phases however long the session has been going.
     */
    const completedCycles = Math.floor(elapsedMs / this.cycleMs);
    const withinCycleMs = elapsedMs - completedCycles * this.cycleMs;
    const { index, elapsedMs: phaseElapsedMs } = locatePhase(this.technique.phases, withinCycleMs);
    const phase = this.technique.phases[index];
    const durationMs = phaseMs(phase);

    return {
      phase: this.phase,
      techniqueId: this.technique.id,
      techniqueName: this.technique.name,
      phaseId: phase.id,
      label: phase.label,
      phaseElapsedMs,
      /*
       * Rounded up, never down: at the start of a four-second inhale there are
       * four seconds left, and only at 4000ms is there none. Flooring would show
       * "3" immediately and sit on "0" for the whole final second.
       */
      phaseRemainingSeconds: Math.ceil(Math.max(0, durationMs - phaseElapsedMs) / MS_PER_SECOND),
      phaseDurationMs: durationMs,
      phaseProgress:
        durationMs === 0 ? PROGRESS_MAX : Math.min(PROGRESS_MAX, phaseElapsedMs / durationMs),
      completedCycles,
      elapsedMs,
      elapsedSeconds: Math.floor(elapsedMs / MS_PER_SECOND),
      cycleMs: this.cycleMs,
    };
  }
}