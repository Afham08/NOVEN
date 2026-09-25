import { registerWebModule, NativeModule } from 'expo';

// PoseTrackerModule is not available on the web platform.
class PoseTrackerModule extends NativeModule<{}> {}

export default registerWebModule(PoseTrackerModule, 'PoseTrackerModule');
