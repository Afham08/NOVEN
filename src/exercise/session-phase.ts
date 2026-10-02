/**
 * ============================================================================
 * The exercise session's phases, and the words that describe them.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * The session screen and the timer under the clock both state the session's
 * phase in words, for a reader who is several feet from the phone. Two screens
 * describing the same state in two places is exactly the arrangement that lets
 * them drift apart, and they had: the timer used to be told only whether the
 * timer was running, and so it answered "Session in progress" or "Session paused"
 * for a screen that has FOUR phases. It therefore said "Session paused" on the
 * pre-Start screen, under a status chip reading "Ready", and again on the
 * finished screen, under a chip reading "Session complete" and a banner reading
 * "SESSION COMPLETE".
 *
 * Both wordings now live here, so the timer and the chip cannot disagree: there
 * is one answer per phase and both read it.
 *
 * WHY IT IS NOT INSIDE THE COMPONENT
 * `tsconfig.test.json` compiles only `src/exercise/**`, `src/activities/**`,
 * `src/data/**` and one settings module into the Node test build, and the
 * component that draws the timer imports `react-native`. Wording chosen inside a
 * component body therefore cannot be asserted at all. This is the same reason
 * `result-params.ts` exists for the result screen's parsing.
 */

/**
 * The states the exercise session screen moves through.
 *
 * Declared here and imported by both the screen and the timer, so there is
 * exactly one definition of the session's phases. The screen owns the state
 * machine that drives them; the timer has to be able to describe all of them.
 */
export type SessionPhase = 'ready' | 'running' | 'paused' | 'completed';

/**
 * What the status chip says, next to the camera feed.
 *
 * Unchanged wording, and deliberately kept beside the timer's own caption rather
 * than derived from it: the chip is the short label, the caption is the sentence
 * under the clock.
 */
const PHASE_LABEL: Readonly<Record<SessionPhase, string>> = {
  ready: 'Ready',
  running: 'Session in progress',
  paused: 'Paused',
  completed: 'Session complete',
};

/**
 * The line under the clock, which tells the person where the session is.
 *
 * WHY IT IS A PHASE AND NOT THE INVERSE OF "running"
 * A two-state sentence describing a four-state screen is wrong in two of the four
 * states, and a person cannot pause a session that has not started or that has
 * already finished. Both wrong readings sat directly under the clock, which is
 * the one thing on screen this audience is most likely to be looking at.
 *
 * The wording is the same words the chip uses for the same state, so the two
 * indicators cannot contradict each other.
 */
const TIMER_CAPTION: Readonly<Record<SessionPhase, string>> = {
  ready: 'Ready to start',
  running: 'Session in progress',
  paused: 'Session paused',
  completed: 'Session complete',
};

/** The status chip's wording for a phase. */
export function sessionPhaseLabel(phase: SessionPhase): string {
  return PHASE_LABEL[phase];
}

/** The clock caption for a phase. */
export function sessionTimerCaption(phase: SessionPhase): string {
  return TIMER_CAPTION[phase];
}
