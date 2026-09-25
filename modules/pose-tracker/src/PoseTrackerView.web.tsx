import { PoseTrackerViewProps } from './PoseTracker.types';

// PoseTrackerView is not available on the web platform.
export default function PoseTrackerView(_props: PoseTrackerViewProps) {
  throw new Error('PoseTrackerView is not available on the web platform.');
}
