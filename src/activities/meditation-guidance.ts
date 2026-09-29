// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping. The same reason `src/exercise` uses relative
// imports throughout.
import type { LandmarkEventPayload, PosePresence } from '../../modules/pose-tracker';

import { getLandmark } from '../exercise/pose-utils';

/**
 * ============================================================================
 * Posture guidance for the seated opening of a meditation.
 * ============================================================================
 *
 * WHAT THIS MEASURES, AND WHAT IT REFUSES TO MEASURE
 * The only thing here is a torso lean angle: how far the line from the middle of
 * the shoulders to the middle of the hips has tipped away from vertical, in the
 * camera image. That is a real geometric quantity, it is computed the same way
 * every frame, and it is the single reason any wording below is allowed to
 * appear on screen.
 *
 * There is deliberately no output about meditation, calm, focus, breathing,
 * stress, mood, or whether the person is meditating at all. A camera can see a
 * torso. It cannot see any of those, so this module has no representation for
 * them and there is no threshold anywhere in this file that could produce one.
 *
 * WHY THIS IS NOT `SessionEngine`
 * The session engine is a repetition machine. It is built to turn a joint angle
 * crossing a rest threshold, holding, and crossing back into "one rep", and every
 * piece of its state - the range tracker, the two detectors, the cooldown, the
 * counted-rep list - exists to make that counting honest. A meditation has no
 * repetition to count, and running one through that engine would mean holding a
 * rep tally that describes nothing while borrowing its readiness gate for a
 * question the gate cannot answer.
 *
 * That last part is the concrete reason this is separate. The readiness gate
 * reports `ready` when a person has been still, with the required joints
 * visible, for the configured window. Stillness is not posture: a person
 * sitting upright, a person slumped forward, and a person lying down are all
 * equally still, and the gate returns the same `ready` for all three. Reading
 * that as "good posture" would be a claim with no measurement behind it, which
 * is the one thing this codebase does not do. So meditation reads the torso
 * angle directly instead.
 */

/**
 * What a given meditation step is willing to be told about its posture.
 *
 * This exists because the step's own guidance decides it. "Sit comfortably" can
 * honestly be paired with an upright-back prompt. "Lie down or sit back,
 * whichever is more comfortable" cannot: a person lying down has a torso that is
 * nearly horizontal by definition, and telling that person to straighten their
 * back would be wrong rather than merely unhelpful. A step that permits lying
 * down therefore asks for `in-frame`, which confirms the person is visible and
 * makes no claim about their posture at all.
 */
export type MeditationPostureExpectation = 'seated-upright' | 'in-frame';

export type MeditationGuidanceState =
  /** The person is not visible, or the torso cannot be measured this frame. */
  | 'not-in-frame'
  /** Visible, but not yet held still long enough to read the angle. */
  | 'settling'
  /** Measured torso is within the upright band. */
  | 'upright'
  /** Measured torso has tipped past the upright band. */
  | 'slouched'
  /** Visible and settled, in a step that makes no posture claim. */
  | 'settled';

export type MeditationGuidance = {
  state: MeditationGuidanceState;
  /**
   * The one sentence the HUD shows. Deliberately short, unhurried, and about
   * the body only - never about the state of mind behind it.
   */
  text: string;
  /** True only when a torso angle was actually measured as upright. */
  upright: boolean;
  /** The measured lean in degrees, or null when no angle was available. */
  leanDeg: number | null;
};

/**
 * How far the torso may tip from vertical before the back is called slumped.
 *
 * A seated person's shoulders sit a little forward of their hips even when they
 * are sitting well, because the spine curves, so an exact-zero test would nag
 * somebody who is already sitting comfortably. 22 degrees is roughly where the
 * line from the shoulder midpoint to the hip midpoint stops reading as "sitting
 * up" and starts reading as "leaning forward". One number, applied to both
 * sides of the image, with no separate left/right tuning to drift out of sync.
 */
export const MEDITATION_UPRIGHT_TOLERANCE_DEG = 22;

/**
 * How long the torso must stay measurable before its angle is believed.
 *
 * A single frame can be wrong: a hand passes in front of the camera, a shoulder
 * is briefly occluded, the model drops to low confidence. Without a settling
 * window, one bad frame flips the wording to "Straighten your back" and back
 * again, which reads as the app disagreeing with itself. The window is measured
 * in milliseconds against the frame's own timestamp rather than in frames, so
 * the behaviour is identical on a device that reports 10fps and one that reports
 * 30fps.
 */
export const MEDITATION_SETTLE_MS = 1200;

/** Landmarks below this visibility are treated as not measured. */
export const MEDITATION_MIN_VISIBILITY = 0.5;

/**
 * Torso lean away from vertical, in degrees, or NaN when it cannot be measured.
 *
 * Computed from the shoulder midpoint and the hip midpoint rather than from one
 * side, so a person turned slightly away from the camera is not judged on a
 * single shoulder the model happens to be least sure about. The image's y axis
 * grows downward, so a hip midpoint below the shoulder midpoint is an upright
 * person and the angle is measured from straight-down.
 *
 * NaN (rather than 0, or a clamped guess) is returned whenever a landmark is
 * missing, too faint, non-finite, or the torso has collapsed to a point. The
 * caller treats NaN as "cannot tell" and asks the person to get in frame, which
 * is the only honest response to a frame with no usable torso in it.
 */
