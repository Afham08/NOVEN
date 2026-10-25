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
import java.util.concurrent.atomic.AtomicBoolean

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
  private val onPoseFrame: (PoseFrameEvent) -> Unit,
  private val onFatalError: (PoseTrackerErrorEvent) -> Unit
) {
  private var poseLandmarker: PoseLandmarker? = null
  private var lastTimestampMs = -1L
  private var lastEmitAtMs = 0L
  private var consecutiveSubmitFailures = 0
  @Volatile private var closed = false
  private val failureReported = AtomicBoolean(false)

  fun initialize() {
    if (closed) {
      Log.w(TAG, "PoseTrackerProcessor is closed; ignoring initialize.")
      return
    }
    if (poseLandmarker != null) return

    poseLandmarker = createPoseLandmarker(Delegate.GPU) ?: createPoseLandmarker(Delegate.CPU)

    if (poseLandmarker == null) {
      reportFatalFailure(
        category = "pose-initialization",
        message = "Pose tracking could not start. Return to exercises and reopen the session."
      )
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

    val bitmap = try {
      imageProxy.toRotatedBitmap(rotationDegrees)
    } catch (e: Exception) {
      imageProxy.close()
      Log.e(TAG, "Could not prepare a camera frame for pose tracking.", e)
      reportFatalFailure(
        category = "pose-runtime",
        message = "Pose tracking stopped unexpectedly. Return to exercises and reopen the session."
      )
      return
    }
    imageProxy.close()

    if (bitmap == null) return

    val mpImage = try {
      BitmapImageBuilder(bitmap).build()
    } catch (e: Exception) {
      Log.e(TAG, "Could not create a MediaPipe image for pose tracking.", e)
      reportFatalFailure(
        category = "pose-runtime",
        message = "Pose tracking stopped unexpectedly. Return to exercises and reopen the session."
      )
      return
    }
    try {
      landmarker.detectAsync(mpImage, timestampMs)
      consecutiveSubmitFailures = 0
    } catch (e: Exception) {
      // One rejected submission can be transient while LIVE_STREAM inference is
      // in flight. Repeated consecutive failures mean this tracker is no longer
      // accepting frames, so stop silently dropping them and report once.
      consecutiveSubmitFailures += 1
      Log.w(TAG, "detectAsync skipped: ${e.message}")
      mpImage.close()
      if (consecutiveSubmitFailures >= MAX_CONSECUTIVE_SUBMIT_FAILURES) {
        reportFatalFailure(
          category = "pose-runtime",
          message = "Pose tracking stopped unexpectedly. Return to exercises and reopen the session."
        )
      }
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
      if (closed || failureReported.get()) return
      val nowMs = SystemClock.elapsedRealtime()
      if (nowMs - lastEmitAtMs >= POSE_EMIT_INTERVAL_MS) {
        lastEmitAtMs = nowMs
        onPoseFrame(NovenPoseAdapter.toPoseFrameEvent(result, input.width, input.height))
      }
    } catch (e: Exception) {
      Log.e(TAG, "Could not process MediaPipe pose results.", e)
      reportFatalFailure(
        category = "pose-runtime",
        message = "Pose tracking stopped unexpectedly. Return to exercises and reopen the session."
      )
    } finally {
      input.close()
    }
  }

  private fun onDetectError(error: RuntimeException) {
    Log.e(TAG, "PoseLandmarker runtime error: ${error.message}")
    reportFatalFailure(
      category = "pose-runtime",
      message = "Pose tracking stopped unexpectedly. Return to exercises and reopen the session."
    )
  }

  private fun reportFatalFailure(category: String, message: String) {
    if (closed || !failureReported.compareAndSet(false, true)) return
    try {
      onFatalError(PoseTrackerErrorEvent(category, message))
    } catch (e: Exception) {
      Log.e(TAG, "Could not deliver pose-tracker failure to the native view.", e)
    }
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
    const val MAX_CONSECUTIVE_SUBMIT_FAILURES = 3
  }
}
