package expo.modules.posetracker

import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

/**
 * Android adapter converting a MediaPipe `PoseLandmarkerResult` into the NOVEN
 * `PoseFrameEvent` contract. Purely data conversion — no movement scoring here.
 */
object NovenPoseAdapter {

  private const val PRESENCE_TRACKED = "tracked"
  private const val PRESENCE_LOST = "lost"

  fun toPoseFrameEvent(
    result: PoseLandmarkerResult,
    imageWidth: Int,
    imageHeight: Int
  ): PoseFrameEvent {
    val pose = result.landmarks().firstOrNull()

    if (pose == null) {
      return PoseFrameEvent(
        timestampMs = result.timestampMs(),
        imageWidth = imageWidth,
        imageHeight = imageHeight,
        presence = PRESENCE_LOST,
        landmarks = emptyList()
      )
    }

    val landmarks = pose.mapIndexed { index, landmark ->
      LandmarkEvent(
        name = POSE_LANDMARK_NAMES.getOrElse(index) { "UNKNOWN_$index" },
        x = landmark.x().toDouble(),
        y = landmark.y().toDouble(),
        z = landmark.z().toDouble(),
        visibility = landmark.visibility().orElse(0f).toDouble()
      )
    }

    return PoseFrameEvent(
      timestampMs = result.timestampMs(),
      imageWidth = imageWidth,
      imageHeight = imageHeight,
      presence = PRESENCE_TRACKED,
      landmarks = landmarks
    )
  }
}