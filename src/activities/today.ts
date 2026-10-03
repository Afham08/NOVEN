import { localDayKey } from '../exercise/progress';
import type { SessionRecord } from '../exercise/session-store';
import type { GuidedActivity, GuidedActivityKind } from './types';

/**
 * ============================================================================
 * What has already been done today.
 * ============================================================================
 *
 * DERIVED, NOT STORED
 * The obvious implementation is a per-day checklist in its own storage key. That
 * is a second source of truth for a fact the session history already holds, and
 * two sources of truth for one fact drift: tick something on a day you did not
 * finish it and the two disagree, with nothing able to say which is right. So
 * this reads the sessions that were already recorded and asks which of them
 * happened today.
 *
 * The cost is that a day is only as good as its timestamps — which is exactly the
 * cost the history already pays, and it pays it correctly: the stored value is
 * the instant the session was finished, and "today" is computed in the person's
 * own local time, because "did I do this today" is a question about where they
 * are standing.
 *
 * WHY ONLY WELLNESS USES THIS
 * A wellness item is a yes-or-no thing to do once in a day, so a tick next to it
 * is the right shape. Yoga and meditation are routines, and a routine is not
 * "done" until it is finished — which the session screen records as a session, and
 * the Progress tab already lists. Marking a routine as done in advance of doing it
 * would be a tick anyone could tick and nobody could un-tick.
 */

/** A day's worth of a guided kind, in a form a list can render directly. */
export type TodayActivityStatus = {
  activityId: string;
  done: boolean;
  /** How many times it was finished today. Zero when it was not. */
  timesToday: number;
};

/**
 * Did this session actually finish its activity?
 *
 * The session screen records how many steps really completed, and GuidedSession
 * credits a step only when something happened - the step's own clock ran out, or a
 * hold was met, or a repetition count reached its target. So a person who spent
 * five seconds of a one-minute meditation is recorded as having done none of its
 * stages, and reading only the record's kind and date would tick off a routine
 * somebody abandoned halfway.
 *
 * A record with no step count predates the field being written, so there is
 * nothing to judge it against and it keeps the behaviour it always had. An
 * activity with no steps cannot be stopped short of.
 */
function ranEveryStep(record: SessionRecord, totalSteps: number): boolean {
  if (typeof record.stepsCompleted !== 'number') return true;
  return totalSteps <= 0 || record.stepsCompleted >= totalSteps;
}

/**
 * Which of a kind's activities have been finished today, in the order given.
 *
 * Unknown ids in the history are ignored rather than added, so an activity that
 * has since been removed from the catalogue cannot put a phantom entry in today's
 * list.
 */
export function todayStatus(
  records: readonly SessionRecord[],
  activities: readonly Pick<GuidedActivity, 'id' | 'steps'>[],
  kind: GuidedActivityKind,
  now: Date = new Date(),
): TodayActivityStatus[] {
  const today = localDayKey(now);

  const stepTotals = new Map<string, number>();
  for (const activity of activities) stepTotals.set(activity.id, activity.steps.length);

  const counts = new Map<string, number>();
  for (const record of records) {
    // A record with no kind is a camera session, whatever its id looks like.
    if (record.activityKind !== kind) continue;
    if (typeof record.completedAt !== 'string') continue;
    const completedMs = Date.parse(record.completedAt);
    if (!Number.isFinite(completedMs)) continue;
    if (localDayKey(new Date(completedMs)) !== today) continue;
    if (!ranEveryStep(record, stepTotals.get(record.exerciseId) ?? 0)) continue;
    counts.set(record.exerciseId, (counts.get(record.exerciseId) ?? 0) + 1);
  }

  return activities.map((activity) => {
    const timesToday = counts.get(activity.id) ?? 0;
    return { activityId: activity.id, done: timesToday > 0, timesToday };
  });
}

/** How many of a kind's activities are finished today, out of how many exist. */
export function countDoneToday(status: readonly TodayActivityStatus[]): {
  done: number;
  total: number;
} {
  const done = status.filter((entry) => entry.done).length;
  return { done, total: status.length };
}
