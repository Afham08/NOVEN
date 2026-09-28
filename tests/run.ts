import { awaitAllSuites, report } from './harness';

import { run as runMetrics } from './metrics.test';
import { run as runPoseStream } from './pose-stream.test';
import { run as runPoseUtils } from './pose-utils.test';
import { run as runProgress } from './progress.test';
import { run as runProgressChart } from './progress-chart.test';
import { run as runReadinessGate } from './readiness-gate.test';
import { run as runRepDetector } from './rep-detector.test';
import { run as runRepAggregation } from './rep-aggregation.test';
import { run as runResultRouting } from './result-routing.test';
import { run as runSessionStore } from './session-store.test';
import { run as runSettingsNavigation } from './settings-navigation.test';
import { run as runVoiceFeedback } from './voice-feedback.test';

async function main(): Promise<void> {
  runMetrics();
  runPoseUtils();
  runRepDetector();
  runRepAggregation();
  runReadinessGate();
  runResultRouting();
  runPoseStream();
  runVoiceFeedback();
  runSessionStore();
  runProgress();
  runProgressChart();
  runSettingsNavigation();

  // The persistence suites are asynchronous, so every suite has to finish before
  // the totals are printed and the exit code is decided.
  await awaitAllSuites();
  process.exit(report() === 0 ? 0 : 1);
}

void main();
