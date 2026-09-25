package expo.modules.posetracker

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class LandmarkEvent(
  @Field val name: String,
  @Field val x: Double,
  @Field val y: Double,
  @Field val z: Double,
  @Field val visibility: Double
) : Record