export function torsoLeanFromVerticalDeg(
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number = MEDITATION_MIN_VISIBILITY,
): number {
  const leftShoulder = getLandmark(landmarks, 'LEFT_SHOULDER');
  const rightShoulder = getLandmark(landmarks, 'RIGHT_SHOULDER');
  const leftHip = getLandmark(landmarks, 'LEFT_HIP');
  const rightHip = getLandmark(landmarks, 'RIGHT_HIP');

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return Number.NaN;

  const joints = [leftShoulder, rightShoulder, leftHip, rightHip];
  for (const joint of joints) {
    if (joint.visibility < minVisibility) return Number.NaN;
    if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y)) return Number.NaN;
  }

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;

  const dx = hipMidX - shoulderMidX;
  const dy = hipMidY - shoulderMidY;

  // A collapsed torso carries no direction, so no angle can be read from it.
  // Returning NaN here matters: the alternative is a random angle from a divide
  // by zero, which would be free to report either "upright" or "slouched".
  if (dx === 0 && dy === 0) return Number.NaN;

  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

const GUIDANCE_TEXT: Readonly<Record<MeditationGuidanceState, string>> = {
  'not-in-frame': 'Position yourself in the frame',
  settling: 'Sit comfortably, keep your back upright',
  upright: 'Good posture',
  slouched: 'Straighten your back',
  settled: 'Good posture',
};

/**
 * What the two non-verdict states say when the step makes no posture claim.
 *
 * `settling` and `settled` are reached by a step of either expectation, so a
 * single shared sentence would put "Sit comfortably, keep your back upright" and
 * "Good posture" in front of somebody the step explicitly told to lie down. Both
 * lines below therefore describe only being visible, which is true in either
 * posture and never asks the body to change.
 */
const IN_FRAME_TEXT: Readonly<Record<MeditationGuidanceState, string>> = {
  ...GUIDANCE_TEXT,
  settling: 'Stay comfortable, keep still for a moment',
  settled: 'In frame, all set to begin',
};

function guidance(
  state: MeditationGuidanceState,
  leanDeg: number | null,
  expectation: MeditationPostureExpectation = 'seated-upright',
): MeditationGuidance {
  const text =
    expectation === 'in-frame' ? IN_FRAME_TEXT[state] : GUIDANCE_TEXT[state];
  return { state, text, upright: state === 'upright', leanDeg };
}

/**
 * Turns a stream of pose frames into the one line of posture guidance a
 * meditation step shows.
 *
 * Pure in the sense that matters for testing: no timers, no camera, no React,
 * no globals. The only state is the settling window, it is driven entirely by
 * the timestamps handed in, and feeding the same frames in the same order always
 * produces the same wording. That is what makes every branch below - person
 * absent, landmarks unusable, borderline angle, frame rate change, timestamp
 * going backwards - reachable from a plain unit test.
 */
export class MeditationPostureTracker {
  /** Timestamp the current run of measurable frames began; null when not settled. */
  private settledSinceMs: number | null = null;

  /**
   * Reads one frame and returns what the HUD should say.
   *
   * `presence` is taken from the frame itself rather than from any tracking
   * state held elsewhere, so a person who steps out of frame reaches the
   * `not-in-frame` branch on the very first frame after they leave, and cannot
   * be described as well-postured while they are not in the picture at all.
   */
  observe(
    presence: PosePresence,
    landmarks: readonly LandmarkEventPayload[],
    timestampMs: number,
    expectation: MeditationPostureExpectation,
  ): MeditationGuidance {
    if (presence !== 'tracked') {
      this.settledSinceMs = null;
      return guidance('not-in-frame', null);
    }

    const leanDeg = torsoLeanFromVerticalDeg(landmarks);
    if (!Number.isFinite(leanDeg)) {
      this.settledSinceMs = null;
      return guidance('not-in-frame', null);
    }

    if (this.settledSinceMs === null) {
      this.settledSinceMs = timestampMs;
    } else if (timestampMs < this.settledSinceMs) {
      // Timestamps arriving out of order (a stalled then resumed stream) must not
      // be able to fabricate elapsed settling time, so the window restarts.
      this.settledSinceMs = timestampMs;
    }

    if (timestampMs - this.settledSinceMs < MEDITATION_SETTLE_MS) {
      return guidance('settling', leanDeg, expectation);
    }

    // A step that allows lying down gets presence and nothing more. There is no
    // uprightness verdict to give here, and inventing one is the whole failure
    // this module exists to avoid.
    if (expectation === 'in-frame') {
      return guidance('settled', leanDeg, expectation);
    }

    return guidance(
      leanDeg > MEDITATION_UPRIGHT_TOLERANCE_DEG ? 'slouched' : 'upright',
      leanDeg,
    );
  }

  /** Drops the settling window. Used when a step changes or the session restarts. */
  reset(): void {
    this.settledSinceMs = null;
  }
}
