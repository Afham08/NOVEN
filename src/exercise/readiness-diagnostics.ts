import type { LandmarkEventPayload } from '../../modules/pose-tracker';

import { isTrustedLandmark, isTrustedSide } from './landmark-trust';
import { angleFromTriplet } from './pose-utils';
import type { ExerciseConfig, Side } from './types';

/**
 * ============================================================================
 * TEMPORARY DEVICE DIAGNOSTIC — remove before this work is finished
 * ============================================================================
 *
 * WHY THIS EXISTS
 * The readiness misclassification this work fixes was only ever reproducible on
 * a real phone, in a real camera feed. Unit tests proved the logic but could not
 * answer the question that actually mattered on the device: which landmarks the
 * model was reporting, and what the pipeline made of them, frame by frame.
 *
 * WHAT IT PRINTS
 * One line per sampled frame, tagged `[NOVEN-READINESS]`, carrying exactly the
 * facts a bug report needs and nothing else:
 *
 *   - the exercise id and the frame timestamp;
 *   - per side: whether that side is TRUSTWORTHY, its measured joint angle, and
 *     the visibility / presence of the three landmarks that side depends on;
 *   - the thresholds in force for this exercise, so a wrong number in the log can
 *     be compared with the config instead of guessed at;
 *   - the resulting gate phase and whether readiness was granted this frame.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *  - It never dumps the full 33-landmark skeleton. Only the three landmarks per
 *    side that this exercise actually uses are reported, so the output stays
 *    readable and small.
 *  - It is rate limited. A full log is far more useful than a truncated one for
 *    this bug, but a line per frame at 30fps buries everything else in logcat and
 *    slows the device down while the very thing being measured is being
 *    perturbed. Sampling keeps the signal and drops the noise.
 *  - It is a pure observer. It computes nothing that feeds a decision, so
 *    enabling it can never change the behaviour being diagnosed.
 *
 * All of it is enabled only inside a DEV bundle, so a release build contains no
 * diagnostics and does no per-frame work at all.
 */

const TAG = '[NOVEN-READINESS]';

/** Frames between samples. At ~30fps this is roughly one line per half second. */
const SAMPLE_INTERVAL_MS = 500;

/** Per-engine sampler state. */
type Diagnostics = { lastLoggedAtMs: number };

/**
 * True only inside a React Native DEV bundle.
 *
 * `__DEV__` is a bundler-injected global, so it is read off `globalThis` and
 * compared against `true`: outside a bundle it simply is not there, which is the
 * answer the unit tests want (no logging, and no reference to a global that does
 * not exist there).
 */
export function readinessDiagnosticsEnabled(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ === true;
}

/**
 * One-line readiness trace for a frame, or null when this frame is not sampled.
 *
 * The returned line is the whole diagnostic contract; anything added here is
 * something that has to be carried on every device run, so it needs a reason.
 */
export function readinessDiagnostics(
  config: ExerciseConfig,
  landmarks: readonly LandmarkEventPayload[],
  timestampMs: number,
  state: Diagnostics,
  phase: string,
  becameReady: boolean,
): string | null {
  if (timestampMs - state.lastLoggedAtMs < SAMPLE_INTERVAL_MS) return null;
  state.lastLoggedAtMs = timestampMs;

  const { minVisibility, bentAngleDeg, extendedAngleDeg } = config.thresholds;
  const sides = config.sides.map((side) => describeSide(config, landmarks, side, minVisibility)).join(' ');

  return (
    `${TAG} ${config.id}` +
    ` t=${timestampMs}` +
    ` bent<=${bentAngleDeg} extended>=${extendedAngleDeg} minVis=${minVisibility}` +
    ` | ${sides}` +
    ` | phase=${phase} becameReady=${becameReady}`
  );
}

/** Creates the sampler state for one engine instance. */
export function createDiagnostics(): Diagnostics {
  return { lastLoggedAtMs: Number.NEGATIVE_INFINITY };
}

/**
 * Trust, geometry and landmark scores for one side.
 *
 * `trusted` is the same question the pipeline asks, `angle` the value the rep
 * detector would see, and `lm` the scores behind each landmark the side needs —
 * so a device log shows directly whether a wrong decision came from trust,
 * from geometry, or from both.
 */
function describeSide(
  config: ExerciseConfig,
  landmarks: readonly LandmarkEventPayload[],
  side: Side,
  minVisibility: number,
): string {
  const triplet = config.triplets[side];
  const required = [triplet.hip, triplet.knee, triplet.ankle];
  const trusted = isTrustedSide(landmarks, required, minVisibility);
  const angle = angleFromTriplet([...landmarks], triplet, minVisibility);
  const scores = required
    .map((name) => {
      const landmark = landmarks.find((candidate) => candidate.name === name);
      if (!landmark) return `${name}=absent`;
      const visibility = landmark.visibility;
      const presence = landmark.presence;
      if (!isTrustedLandmark(landmark, minVisibility)) {
        return `${name}=untrusted(v=${round(visibility)},p=${round(presence)})`;
      }
      return `${name}=ok(${round(visibility)},${round(presence)})`;
    })
    .join(' ');

  const angleText = Number.isFinite(angle) ? `${round(angle)}deg` : 'n/a';
  return `${side}[trusted=${trusted} angle=${angleText} ${scores}]`;
}

/** Two decimals is plenty: these are scores and degrees, not coordinates. */
function round(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : String(value);
}