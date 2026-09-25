package expo.modules.posetracker

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CameraFrameEvent(
  @Field val frameIndex: Long,
  @Field val timestampNs: Long,
  @Field val elapsedRealtimeMs: Long,
  @Field val width: Int,
  @Field val height: Int
) : Record