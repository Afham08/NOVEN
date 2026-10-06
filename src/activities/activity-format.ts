import type { SessionRecord } from '../exercise/session-store';
import { findGuidedActivity } from './catalog';
import type { GuidedActivity } from './types';

/**
 * ============================================================================
 * How a finished session is described, in one place.
 * ============================================================================
 *
 * WHY A FUNCTION AND NOT A STRING AT EACH CALL SITE
 * The history list and a deep link can both show the same session, and if each of
 * them phrases it independently they will eventually disagree — one saying "0
 * exercises completed" for a yoga session while the other says nothing at all.
 * The rule that decides the wording lives here, so there is exactly one answer
 * per record.
 *
 * WHY THE PHRASING DEPENDS ON THE KIND
 * A camera session is honestly described by how many repetitions were counted.
 * A guided session counted no repetitions, because NOVEN was not watching a
 * joint, and printing "0 exercises completed" next to a finished yoga routine
 * would both be untrue and be the most demoralising possible thing to show
 * someone. Each guided kind instead reports what it actually knows: how many of
 * its own steps were finished, out of how many it has.
 */

/** How many steps a guided session finished, for the phrase below. */
function stepsCompletedFor(record: SessionRecord): number {
  return typeof record.stepsCompleted === 'number' && record.stepsCompleted >= 0
    ? record.stepsCompleted
    : 0;
}

/**
 * A length of time, as a person would say it: "45 sec", "2 min", "1 min 30 sec".
 *
 * Used both for how long an activity takes and for how long one of its steps
 * lasts, because those are the same question asked at two scales, and two
 * formatters would eventually print "0 min" for one of them.
 */
export function describeLength(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole} sec`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`;
}

/**
 * The one factual line a routine's card carries: how long it runs, and how many
 * of its steps there are.
 *
 * Both numbers are read from the catalogue entry, so a routine that is edited in
 * one place cannot go on promising a length it no longer has. The steps are
 * named with the activity's own `progressNoun`, so a yoga routine counts poses
 * and never quietly becomes "6 steps".
 */
export function describeRoutineMeta(activity: GuidedActivity): string {
  return `${describeLength(activity.durationSeconds)} · ${activity.steps.length} ${activity.progressNoun}`;
}

/**
 * The one line that summarises a finished session.
 *
 * For an exercise this is the existing "5 exercises completed", unchanged, so the
 * history list keeps saying exactly what the Result screen says about the same
 * session. For a guided activity it is "3 of 5 poses" — the number of steps that
 * actually ran, and the number there are, in the noun that kind of activity
 * really uses.
 */
export function describeSessionOutcome(record: SessionRecord): string {
  const kind = record.activityKind ?? 'exercise';

  if (kind === 'exercise' || record.activityKind === undefined) {
    return `${record.reps} ${record.reps === 1 ? 'exercise' : 'exercises'} completed`;
  }

  const activity = findGuidedActivity(record.exerciseId);
  const total = activity?.steps.length ?? 0;
  const done = stepsCompletedFor(record);

  if (activity === undefined || total === 0) {
    return `${done} ${done === 1 ? 'step' : 'steps'} completed`;
  }
  return `${done} of ${total} ${activity.progressNoun}`;
}

/**
 * The words a guided activity's own screen uses for where the session has got
 * to. Takes the same noun the summary phrase uses, so a yoga session reads
 * "Pose 3 of 5" here and "3 of 5 poses" there, and neither can say "step" for a
 * pose by accident.
 */
export function describeStepPosition(
  completed: number,
  total: number,
  noun: string,
): string {
  if (total <= 0) return 'Ready to start';
  const position = Math.min(Math.max(completed + 1, 1), total);
  return `${cap(noun)} ${position} of ${total}`;
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
