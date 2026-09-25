package expo.modules.posetracker

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import androidx.camera.core.ImageProxy

private const val TAG = "PoseTracker"

/**
 * Converts a CameraX `ImageProxy` frame into an ARGB_8888 bitmap rotated to the
 * display orientation, ready to hand to MediaPipe. Matches Google's official
 * MediaPipe Pose Landmarker Android sample conversion.
 */
fun ImageProxy.toRotatedBitmap(rotationDegrees: Int): Bitmap? {
  return try {
    val raw = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    raw.copyPixelsFromBuffer(planes[0].buffer)

    val matrix = Matrix().apply {
      postRotate(rotationDegrees.toFloat())
    }

    Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
  } catch (e: Exception) {
    Log.e(TAG, "Failed to convert frame to bitmap: ${e.message}")
    null
  }
}