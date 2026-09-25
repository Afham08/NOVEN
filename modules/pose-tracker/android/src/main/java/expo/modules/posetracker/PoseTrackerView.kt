package expo.modules.posetracker

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.os.SystemClock
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.Collections
import java.util.IdentityHashMap
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

private const val TAG = "PoseTracker"
private const val EMIT_INTERVAL_MS = 100L

/**
 * CameraX-powered camera preview for NOVEN.
 *
 * Renders the live camera preview, reports frame counter/timestamp events to
 * JavaScript, and feeds every analyzed frame to [PoseTrackerProcessor] which
 * runs MediaPipe Tasks PoseLandmarker and emits `onPoseFrame` events.
 */
@SuppressLint("ViewConstructor")
class PoseTrackerView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {

  private val previewView = PreviewView(context).apply {
    // TextureView-based preview renders reliably inside the React Native view
    // hierarchy (SurfaceView can be layered behind the React surface and show
    // a blank area). Keeps the standard camera preview look.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val frameCount = AtomicLong(0)
  private val lastEmitAt = AtomicLong(0)
  private val analysisExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "pose-tracker-analysis").apply {
      isDaemon = true
    }
  }
  private val surfaceFutureExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "pose-tracker-surface-future").apply {
      isDaemon = true
    }
  }
  private val instrumentedSurfaceViews = Collections.newSetFromMap(IdentityHashMap<View, Boolean>())

  private val onFrame by EventDispatcher<CameraFrameEvent>()
  private val onPoseFrame by EventDispatcher<PoseFrameEvent>()

  private val disposed = AtomicBoolean(false)
  private val frameDiagDone = AtomicBoolean(false)

  private val poseTrackerProcessor = PoseTrackerProcessor(context) { poseFrame ->
    if (!disposed.get()) {
      onPoseFrame(poseFrame)
    }
  }

  private val scope = CoroutineScope(
    Dispatchers.Main + SupervisorJob() + CoroutineExceptionHandler { _, throwable ->
      Log.e(TAG, "Unhandled camera coroutine exception", throwable)
    }
  )

  init {
    Log.d(TAG, "PoseTrackerView initializing, camera permission granted=${hasCameraPermission()}")
    addView(
      previewView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    // MediaPipe must be initialized and used on the same thread when the GPU
    // delegate is requested, so initialize on the analysis executor.
    analysisExecutor.execute {
      poseTrackerProcessor.initialize()
    }
    startCamera()
  }

  private fun startCamera() {
    scope.launch {
      try {
        if (!hasCameraPermission()) {
          Log.w(TAG, "Camera permission is not granted, camera will not start.")
          return@launch
        }
        Log.d(TAG, "Camera permission granted.")

        val activity = appContext.throwingActivity
        if (activity !is LifecycleOwner) {
          Log.e(TAG, "Current activity is not a LifecycleOwner, camera will not start.")
          return@launch
        }

        Log.d(TAG, "Acquiring ProcessCameraProvider.")
        val cameraProvider = ProcessCameraProvider.awaitInstance(context)
        Log.d(TAG, "ProcessCameraProvider acquired.")

        if (disposed.get()) {
          Log.w(TAG, "View disposed while waiting for camera provider; skipping bind.")
          return@launch
        }

        val surfaceProvider = previewView.surfaceProvider
        Log.i(
          TAG,
          "[DIAG] before Preview.setSurfaceProvider: providerNonNull=${surfaceProvider != null}, " +
            "viewAttached=${previewView.isAttachedToWindow}, viewSize=${previewView.width}x${previewView.height}"
        )

        // TEMP diagnostic: wrap the real PreviewView SurfaceProvider so we can log
        // when CameraX requests a surface, the requested resolution, and when/if a
        // Surface is actually provided. The original PreviewView provider is still
        // invoked unchanged, so the rendering path is untouched.
        val loggingSurfaceProvider = Preview.SurfaceProvider { request ->
          Log.i(TAG, "[DIAG-SFC] CameraX called onSurfaceRequested (preview surface requested).")
          Log.i(TAG, "[DIAG-SFC] request resolution=${request.resolution}")
          Log.i(TAG, "[DIAG-SFC] request serviced=${request.isServiced}")
          request.addRequestCancellationListener(surfaceFutureExecutor) {
            Log.w(TAG, "[DIAG-SFC] surface request CANCELLED - no Surface will be provided.")
          }
          val surfaceFuture = request.deferrableSurface.surface
          surfaceFuture.addListener({
            if (surfaceFuture.isCancelled) {
              Log.w(TAG, "[DIAG-SFC] surface future cancelled - no Surface provided.")
            } else if (surfaceFuture.isDone) {
              try {
                val s = surfaceFuture.get()
                Log.i(
                  TAG,
                  "[DIAG-SFC] provideSurface result: surface=${s}, surfaceValid=${s.isValid}"
                )
              } catch (e: Exception) {
                Log.e(
                  TAG,
                  "[DIAG-SFC] provideSurface FAILED (willNotProvideSurface or error): " +
                    "${e.message ?: e.javaClass.simpleName}",
                  e
                )
              }
            } else {
              Log.i(TAG, "[DIAG-SFC] surface future neither done nor cancelled (pending).")
            }
          }, surfaceFutureExecutor)
          surfaceProvider.onSurfaceRequested(request)
          Log.i(TAG, "[DIAG-SFC] forwarded onSurfaceRequested to real PreviewView provider.")
          logPreviewViewChildren("after-surface-forward")
          forcePreviewChildLayout()
        }

        val preview = Preview.Builder().build().also {
          Log.d(TAG, "[DIAG] calling Preview.setSurfaceProvider(logging wrapper around previewView.surfaceProvider)")
          it.surfaceProvider = loggingSurfaceProvider
          Log.d(TAG, "[DIAG] Preview logging surfaceProvider assigned to use case.")
        }

        // TEMP diagnostic experiment: bind ONLY Preview. ImageAnalysis construction
        // and binding/processing are disabled so we can isolate whether binding
        // Preview + ImageAnalysis together stalls the preview surface negotiation.
        val enableAnalysis = true
        val analysis: ImageAnalysis? = if (enableAnalysis) {
          ImageAnalysis.Builder()
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also {
              it.setAnalyzer(analysisExecutor) { imageProxy ->
                val count = frameCount.incrementAndGet()
                if (!disposed.get()) {
                  val tsNs = imageProxy.imageInfo.timestamp
                  val nowMs = SystemClock.elapsedRealtime()
                  val lastEmit = lastEmitAt.get()
                  if (nowMs - lastEmit >= EMIT_INTERVAL_MS && lastEmitAt.compareAndSet(lastEmit, nowMs)) {
                    onFrame(
                      CameraFrameEvent(
                        frameIndex = count,
                        timestampNs = tsNs,
                        elapsedRealtimeMs = nowMs,
                        width = imageProxy.width,
                        height = imageProxy.height
                      )
                    )
                  }
                }
                if (frameDiagDone.compareAndSet(false, true)) {
                  diagnoseFrameOnce(imageProxy)
                }
                poseTrackerProcessor.processFrame(imageProxy)
              }
            }
        } else {
          Log.i(TAG, "ImageAnalysis enabled; binding Preview + ImageAnalysis use cases.")
          null
        }

        cameraProvider.unbindAll()
        logPreviewViewHierarchy("before-bind")
        logPreviewViewChildren("before-bind")
        val camera = if (analysis != null) {
          cameraProvider.bindToLifecycle(
            activity,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            preview,
            analysis
          )
        } else {
          cameraProvider.bindToLifecycle(
            activity,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            preview
          )
        }
        Log.i(TAG, "CameraX bound to activity lifecycle, cameraSelector=${camera.cameraInfo.cameraSelector}")
        Log.i(
          TAG,
          "[DIAG] bindToLifecycle returned camera: nonNull=${camera != null}, " +
            "lensFacing=${camera.cameraInfo.lensFacing}"
        )
        Log.d(
          TAG,
          "[DIAG] bind state: previewBound=${cameraProvider.isBound(preview)}, " +
            "analysisBound=${analysis != null && cameraProvider.isBound(analysis)}, " +
            "hasFrontCamera=${cameraProvider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)}"
        )
        logPreviewViewHierarchy("after-bind")
        logPreviewViewChildren("after-bind")
        val stateObserver = Observer<CameraState> { state ->
          val error = state.error
          if (error != null) {
            Log.e(
              TAG,
              "[DIAG] cameraState=${state.type} errorCode=${error.code} errorCause=${error.cause?.message}"
            )
          } else {
            Log.i(TAG, "[DIAG] cameraState=${state.type} (no error)")
          }
        }
        (activity as LifecycleOwner).let { owner ->
          camera.cameraInfo.cameraState.observe(owner, stateObserver)
        }
        previewView.post {
          val pvLoc = IntArray(2)
          previewView.getLocationInWindow(pvLoc)
          Log.i(
            TAG,
            "[DIAG] PreviewView size=${previewView.width}x${previewView.height}, " +
              "windowLoc=(${pvLoc[0]},${pvLoc[1]}), " +
              "implementationMode=${previewView.implementationMode}, " +
              "scaleType=${previewView.scaleType}"
          )
        }
        previewView.postDelayed({
          Log.i(
            TAG,
            "[DIAG] 1500ms after bind: viewSize=${previewView.width}x${previewView.height}, " +
              "viewAttached=${previewView.isAttachedToWindow}, " +
              "providerNonNull=${previewView.surfaceProvider != null}"
          )
          forcePreviewChildLayout()
          applyScaleFillTransform()
          logPreviewGeometry("1500ms")
          logPreviewViewChildren("after-bind-1500ms")
          previewView.postDelayed({
            Log.i(TAG, "[DIAG] 3500ms after bind (post force):")
            logPreviewFillState()
            logPreviewGeometry("3500ms")
            applyScaleFillTransform()
          }, 2000)
          previewView.postDelayed({
            dumpTextureBitmap()
          }, 4500)
          previewView.postDelayed({
            applyScaleFillTransform()
            dumpOverlapSiblings()
          }, 6000)
        }, 1500)
        previewView.postDelayed({
          Log.i(TAG, "[DIAG-PROBE] issuing requestLayout() on PreviewView to test RN child-layout propagation")
          previewView.requestLayout()
          previewView.postDelayed({
            logPreviewViewChildren("after-requestLayout-500ms")
          }, 500)
        }, 3000)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to start camera: ${e.message ?: e.javaClass.simpleName}", e)
      }
    }
  }

  private fun diagnoseFrameOnce(imageProxy: ImageProxy) {
    try {
      val plane = imageProxy.planes[0]
      val w = imageProxy.width
      val h = imageProxy.height
      val rowStride = plane.rowStride
      val pixelStride = plane.pixelStride
      val buf = plane.buffer.duplicate()
      val bytes = ByteArray(buf.remaining())
      buf.get(bytes)
      var black = 0L
      var total = 0L
      var minX = w
      var minY = h
      var maxX = -1
      var maxY = -1
      val blackRows = ArrayList<Int>()
      val blackCols = ArrayList<Int>()
      for (y in 0 until h step 4) {
        var rowBlack = 0
        var rowTotal = 0
        for (x in 0 until w step 4) {
          val o = y * rowStride + x * pixelStride
          if (o + 2 >= bytes.size) continue
          val r = bytes[o].toInt() and 0xff
          val g = bytes[o + 1].toInt() and 0xff
          val b = bytes[o + 2].toInt() and 0xff
          val lum = (r + g + b) / 3.0
          rowTotal++
          total++
          if (lum <= 8.0) {
            black++
            rowBlack++
          } else {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        if (rowTotal > 0 && rowBlack.toDouble() / rowTotal > 0.9) blackRows.add(y)
      }
      for (x in 0 until w step 4) {
        var colBlack = 0
        var colTotal = 0
        for (y in 0 until h step 4) {
          val o = y * rowStride + x * pixelStride
          if (o + 2 >= bytes.size) continue
          val r = bytes[o].toInt() and 0xff
          val g = bytes[o + 1].toInt() and 0xff
          val b = bytes[o + 2].toInt() and 0xff
          if ((r + g + b) / 3.0 <= 8.0) colBlack++
          colTotal++
        }
        if (colTotal > 0 && colBlack.toDouble() / colTotal > 0.9) blackCols.add(x)
      }
      Log.i(
        TAG,
        "[DIAG-FRAME] size=${w}x${h} blackFrac=${String.format("%.1f", black.toDouble() * 100 / total)}% " +
          "contentBox=[$minX,$minY]-[$maxX,$maxY] contentSize=${if (maxX >= 0) (maxX - minX + 1) else 0}x${if (maxY >= 0) (maxY - minY + 1) else 0} " +
          "blackRowBand=${blackRows.minOrNull() ?: -1}..${blackRows.maxOrNull() ?: -1} " +
          "blackColBand=${blackCols.minOrNull() ?: -1}..${blackCols.maxOrNull() ?: -1}"
      )
    } catch (e: Exception) {
      Log.w(TAG, "[DIAG-FRAME] diagnosis failed: ${e.message}")
    }
  }

  private fun visibilityName(visibility: Int): String =
    when (visibility) {
      View.VISIBLE -> "VISIBLE"
      View.INVISIBLE -> "INVISIBLE"
      View.GONE -> "GONE"
      else -> "UNKNOWN($visibility)"
    }

  private fun logPreviewViewHierarchy(label: String) {
    val sb = StringBuilder()
    sb.append("\n[DIAG-VH] label=$label implementationMode=${previewView.implementationMode} " +
      "scaleType=${previewView.scaleType}")
    sb.append("\n[DIAG-VH] PreviewView class=${previewView.javaClass.name} " +
      "attached=${previewView.isAttachedToWindow} vis=${visibilityName(previewView.visibility)} " +
      "alpha=${previewView.alpha} size=${previewView.width}x${previewView.height} " +
      "windowVis=${previewView.getWindowVisibility()} windowToken=${previewView.windowToken != null} " +
      "parent=${previewView.parent?.javaClass?.name} " +
      "surfaceProviderClass=${previewView.surfaceProvider.javaClass.name}")
    var v: View? = previewView.parent as? View
    var depth = 1
    while (v != null && depth <= 20) {
      sb.append("\n[DIAG-VH] ancestor depth=$depth class=${v.javaClass.name} " +
        "attached=${v.isAttachedToWindow} vis=${visibilityName(v.visibility)} " +
        "alpha=${v.alpha} size=${v.width}x${v.height}")
      v = v.parent as? View
      depth++
    }
    Log.d(TAG, sb.toString())
  }

  private fun logPreviewViewChildren(label: String) {
    Log.d(TAG, "[DIAG-CHILD] label=$label childCount=${previewView.childCount}")
    for (i in 0 until previewView.childCount) {
      dumpViewTree(label, previewView.getChildAt(i), 0)
    }
  }

  private fun dumpViewTree(label: String, view: View, depth: Int) {
    if (depth > 10) return
    val msg = "class=${view.javaClass.name} size=${view.width}x${view.height} " +
      "vis=${visibilityName(view.visibility)} alpha=${view.alpha} " +
      "attached=${view.isAttachedToWindow} windowVis=${view.getWindowVisibility()} " +
      "windowToken=${view.windowToken != null}"
    when (view) {
      is SurfaceView -> {
        val holder = view.holder
        Log.d(
          TAG,
          "[DIAG-CHILD] $label depth=$depth $msg SURFACEVIEW " +
            "surfaceFrame=${holder.surfaceFrame} " +
            "holderSurfaceExists=${holder.surface != null} " +
            "surfaceValid=${holder.surface?.isValid ?: false}"
        )
        if (instrumentedSurfaceViews.add(view)) {
          holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
              Log.d(
                TAG,
                "[DIAG-SVH] surfaceCreated frame=${holder.surfaceFrame} " +
                  "surface=${holder.surface} valid=${holder.surface.isValid}"
              )
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
              Log.d(
                TAG,
                "[DIAG-SVH] surfaceChanged width=$width height=$height format=$format " +
                  "valid=${holder.surface.isValid}"
              )
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
              Log.w(TAG, "[DIAG-SVH] surfaceDestroyed")
            }
          })
          Log.d(TAG, "[DIAG-CHILD] $label depth=$depth attached temporary SurfaceHolder.Callback")
        }
      }
      is TextureView -> {
        Log.d(
          TAG,
          "[DIAG-CHILD] $label depth=$depth $msg TEXTUREVIEW " +
            "isAvailable=${view.isAvailable} isOpaque=${view.isOpaque} " +
            "hasSurfaceTexture=${view.surfaceTexture != null}" +
            (if (view.surfaceTextureListener == null) "" else " existingListener=${view.surfaceTextureListener!!.javaClass.name}")
        )
        if (view.surfaceTextureListener == null) {
          view.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
              Log.i(
                TAG,
                "[DIAG-TXV] onSurfaceTextureAvailable width=$width height=$height " +
                  "surface=$surface"
              )
            }

            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
              Log.i(TAG, "[DIAG-TXV] onSurfaceTextureSizeChanged width=$width height=$height")
            }

            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
              Log.w(TAG, "[DIAG-TXV] onSurfaceTextureDestroyed")
              return false
            }

            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
              // Intentionally silent; fires on every frame.
            }
          }
          Log.d(TAG, "[DIAG-CHILD] $label depth=$depth attached temporary SurfaceTextureListener")
        } else {
          Log.d(TAG, "[DIAG-CHILD] $label depth=$depth existing listener present; NOT overriding")
        }
      }
      else -> {
        Log.d(TAG, "[DIAG-CHILD] $label depth=$depth $msg")
      }
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        dumpViewTree(label, view.getChildAt(i), depth + 1)
      }
    }
  }

  private fun forcePreviewChildLayout() {
    val w = previewView.width.takeIf { it > 0 } ?: previewView.measuredWidth
    val h = previewView.height.takeIf { it > 0 } ?: previewView.measuredHeight
    if (w <= 0 || h <= 0) {
      Log.d(TAG, "[DIAG-FIX] skip: previewView size=${previewView.width}x${previewView.height}")
      return
    }
    for (i in 0 until previewView.childCount) {
      val child = previewView.getChildAt(i)
      if (child == null) continue
      if (child.layoutParams is FrameLayout.LayoutParams) {
        // CameraX creates the internal renderer sized to the camera stream
        // resolution (1600x1200). Adopting card-sized MATCH_PARENT params here
        // means CameraX's own onLayout also frames it at the PreviewView bounds,
        // so the feed fills the card with FILL_CENTER crop-to-fill.
        child.layoutParams = FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      }
      child.measure(
        View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY)
      )
      child.layout(0, 0, w, h)
      child.requestLayout()
      child.invalidate()
    }
    previewView.invalidate()
    logPreviewFillState()
  }

  private fun logPreviewFillState() {
    for (i in 0 until previewView.childCount) {
      val child = previewView.getChildAt(i)
      when (child) {
        is TextureView -> {
          val matrix = Matrix()
          child.getTransform(matrix)
          val stMatrixValues = FloatArray(16)
          child.surfaceTexture?.getTransformMatrix(stMatrixValues)
          val loc = IntArray(2)
          child.getLocationInWindow(loc)
          Log.i(
            TAG,
            "[DIAG-FILL] texture=${child.width}x${child.height} " +
              "viewTransform=${matrix} " +
              "stTransform=[${(0 until 4).joinToString(" | ") { r -> (0 until 4).joinToString(",") { c -> String.format("%.3f", stMatrixValues[r * 4 + c]) } }}] " +
              "stAnim=[m00=${String.format("%.3f", stMatrixValues[0])},m11=${String.format("%.3f", stMatrixValues[5])},m22=${String.format("%.3f", stMatrixValues[10])},tx=${String.format("%.3f", stMatrixValues[12])},ty=${String.format("%.3f", stMatrixValues[13])}] " +
              "windowLoc=(${loc[0]},${loc[1]}) " +
              "available=${child.isAvailable}"
          )
        }
        is SurfaceView -> Log.d(TAG, "[DIAG-FILL] surfaceView=${child.width}x${child.height}")
      }
    }
  }

  private fun logPreviewGeometry(tagTime: String) {
    fun viewGeom(label: String, v: View) {
      val loc = IntArray(2)
      v.getLocationInWindow(loc)
      val m = Matrix(v.matrix)
      val mv = FloatArray(9)
      m.getValues(mv)
      Log.i(
        TAG,
        "[DIAG-GEO $tagTime] $label " +
          "class=${v.javaClass.simpleName} " +
          "bounds(left,top,right,bottom)=(${v.left},${v.top},${v.right},${v.bottom}) " +
          "x=${v.x} y=${v.y} " +
          "width=${v.width} height=${v.height} " +
          "windowLoc=(${loc[0]},${loc[1]}) " +
          "scaleX=${v.scaleX} scaleY=${v.scaleY} " +
          "rotation=${v.rotation} rotationX=${v.rotationX} rotationY=${v.rotationY} " +
          "translationX=${v.translationX} translationY=${v.translationY} " +
          "pivotX=${v.pivotX} pivotY=${v.pivotY} " +
          "alpha=${v.alpha} visibility=${v.visibility} " +
          "matrix=(${mv.joinToString(",") { String.format("%.3f", it) }}"
      )
    }
    viewGeom("previewView", previewView)
    previewView.parent?.let { parentRaw ->
      val parent = parentRaw as? View
      if (parent != null) {
        viewGeom("parent", parent)
        Log.i(TAG, "[DIAG-GEO $tagTime] parent childCount=${(parent as? ViewGroup)?.childCount}")
        if (parent is ViewGroup) {
          for (i in 0 until parent.childCount) {
            val c = parent.getChildAt(i)
            if (c === previewView) continue
            viewGeom("parentChild[$i]", c)
          }
        }
      }
    }
    for (i in 0 until previewView.childCount) {
      val c = previewView.getChildAt(i)
      viewGeom(if (i == 0) "texture*" else "previewChild[$i]", c)
      if (c is TextureView) {
        val stM = FloatArray(16)
        c.surfaceTexture?.getTransformMatrix(stM)
        Log.i(
          TAG,
          "[DIAG-GEO $tagTime] textureSurface isAvailable=${c.isAvailable} isOpaque=${c.isOpaque} " +
            "stMatrix=[${(0 until 4).joinToString(" | ") { r -> (0 until 4).joinToString(",") { col -> String.format("%.3f", stM[r * 4 + col]) } }}]"
        )
      }
    }
  }

  private fun applyScaleFillTransform() {
    for (i in 0 until previewView.childCount) {
      val child = previewView.getChildAt(i)
      if (child !is TextureView) continue
      if (!child.isAvailable) {
        Log.i(TAG, "[DIAG-SCALE] texture not available yet, skipping")
        continue
      }
      val vw = child.width
      val vh = child.height
      if (vw <= 0 || vh <= 0) continue
      // Camera pipeline:
      //  - CameraX preview uses a 1600x1200 (landscape) SurfaceTexture buffer
      //    ([DIAG-SFC] request resolution=1600x1200).
      //  - The SurfaceTexture transform matrix is a pure 90-degree rotation
      //    (stMatrix [0,-1,1,0]), so the displayed source is effectively
      //    PORTRAIT 1200 wide x 1600 tall (aspect 0.75).
      //  - The TextureView quad is the card: 992 wide x 715 tall (aspect 1.39).
      // A 1:1 mapping pulls the portrait frame apart horizontally (faces wider).
      // Apply the uniform center-crop math:
      //    scale    = max(viewW/sourceW, viewH/sourceH)     (uniform source scale)
      //    contentW = sourceW*scale, contentH = sourceH*scale
      //    tx = (viewW - contentW)/2, ty = (viewH - contentH)/2
      // For this card: scale = max(992/1200, 715/1600) = 0.82667, content = 992x1322.7,
      // tx = 0, ty = -303.83 -> fill width, crop top/bottom, same pixel density on
      // both axes (natural aspect), no black bars. The TextureView quad already
      // stretches the source onto (viewW x viewH), so project the crop back into
      // view-space factors: scaleX = contentW/vw, scaleY = contentH/vh.
      val sourceW = 1200f
      val sourceH = 1600f
      val scale = maxOf(vw / sourceW, vh / sourceH)
      val contentW = sourceW * scale
      val contentH = sourceH * scale
      val tx = (vw - contentW) / 2f
      val ty = (vh - contentH) / 2f
      child.pivotX = 0f
      child.pivotY = 0f
      child.scaleX = contentW / vw
      child.scaleY = contentH / vh
      child.translationX = tx
      child.translationY = ty
      val loc = IntArray(2)
      child.getLocationInWindow(loc)
      val message =
        "[DIAG-SCALE] view=${vw}x${vh} source(rotated)=${sourceW.toInt()}x${sourceH.toInt()} " +
          "uniformScale=" + String.format("%.4f", scale) +
          " content=${contentW.toInt()}x${contentH.toInt()} " +
          "viewScale=" + String.format("%.3fx%.3f", contentW / vw, contentH / vh) +
          " tx=" + String.format("%.2f", tx) + " ty=" + String.format("%.2f", ty) +
          " drawnRect=[${loc[0]},${loc[1]}]-[${loc[0] + vw},${loc[1] + vh}]"
      Log.i(TAG, message)
    }
  }

  private fun dumpOverlapSiblings() {
    val here = IntArray(2)
    val pv = previewView
    try {
      val topMost = StringBuilder()
      var anc: View? = pv
      val path = ArrayList<View>()
      while (anc != null) {
        path.add(anc)
        anc = anc.parent as? View
      }
      path.reverse()
      for (v in path) {
        val loc = IntArray(2)
        v.getLocationInWindow(loc)
        topMost.append(
          "${v.javaClass.simpleName} id=${v.id} bounds=[${loc[0]},${loc[1]}]-[${loc[0] + v.width},${loc[1] + v.height}] " +
            "vis=${v.visibility} alpha=${v.alpha} ctxResolve=${v.contentDescription}"
        )
        topMost.append("\n")
      }
      Log.i(TAG, "[DIAG-ANCESTORS]\n$topMost")
    } catch (e: Exception) {
      Log.e(TAG, "[DIAG-ANCESTORS] failed: ${e.message}", e)
    }
    try {
      pv.getLocationInWindow(here)
      val parent = pv.parent as? ViewGroup ?: return
      val sb = StringBuilder()
      for (i in 0 until parent.childCount) {
        val c = parent.getChildAt(i)
        val loc = IntArray(2)
        c.getLocationInWindow(loc)
        val overlap = loc[0] < here[0] + pv.width && loc[0] + c.width > here[0] && loc[1] < here[1] + pv.height && loc[1] + c.height > here[1]
        val isPv = c === pv
        sb.append(
          "${if (isPv) "**" else "  "}${c.javaClass.simpleName} bounds=[${loc[0]},${loc[1]}]-[${loc[0] + c.width},${loc[1] + c.height}] " +
            "alpha=${c.alpha} drawn=${c.isShown} overlap=$overlap zOrder=$i\n"
        )
      }
      Log.i(TAG, "[DIAG-SIBLINGS] parent=${parent.javaClass.simpleName} view=${pv.javaClass.simpleName} top=${here[1]}\n$sb")
    } catch (e: Exception) {
      Log.e(TAG, "[DIAG-SIBLINGS] failed: ${e.message}", e)
    }
  }

  private fun hasCameraPermission(): Boolean =
    ContextCompat.checkSelfPermission(context, android.Manifest.permission.CAMERA) ==
      PackageManager.PERMISSION_GRANTED

  private fun dumpTextureBitmap() {
    for (i in 0 until previewView.childCount) {
      val child = previewView.getChildAt(i)
      if (child is TextureView && child.isAvailable) {
        val bmp = try { child.bitmap } catch (e: Exception) { null }
        if (bmp != null) {
          Log.i(TAG, "[DIAG-BITMAP] captured ${bmp.width}x${bmp.height}")
          val pw = bmp.width
          val ph = bmp.height
          var minX = Int.MAX_VALUE
          var minY = Int.MAX_VALUE
          var maxX = -1
          var maxY = -1
          var blackTotal = 0L
          var total = 0L
          val rowBuf = IntArray(pw)
          val isBlack = { c: Int -> ((c shr 16) and 0xff) + ((c shr 8) and 0xff) + (c and 0xff) <= 24 }
          for (y in 0 until ph) {
            bmp.getPixels(rowBuf, 0, pw, 0, y, pw, 1)
            var rowBlack = 0
            for (x in 0 until pw) {
              total++
              if (isBlack(rowBuf[x])) rowBlack++ else {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
              }
            }
            blackTotal += rowBlack
          }
          var lastBlackRow = -1
          for (y in ph - 1 downTo 0) {
            bmp.getPixels(rowBuf, 0, pw, 0, y, pw, 1)
            var rowBlack = 0
            for (x in 0 until pw) { if (isBlack(rowBuf[x])) rowBlack++ }
            if (rowBlack > pw * 0.9) { lastBlackRow = y; break }
          }
          var lastBlackCol = -1
          for (x in pw - 1 downTo 0) {
            var colBlack = 0
            for (y in 0 until ph) { if (isBlack(bmp.getPixel(x, y))) colBlack++ }
            if (colBlack > ph * 0.9) { lastBlackCol = x; break }
          }
          val cw = if (maxX >= minX) maxX - minX + 1 else 0
          val ch = if (maxY >= minY) maxY - minY + 1 else 0
          Log.i(
            TAG,
            "[DIAG-BITMAP] size=${pw}x${ph} blackFrac=${String.format("%.1f", 100.0 * blackTotal / total)}% " +
              "contentBox=[$minX,$minY]-[$maxX,$maxY] contentSize=${cw}x${ch} " +
              "blackColBand=$lastBlackCol blackRowBand=$lastBlackRow"
          )
          try {
            val file = File(context.filesDir, "previewbitmap.png")
            FileOutputStream(file).use { fos ->
              bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 90, fos)
            }
            Log.i(TAG, "[DIAG-BITMAP] saved ${file.absolutePath}")
          } catch (e: Exception) {
            Log.e(TAG, "[DIAG-BITMAP] save failed: ${e.message}", e)
          }
        } else {
          Log.i(TAG, "[DIAG-BITMAP] unavailable")
        }
      }
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    // Deliberately NOT releasing camera/pose here. React Native (via the native
    // stack's fragment hosting) can synchronously detach and re-attach native
    // children during view reparenting / screen transitions. Treating that
    // transient detach as permanent kills the camera preview and pose stream.
    // Permanent teardown happens only in [releaseCameraAndPose], invoked from
    // the view manager's OnViewDestroys when RN genuinely disposes the view.
    Log.d(TAG, "PoseTrackerView detached from window; keeping camera and pose processing alive.")
  }

  /**
   * Permanent teardown, invoked by React Native through the view manager's
   * OnViewDestroys once the view instance is no longer used. Safe to call more
   * than once.
   */
  fun releaseCameraAndPose() {
    if (!disposed.compareAndSet(false, true)) return
    Log.i(TAG, "PoseTrackerView being disposed; releasing camera and pose processing.")

    // Stop the async camera-start coroutine so it cannot bind after disposal.
    scope.cancel()

    // Unbind CameraX asynchronously without blocking the main thread.
    try {
      val providerFuture = ProcessCameraProvider.getInstance(context)
      providerFuture.addListener(
        {
          try {
            providerFuture.get().unbindAll()
            Log.i(TAG, "CameraX use cases unbound on view disposal.")
          } catch (e: Exception) {
            Log.w(TAG, "Failed to unbind camera on disposal: ${e.message}")
          }
        },
        ContextCompat.getMainExecutor(context)
      )
    } catch (e: Exception) {
      Log.w(TAG, "Could not request camera unbind on disposal: ${e.message}")
    }

    // Close the pose landmarker on the analysis thread while the executor can
    // still accept work, then stop accepting new work. Frames and close run on
    // the same single-thread executor, so they cannot race with each other.
    analysisExecutor.execute {
      try {
        poseTrackerProcessor.close()
        Log.d(TAG, "PoseTrackerProcessor closed.")
      } catch (e: Exception) {
        Log.e(TAG, "Failed to close PoseTrackerProcessor: ${e.message}")
      }
    }
    analysisExecutor.shutdown()
  }
}