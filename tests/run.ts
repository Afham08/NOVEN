import { report } from './harness';

import { run as runMetrics } from './metrics.test';
import { run as runPoseStream } from './pose-stream.test';
import { run as runPoseUtils } from './pose-utils.test';
import { run as runReadinessGate } from './readiness-gate.test';
import { run as runRepDetector } from './rep-detector.test';
import { run as runRepAggregation } from './rep-aggregation.test';
import { run as runResultRouting } from './result-routing.test';
import { run as runVoiceFeedback } from './voice-feedback.test';

runMetrics();
runPoseUtils();
runRepDetector();
runRepAggregation();
runReadinessGate();
runResultRouting();
runPoseStream();
runVoiceFeedback();

const failures = report();
process.exit(failures === 0 ? 0 : 1);