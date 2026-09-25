package expo.modules.posetracker

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

/**
 * Wraps the MediaPipe Tasks `PoseLandmarker` in LIVE_STREAM mode.
 *
 * Responsibilities:
 *  - Loads the bundled `pose_landmarker_lite.task` model once, preferring the GPU
 *    delegate and falling back to CPU when initialization fails.
 *  - Feeds rotated camera frames via `detectAsync`, enforcing the strictly
 *    increasing timestamps LIVE_STREAM requires.
 *  - Throttles pose events to at most ~10/s and drops frames while a previous
 *    inference is still running (MediaPipe rejects overlapping LIVE_STREAM calls).
 *  - Reports results/errors through `onPoseFrame` / logs; never throws into the
 *    caller. Users must call [close] when no longer needed.
 *
 * NOTE: The GPU delegate initializes and runs on the analysis executor thread,
 * which is why [initialize] must be scheduled on that same thread.
 */
class PoseTrackerProcessor(
  private val context: Context,
  private val onPoseFrame: (PoseFrameEvent) -> Unit
) {
  private var poseLandmarker: PoseLandmarker? = null
  private var lastTimestampMs = -1L
  private var lastEmitAtMs = 0L
  private var closed = false

  fun initialize() {
    if (closed) {
      Log.w(TAG, "PoseTrackerProcessor is closed; ignoring initialize.")
      return
    }
    if (poseLandmarker != null) return

    poseLandmarker = createPoseLandmarker(Delegate.GPU) ?: createPoseLandmarker(Delegate.CPU)

    if (poseLandmarker == null) {
      Log.e(TAG, "PoseLandmarker could not be initialized with GPU or CPU delegate. Pose events disabled.")
    } else {
      Log.i(TAG, "PoseLandmarker initialized in LIVE_STREAM mode.")
    }
  }

  private fun createPoseLandmarker(delegate: Delegate): PoseLandmarker? {
    return try {
      val baseOptions = BaseOptions.builder()
        .setModelAssetPath(MODEL_ASSET)
        .setDelegate(delegate)
        .build()

      val options = PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(baseOptions)
        .setRunningMode(RunningMode.LIVE_STREAM)
        .setNumPoses(1)
        .setMinPoseDetectionConfidence(0.5f)
        .setMinPosePresenceConfidence(0.5f)
        .setMinTrackingConfidence(0.5f)
        .setResultListener(::onDetectResult)
        .setErrorListener(::onDetectError)
        .build()

      PoseLandmarker.createFromOptions(context, options)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to create PoseLandmarker with delegate $delegate: ${e.message}")
      null
    }
  }

  /**
   * Processes one camera frame. Always closes [imageProxy] regardless of outcome.
   */
  fun processFrame(imageProxy: ImageProxy) {
    val landmarker = poseLandmarker ?: run {
      imageProxy.close()
      return
    }

    val width = imageProxy.width
    val height = imageProxy.height
    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
    val captureTimestampNs = imageProxy.imageInfo.timestamp

    // LIVE_STREAM requires strictly increasing timestamps across calls.
    val timestampMs = nextTimestampMs(captureTimestampNs)

    val bitmap = imageProxy.toRotatedBitmap(rotationDegrees)
    imageProxy.close()

    if (bitmap == null) return

    val mpImage = BitmapImageBuilder(bitmap).build()
    try {
      landmarker.detectAsync(mpImage, timestampMs)
    } catch (e: Exception) {
      // A previous inference may still be in flight; drop this frame.
      Log.w(TAG, "detectAsync skipped: ${e.message}")
      mpImage.close()
    }
  }

  private fun nextTimestampMs(captureTimestampNs: Long): Long {
    val candidate = if (captureTimestampNs > 0) {
      captureTimestampNs / NANOS_PER_MILLIS
    } else {
      SystemClock.uptimeMillis()
    }
    lastTimestampMs = if (candidate > lastTimestampMs) candidate else lastTimestampMs + 1
    return lastTimestampMs
  }

  private fun onDetectResult(result: PoseLandmarkerResult, input: MPImage) {
    try {
      val nowMs = SystemClock.elapsedRealtime()
      if (nowMs - lastEmitAtMs >= POSE_EMIT_INTERVAL_MS) {
        lastEmitAtMs = nowMs
        onPoseFrame(NovenPoseAdapter.toPoseFrameEvent(result, input.width, input.height))
      }
    } finally {
      input.close()
    }
  }

  private fun onDetectError(error: RuntimeException) {
    Log.e(TAG, "PoseLandmarker runtime error: ${error.message}")
  }

  fun close() {
    if (closed) return
    closed = true

    val landmarker = poseLandmarker
    poseLandmarker = null

    if (landmarker == null) {
      Log.d(TAG, "PoseTrackerProcessor close: no PoseLandmarker to release.")
      return
    }

    try {
      landmarker.close()
      Log.d(TAG, "PoseLandmarker released.")
    } catch (e: Exception) {
      Log.e(TAG, "Error closing PoseLandmarker: ${e.message}")
    }
  }

  private companion object {
    const val TAG = "PoseTracker"
    const val MODEL_ASSET = "pose_landmarker_lite.task"
    const val NANOS_PER_MILLIS = 1_000_000L
    const val POSE_EMIT_INTERVAL_MS = 100L
  }
}