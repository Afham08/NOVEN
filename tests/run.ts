import { awaitAllSuites, report } from './harness';

import { run as runActivities } from './activities.test';
import { run as runActivityFlow } from './activity-flow.test';
import { run as runButtonAppearance } from './button-appearance.test';
import { run as runBreathCycle } from './breath-cycle.test';
import { run as runCoachingFeedback } from './coaching-feedback.test';
import { run as runExerciseLibrary } from './exercise-library.test';
import { run as runGuidedCompletion } from './guided-completion.test';
import { run as runHistoryFormat } from './history-format.test';
import { run as runMeditationAudio } from './meditation-audio.test';
import { run as runMetrics } from './metrics.test';
import { run as runMeditationGuidance } from './meditation-guidance.test';
import { run as runPoseStream } from './pose-stream.test';
import { run as runPoseTrackerModule } from './pose-tracker-module.test';
import { run as runPoseUtils } from './pose-utils.test';
import { run as runProgress } from './progress.test';
import { run as runProgressChart } from './progress-chart.test';
import { run as runReadinessGate } from './readiness-gate.test';
import { run as runRepDetector } from './rep-detector.test';
import { run as runRepAggregation } from './rep-aggregation.test';
import { run as runResultRouting } from './result-routing.test';
import { run as runSessionStore } from './session-store.test';
import { run as runSettingsNavigation } from './settings-navigation.test';
import { run as runThemePreference } from './theme-preference.test';
import { run as runVoiceFeedback } from './voice-feedback.test';
import { run as runYogaPoseRules } from './yoga-pose-rules.test';

async function main(): Promise<void> {
  runActivities();
  runActivityFlow();
  runBreathCycle();
  runButtonAppearance();
  runCoachingFeedback();
  runExerciseLibrary();
  runGuidedCompletion();
  runHistoryFormat();
  runMetrics();
  runMeditationGuidance();
  runMeditationAudio();
  runPoseUtils();
  runRepDetector();
  runRepAggregation();
  runReadinessGate();
  runResultRouting();
  runPoseStream();
  runPoseTrackerModule();
  runVoiceFeedback();
  runSessionStore();
  runProgress();
  runProgressChart();
  runThemePreference();
  runSettingsNavigation();
  runYogaPoseRules();

  // The persistence suites are asynchronous, so every suite has to finish before
  // the totals are printed and the exit code is decided.
  await awaitAllSuites();
  process.exit(report() === 0 ? 0 : 1);
}

void main();
