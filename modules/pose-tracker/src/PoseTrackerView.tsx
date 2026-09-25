import { requireNativeView } from 'expo';
import * as React from 'react';

import { PoseTrackerViewProps } from './PoseTracker.types';

// TEMPORARY DIAGNOSTIC INSTRUMENTATION — remove after debugging.
console.log('[PoseTrackerView] file loaded');

let NativeView: React.ComponentType<PoseTrackerViewProps> | null = null;
try {
  NativeView = requireNativeView('PoseTracker');
  console.log('[PoseTrackerView] requireNativeView("PoseTracker") resolved', NativeView ? 'OK' : 'null');
} catch (error) {
  console.error('[PoseTrackerView] requireNativeView("PoseTracker") THREW', error);
}

export default function PoseTrackerView({ onFrame, onPoseFrame, ...rest }: PoseTrackerViewProps) {
  console.log('[PoseTrackerView] render, has onFrame=', typeof onFrame, 'has onPoseFrame=', typeof onPoseFrame);
  if (!NativeView) {
    return null;
  }
  return <NativeView {...rest} onFrame={onFrame} onPoseFrame={onPoseFrame} />;
}