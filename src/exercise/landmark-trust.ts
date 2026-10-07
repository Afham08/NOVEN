import type { LandmarkEventPayload } from '../../modules/pose-tracker';

/**
 * ============================================================================
 * NOVEN landmark trust policy
 * ============================================================================
 *
 * THE PROBLEM THIS EXISTS TO SOLVE
 * MediaPipe emits a full 33-landmark skeleton for every tracked person,
 * INCLUDING limbs the camera cannot actually see. When the far leg is
 * occluded — which is the normal case in the side view this app is built
 * around — the model infers that leg's hip/knee/ankle from body priors. Those
 * inferred points are plausible coordinates, not measurements.
 *
 * Before this policy the pipeline could not tell the two apart, and it failed
 * in BOTH directions at once:
 *
 *  1. Readiness demanded EVERY required landmark be visible, so one dim far
 *     ankle vetoed readiness forever and a correctly seated user was told
 *     "Move into position".
 *  2. The starting-posture check accepted ONE side's angle, so a single
 *     inferred leg could grant readiness to somebody standing up.
 *
 * Neither failure is fixable with a threshold change; the defect is about
 * WHICH landmarks are allowed to decide anything.
 *
 * THE POLICY
 * A landmark may only be used for readiness geometry when it is trustworthy
 * as an OBSERVED landmark. That is decided by MediaPipe's `visibility` score
 * alone:
 *
 *  - `visibility` — "visible or occluded by other objects". Collapses to zero
 *    when the landmark leaves the frame entirely, which is exactly the signal
 *    needed here: a limb the camera cannot see is scored as not visible, so
 *    the side-grouping below keeps it out of the geometry entirely.
 *
 * WHY `presence` IS NOT USED AS A TRUST CRITERION
 * MediaPipe documents `presence` as an optional per-landmark field that "should
 * stay unset if not supported", so an absent value and a real zero are
 * indistinguishable once it reaches JavaScript. More importantly, the model
 * this app ships does not compute 33 independent presence scores: the bundled
 * `pose_landmarker_lite.task` emits a single pose-level tensor, `output_poseflag`
 * ("Presence of pose.", produced by the `conv_poseflag` layer), which MediaPipe
 * then broadcasts into every landmark's `presence` field.
 *
 * That makes `presence` a person-level detector confidence wearing a
 * per-landmark name. Treating it as a per-landmark occlusion test is a category
 * error, and a real-device capture proved it: on a clearly framed subject the
 * leg chain scored visibility 0.68 / 0.58 / 0.54 and produced a valid ~175deg
 * knee angle on a frame where `presence` was 0.00 for all six landmarks, while
 * the adjacent frame reported `presence` 1.00 everywhere at worse visibility.
 * Requiring it at 0.5 therefore refused readiness for a correctly positioned
 * user in 34 of 34 samples.
 *
 * Pose-level presence is not being ignored — it is already enforced where
 * MediaPipe defines it, at the native gate in `PoseTrackerProcessor`
 * (`setMinPosePresenceConfidence`), which decides whether a pose is returned at
 * all. `presence` is still carried end to end on the payload as telemetry; it
 * simply is not a per-landmark trust criterion here.
 */

/** A landmark that is trustworthy enough to decide readiness geometry. */
export type TrustedLandmark = LandmarkEventPayload;

/**
 * Whether one landmark may be used for readiness geometry.
 *
 * Requires all three of: it exists, its coordinates and its visibility score
 * are finite, and it is visible enough. `minVisibility` is the exercise's own
 * configured floor, so this does not invent a competing visibility threshold.
 *
 * `presence` is deliberately not consulted. See the note at the top of this file:
 * it is a broadcast pose-level confidence for this model, not a per-landmark
 * observation, and requiring it refused readiness for correctly positioned users.
 *
 * This is the ONLY place landmark scores are compared for readiness. Any other
 * comparison in exercise code is a bug.
 */
export function isTrustedLandmark(
  landmark: LandmarkEventPayload | undefined,
  minVisibility: number,
): landmark is TrustedLandmark {
  if (!landmark) return false;
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
  if (!Number.isFinite(landmark.visibility)) return false;
  if (landmark.visibility < minVisibility) return false;
  return true;
}

/**
 * Whether every landmark one side's geometry needs is trustworthy.
 *
 * Used to decide whether a side may establish or confirm readiness. A side
 * that fails this must be ignored entirely — it may neither veto readiness
 * nor contribute to it.
 */
export function isTrustedSide(
  landmarks: readonly LandmarkEventPayload[],
  requiredNames: readonly string[],
  minVisibility: number,
): boolean {
  const byName = new Map(landmarks.map((landmark) => [landmark.name, landmark]));
  return requiredNames.every((name) =>
    isTrustedLandmark(byName.get(name as LandmarkEventPayload['name']), minVisibility),
  );
}