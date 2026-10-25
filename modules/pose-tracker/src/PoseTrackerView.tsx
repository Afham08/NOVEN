import { requireNativeView } from 'expo';
import * as React from 'react';

import { PoseTrackerViewProps } from './PoseTracker.types';

let NativeView: React.ComponentType<PoseTrackerViewProps> | null = null;
try {
  NativeView = requireNativeView('PoseTracker');
} catch (error) {
  console.error('[PoseTrackerView] requireNativeView("PoseTracker") failed', error);
}

export default function PoseTrackerView({ onFrame, onPoseFrame, onError, ...rest }: PoseTrackerViewProps) {
  if (!NativeView) {
    return null;
  }
  return <NativeView {...rest} onFrame={onFrame} onPoseFrame={onPoseFrame} onError={onError} />;
}
