// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping. The same reason `src/exercise` uses relative
// imports throughout.
import type { SessionKind } from '../exercise/session-store';

/**
 * ============================================================================
 * The guided activities: Yoga, Meditation and Wellness.
 * ============================================================================
 *
 * WHAT THESE HAVE IN COMMON
 * They are all driven by a timer and read from the screen, not by the camera.
 * Yoga is a sequence of positions to move through, Meditation is a sequence of
 * things to attend to, and Wellness is a short thing to do and tick off. None of
 * them can be measured by a joint angle, and none of them pretend to be: a
 * guided session reports how long it ran and how many of its steps were
 * finished, and reports no repetitions, no pace, and no steadiness, because
 * NOVEN did not observe any of those.
 *
 * WHY THIS LIVES OUTSIDE `src/exercise`
 * The exercise layer is the camera pipeline: landmarks in, repetitions out. A
 * breathing exercise has no landmarks, and putting one there would mean a
 * config whose thresholds describe nothing. Keeping them separate means the
 * exercise flow gains nothing it cannot measure, and each activity is described
 * only in the terms that actually apply to it.
 */

/** The three timer-driven activity kinds, i.e. everything that is not exercise. */
export type GuidedActivityKind = Exclude<SessionKind, 'exercise'>;

/** All three, in the order the Activities tab lists them. */
export const GUIDED_ACTIVITY_KINDS: readonly GuidedActivityKind[] = ['yoga', 'meditation', 'wellness'];

/** One stage of a guided activity: how long it lasts, and what to do in it. */
export type GuidedStep = {
  /** How long this step runs for, in seconds. */
  seconds: number;
  /** What this step is, in two or three words. */
  title: string;
  /** One plain sentence telling the person what to do. */
  guidance: string;
};

/** A whole guided activity: something a person can start and finish. */
export type GuidedActivity = {
  id: string;
  kind: GuidedActivityKind;
  name: string;
  /** One line, used on the card in the activity list. */
  summary: string;
  /** Total running time, in seconds. Always the sum of the steps. */
  durationSeconds: number;
  steps: readonly GuidedStep[];
  /**
   * What the steps are called in a sentence. "poses", "stages", "steps" - chosen
   * per activity because a meditation stage is not a pose, and calling it one
   * would be the kind of small untruth that makes a person doubt the rest.
   */
  progressNoun: string;
  /** When to stop. Every guided activity has one, because every person can. */
  safetyNote: string;
};

/** Sum of a set of steps' seconds, clamped so a bad step cannot go negative. */
export function totalStepSeconds(steps: readonly GuidedStep[]): number {
  return steps.reduce((total, step) => total + Math.max(0, Math.floor(step.seconds)), 0);
}

/**
 * Builds an activity from its parts, deriving the total from the steps.
 *
 * The alternative is typing the total in as well, and that is a number that
 * disagrees with the steps the moment one of them is edited. Deriving it means
 * the length shown on the card, the length the timer counts, and the length the
 * result reports are the same number because there is only one of them.
 */
export function defineGuidedActivity(
  activity: Omit<GuidedActivity, 'durationSeconds'>,
): GuidedActivity {
  return { ...activity, durationSeconds: totalStepSeconds(activity.steps) };
}

/** True when the value is one of the three guided kinds. */
export function isGuidedActivityKind(value: unknown): value is GuidedActivityKind {
  return typeof value === 'string' && (GUIDED_ACTIVITY_KINDS as readonly string[]).includes(value);
}
