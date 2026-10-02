/**
 * Carrying the repetitions a guided session actually measured.
 *
 * A guided routine is several steps and only the camera-tracked ones repeat, so
 * there is no single engine holding a session total: a fresh `SessionEngine` is
 * built for each camera step and counts from zero. The repetitions are therefore
 * real but per-step, and something has to carry them forward, because the count
 * is otherwise gone the moment the routine moves past the step that earned it.
 *
 * The engine reports a running total for the step it is on, so folding that in
 * has to add the DIFFERENCE and not the total itself. Adding the total would
 * count the same repetition again on every frame.
 *
 * This lives outside the screen because it is arithmetic worth testing on its
 * own, and a component body cannot be exercised without a React renderer.
 */

/** Repetitions folded in so far, and how many of them came from the current step. */
export type GuidedRepTally = {
  /** Every repetition measured during the session so far. */
  total: number;
  /** How many of them the current step's engine has already contributed. */
  folded: number;
};

/** A session that has measured nothing yet. */
export function emptyRepTally(): GuidedRepTally {
  return { total: 0, folded: 0 };
}

/**
 * Folds a camera step's running rep count into the session total.
 *
 * `stepTotal` is the engine's own count for the step under way, so only the part
 * beyond what is already folded in is new. Re-reading the same total therefore
 * adds nothing, which is what makes this safe to call on every camera frame.
 *
 * A step reporting no repetitions adds nothing, so a routine whose camera steps
 * were never reached stays at a true zero rather than becoming a guess.
 */
export function observeStepReps(tally: GuidedRepTally, stepTotal: number): GuidedRepTally {
  if (!Number.isFinite(stepTotal) || stepTotal <= tally.folded) return tally;
  return { total: tally.total + (stepTotal - tally.folded), folded: stepTotal };
}

/**
 * Starts a new step's contribution without losing the session's own total.
 *
 * Needed because a rebuilt engine counts from zero: its readings are new
 * repetitions and must be folded in as such, not compared against the count the
 * previous step happened to reach.
 */
export function beginStep(tally: GuidedRepTally): GuidedRepTally {
  return { total: tally.total, folded: 0 };
}

/** The measured repetitions to persist for the session. Never inferred. */
export function measuredReps(tally: GuidedRepTally): number {
  return tally.total;
}
