// Re-export the native module. On web, it will be resolved to PoseTrackerModule.web.ts
// and on native platforms to PoseTrackerModule.ts
export { default } from './src/PoseTrackerModule';
export { default as PoseTrackerView } from './src/PoseTrackerView';
export * from './src/PoseTracker.types';
