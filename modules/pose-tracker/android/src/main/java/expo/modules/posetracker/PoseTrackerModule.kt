package expo.modules.posetracker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseTrackerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PoseTracker")

    View(PoseTrackerView::class) {
      Events("onFrame", "onPoseFrame")

      // Called by React Native only when the view instance is genuinely no
      // longer used (real unmount), NOT on transient window detach/re-attach
      // during native-stack reparenting.
      OnViewDestroys { view ->
        view.releaseCameraAndPose()
      }
    }
  }
}