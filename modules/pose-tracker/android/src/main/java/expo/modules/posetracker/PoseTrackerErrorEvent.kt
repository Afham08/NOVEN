package expo.modules.posetracker

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Safe failure details emitted through the PoseTracker view event bridge. */
class PoseTrackerErrorEvent(
  @Field val category: String,
  @Field val message: String
) : Record
