// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping. The same reason `src/exercise` uses relative
// imports throughout.
import type { SessionKind } from '../exercise/session-store';

import type { BreathingTechniqueId } from './breath-cycle';
import type { MeditationPostureExpectation } from './meditation-guidance';
import type { YogaPoseRuleId } from './yoga-poses';

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
  /**
   * Optional id of a camera-tracked pose config from pose-configs.ts.
   * When present, this step will use the camera to track the movement.
   * The step auto-advances when the required reps are completed,
   * or can be manually advanced.
   */
  cameraConfigId?: string;
  /**
   * Optional id of a static yoga pose rule from yoga-poses.ts.
   *
   * The other half of a camera step, and a genuinely different kind of step. A
   * `cameraConfigId` step counts repetitions of a movement; a `poseRuleId` step
   * checks whether a held shape is being kept and how long it has been kept. The
   * two are mutually exclusive on one step, and neither is required: a plain timer
   * step has neither and uses no camera at all.
   *
   * DELIBERATELY NO `holdSeconds` FIELD HERE.
   * How long a pose must be held belongs to the pose, not to the step that happens
   * to mention it. Putting it on the step would give one hold two places to be
   * configured, and the failure mode is not a crash but a quiet disagreement -
   * the HUD counting to 30 while the record says 15 - which is exactly the class of
   * bug the timer-phase fix (19087ef) was made to remove. `seconds` remains the
   * step's own wall-clock budget and is set longer than the pose's hold, so there
   * is room to settle into the pose before the step's clock runs out.
   */
  poseRuleId?: YogaPoseRuleId;
  /**
   * Optional id of a breathing technique from breath-cycle.ts.
   *
   * A third kind of step, and the only one with no camera at all. A
   * `cameraConfigId` step counts repetitions of a movement, a `poseRuleId` step
   * checks a shape somebody is holding, and this one paces the breath through a
   * repeated sequence of phases - inhale, hold, exhale - for as long as the step
   * lasts.
   *
   * IT MEANS "WHEN", NEVER "WHETHER". The camera sees a torso and the app has no
   * microphone here, so a breathing step cannot know what the person did and this
   * field asks for nothing of the sort. It is mutually exclusive with the other two
   * on one step, because a step that counted movements and paced a breath at the
   * same time would be claiming two different measurements from one frame.
   *
   * Like `poseRuleId`, this names a technique and nothing else: the phases and
   * their lengths belong to the technique, so there is one place to change a
   * pattern rather than one per step that mentions it.
   */
  breathingTechniqueId?: BreathingTechniqueId;
  /**
   * Only meaningful alongside `cameraConfigId`, and only for meditation.
   *
   * Says how much the step is willing to claim about the person's posture,
   * because that is decided by the step's own guidance and not by the camera.
   * A step that tells the person to sit can also be told to straighten up; a
   * step that says "lie down or sit back" cannot, because a person lying down
   * is upright nowhere and would be nagged for it. Defaults to `in-frame` when a
   * camera step does not say, so an unlabelled step is never the more assertive
   * of the two.
   */
  postureExpectation?: MeditationPostureExpectation;
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
  /**
   * Optional background sound for the session. Meditation only - see
   * `ambientAudioFor()` in meditation-audio.ts, which is the single place that
   * decides that, so this field being present on a Yoga or Wellness activity
   * cannot make it play anything.
   *
   * OPTIONAL AND CURRENTLY UNUSED BY ANY ACTIVITY. There is no audio file in the
   * app, and inventing one is not something a build should do, so nothing
   * declares this yet and every meditation is silent. It exists so that adding a
   * licensed bed later is a one-line catalogue change rather than a new feature,
   * and so the rest of the path is exercised by tests today rather than by the
   * first person who tries it on a real device.
   */
  ambientAudio?: {
    /** A bundled asset via `require()`, or a URL / file path. */
    source: number | string;
    /** 0..1. Defaults to a quiet bed; see DEFAULT_AMBIENT_VOLUME. */
    volume?: number;
  };
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
