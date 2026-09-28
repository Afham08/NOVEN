import { meditationSessions } from './meditation';
import {
  GUIDED_ACTIVITY_KINDS,
  isGuidedActivityKind,
  type GuidedActivity,
  type GuidedActivityKind,
} from './types';
import { wellnessActivities } from './wellness';
import { yogaRoutines } from './yoga';

/**
 * One place to ask "what guided activities are there?".
 *
 * Yoga, Meditation and Wellness each own their own file, because they are
 * written and reviewed separately and a change to one has no business appearing
 * in the diff of another. The lookup that joins them lives here so a screen, a
 * route, or the history list has one answer to ask rather than three, and so
 * adding a fourth kind is a change in this file and in `GUIDED_ACTIVITY_KINDS`
 * only.
 */
export const BY_KIND: Readonly<Record<GuidedActivityKind, readonly GuidedActivity[]>> = {
  yoga: yogaRoutines,
  meditation: meditationSessions,
  wellness: wellnessActivities,
};

/** The activities of one kind, in the order that kind is meant to be read. */
export function guidedCatalog(kind: GuidedActivityKind): readonly GuidedActivity[] {
  return BY_KIND[kind];
}

/** Every guided activity of every kind. */
export const allGuidedActivities: readonly GuidedActivity[] = GUIDED_ACTIVITY_KINDS.flatMap(
  (kind) => BY_KIND[kind],
);

function firstId(id?: string | string[] | null): string | null {
  const key = Array.isArray(id) ? id[0] : id;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * One activity by id, searched across all three kinds.
 *
 * The id alone is enough for a deep link or a saved session. The kind-aware
 * variant below is what a route uses, so that opening `/yoga/<a meditation id>`
 * shows "not found" rather than quietly running a different activity than the one
 * the person tapped their way to.
 *
 * The id alone is enough, and deliberately so: a saved session records the id
 * and the kind, but the history list and a deep link only ever have the id, and
 * making both of those carry a kind as well would be a second thing to keep
 * correct. Ids are unique across kinds because each kind prefixes nothing into
 * the user's path and a clash would mean two different activities answering to
 * one URL.
 */
export function findGuidedActivity(id?: string | string[] | null): GuidedActivity | undefined {
  const key = firstId(id);
  if (key === null) return undefined;
  return allGuidedActivities.find((activity) => activity.id === key);
}

/** One activity by id, but only within one kind. What each activity's route uses. */
export function findGuidedActivityInKind(
  kind: GuidedActivityKind,
  id?: string | string[] | null,
): GuidedActivity | undefined {
  const key = firstId(id);
  if (key === null) return undefined;
  return BY_KIND[kind].find((activity) => activity.id === key);
}

/**
 * The activities of one kind, restricted to a list of ids, in catalogue order.
 *
 * Used by the Wellness screen, which marks which of today's activities are
 * already done. Unknown ids are skipped rather than rendered as blanks, so a
 * stale saved id cannot put an empty row on the screen.
 */
/**
 * A day's view of one kind: the activity, and whether it has been done today.
 *
 * The list screens render this straight into a card, so the "done" bit travels
 * with the activity it belongs to instead of being looked up again per card.
 */
export type GuidedActivityWithStatus = {
  activity: GuidedActivity;
  done: boolean;
};

export function guidedActivitiesForDay(
  kind: GuidedActivityKind,
  doneIds: readonly string[],
): GuidedActivityWithStatus[] {
  const done = new Set(doneIds);
  return BY_KIND[kind].map((activity) => ({ activity, done: done.has(activity.id) }));
}

/**
 * Guards the assumption the whole guided layer rests on: an activity with no
 * steps has nothing to guide, and its session would be "finished" the moment it
 * opened. Called once at module load so a bad catalogue entry fails loudly in
 * development rather than producing an empty screen on a device.
 */
export function assertCatalogIsUsable(
  activities: readonly GuidedActivity[] = allGuidedActivities,
): void {
  for (const activity of activities) {
    if (activity.steps.length === 0) {
      throw new Error(`Guided activity "${activity.id}" has no steps.`);
    }
    if (activity.durationSeconds <= 0) {
      throw new Error(`Guided activity "${activity.id}" has no running time.`);
    }
  }
  const ids = new Set<string>();
  for (const activity of activities) {
    if (ids.has(activity.id)) {
      throw new Error(`Guided activity id "${activity.id}" is used twice.`);
    }
    ids.add(activity.id);
    if (!isGuidedActivityKind(activity.kind)) {
      throw new Error(`Guided activity "${activity.id}" has an unknown kind.`);
    }
  }
}

assertCatalogIsUsable();
