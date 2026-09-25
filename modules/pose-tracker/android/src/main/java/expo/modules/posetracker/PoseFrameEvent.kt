package expo.modules.posetracker

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * NOVEN pose frame emitted to JavaScript via the `onPoseFrame` view event.
 *
 * Landmarks use normalized x/y coordinates in [0, 1]; z is relative depth;
 * visibility is in [0, 1]. `presence` is one of "not-tracked" | "tracked" | "lost".
 */
class PoseFrameEvent(
  @Field val timestampMs: Long,
  @Field val imageWidth: Int,
  @Field val imageHeight: Int,
  @Field val presence: String,
  @Field val landmarks: List<LandmarkEvent>
) : Record