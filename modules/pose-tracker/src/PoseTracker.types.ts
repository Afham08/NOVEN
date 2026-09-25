import type { StyleProp, ViewStyle } from 'react-native';

export type CameraFrameEventPayload = {
  frameIndex: number;
  timestampNs: number;
  elapsedRealtimeMs: number;
  width: number;
  height: number;
};

/**
 * Stable NOVEN names for the 33 MediaPipe Pose landmarks, in MediaPipe index
 * order. This mirrors the authoritative native mapping in
 * `modules/pose-tracker/android/.../PoseLandmarks.kt` — do not re-order.
 */
export const POSE_LANDMARK_NAMES = [
  'NOSE',
  'LEFT_EYE_INNER',
  'LEFT_EYE',
  'LEFT_EYE_OUTER',
  'RIGHT_EYE_INNER',
  'RIGHT_EYE',
  'RIGHT_EYE_OUTER',
  'LEFT_EAR',
  'RIGHT_EAR',
  'MOUTH_LEFT',
  'MOUTH_RIGHT',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_ELBOW',
  'RIGHT_ELBOW',
  'LEFT_WRIST',
  'RIGHT_WRIST',
  'LEFT_PINKY',
  'RIGHT_PINKY',
  'LEFT_INDEX',
  'RIGHT_INDEX',
  'LEFT_THUMB',
  'RIGHT_THUMB',
  'LEFT_HIP',
  'RIGHT_HIP',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_ANKLE',
  'LEFT_HEEL',
  'RIGHT_HEEL',
  'LEFT_FOOT_INDEX',
  'RIGHT_FOOT_INDEX',
] as const;

export type PoseLandmarkName = (typeof POSE_LANDMARK_NAMES)[number];

export type PosePresence = 'not-tracked' | 'tracked' | 'lost';

export type LandmarkEventPayload = {
  name: PoseLandmarkName;
  x: number;
  y: number;
  z: number;
  visibility: number;
};

export type PoseFrameEventPayload = {
  /** Monotonic timestamp in milliseconds (MediaPipe LIVE_STREAM timeline). */
  timestampMs: number;
  /** Width of the analyzed image in pixels (landmarks are normalized). */
  imageWidth: number;
  /** Height of the analyzed image in pixels (landmarks are normalized). */
  imageHeight: number;
  presence: PosePresence;
  landmarks: LandmarkEventPayload[];
};

export type PoseTrackerViewProps = {
  onFrame: (event: { nativeEvent: CameraFrameEventPayload }) => void;
  /** Emitted at up to ~10/s while the camera and pose model are active. */
  onPoseFrame?: (event: { nativeEvent: PoseFrameEventPayload }) => void;
  style?: StyleProp<ViewStyle>;
};