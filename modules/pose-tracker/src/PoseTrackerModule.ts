import { NativeModule, requireNativeModule } from 'expo';

declare class PoseTrackerModule extends NativeModule<{}> {}

export default requireNativeModule<PoseTrackerModule>('PoseTracker');
