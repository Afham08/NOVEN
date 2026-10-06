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
 * as an OBSERVED landmark. That needs both of MediaPipe's per-landmark scores,
 * because they answer different questions:
 *
 *  - `visibility` — "visible or occluded by other objects". Collapses to zero
 *    when the landmark leaves the frame entirely.
 *  - `presence`   — "present on the scene (located within scene bounds)",
 *    i.e. whether the landmark is really there at all rather than projected.
 *
 * A landmark that is visible-but-absent, or present-but-occluded, fails one of
 * the two, so requiring BOTH is what actually distinguishes an observation
 * from an inference. This deliberately does not replace `visibility` with
 * `presence`; they are different facts and both are used.
 *
 * An absent score is delivered natively as `0` (see `LandmarkEvent.kt`), so
 * "the model did not report this" is treated as untrusted. That is the safe
 * direction: it can refuse a legitimate pose, never accept a wrong one.
 */

/**
 * Minimum `presence` for a landmark to count as observed rather than inferred.
 *
 * 0.5 is MediaPipe's own default confidence floor for pose presence
 * (`min_pose_presence_confidence`, and the same 0.5 this module already uses
 * for detection/presence/tracking in `PoseTrackerProcessor`), so it is a
 * documented model convention rather than a number tuned to make a symptom
 * disappear. It is a TRUST floor for readiness only — it does not alter rep
 * detection, which keeps its existing visibility-only semantics.
 */
export const MIN_TRUSTED_PRESENCE = 0.5;

/** A landmark that is trustworthy enough to decide readiness geometry. */
export type TrustedLandmark = LandmarkEventPayload;

/**
 * Whether one landmark may be used for readiness geometry.
 *
 * Requires all four of: it exists, its coordinates are finite, it is visible
 * enough, and it is present enough to be an observation rather than an
 * inference. `minVisibility` is the exercise's own configured floor, so this
 * does not invent a competing visibility threshold.
 *
 * This is the ONLY place visibility/presence are compared for readiness. Any
 * other comparison in exercise code is a bug.
 */
export function isTrustedLandmark(
  landmark: LandmarkEventPayload | undefined,
  minVisibility: number,
): landmark is TrustedLandmark {
  if (!landmark) return false;
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
  if (!Number.isFinite(landmark.visibility)) return false;
  if (!Number.isFinite(landmark.presence)) return false;
  if (landmark.visibility < minVisibility) return false;
  if (landmark.presence < MIN_TRUSTED_PRESENCE) return false;
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