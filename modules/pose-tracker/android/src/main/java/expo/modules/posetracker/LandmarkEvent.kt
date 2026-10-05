package expo.modules.posetracker

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * One normalized MediaPipe pose landmark as delivered to JavaScript.
 *
 * `visibility` and `presence` are BOTH carried, and they are not
 * interchangeable. Per MediaPipe's own definition
 * (`mediapipe/framework/formats/landmark.proto`):
 *
 *  - `visibility` — "float score of whether landmark is visible or occluded by
 *    other objects. Landmark considered as invisible also if it is not present
 *    on the screen (out of scene bounds)."
 *  - `presence` — "float score of whether landmark is present on the scene
 *    (located within scene bounds)."
 *
 * Both are proto2-optional and are delivered as
 * `java.util.Optional<java.lang.Float>` by
 * `com.google.mediapipe.tasks.components.containers.NormalizedLandmark`. An
 * absent score means "not supported", so it is mapped to `0.0` here rather
 * than to `1.0`: the JS trust policy treats an unknown observation as
 * untrusted, which refuses readiness instead of granting it on absent evidence.
 *
 * Keeping the two apart matters because a landmark the model has inferred for
 * an occluded limb can still carry a usable-looking `visibility` while its
 * `presence` reflects that nothing was really there.
 */
class LandmarkEvent(
  @Field val name: String,
  @Field val x: Double,
  @Field val y: Double,
  @Field val z: Double,
  @Field val visibility: Double,
  @Field val presence: Double
) : Record