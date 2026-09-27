/**
 * ============================================================================
 * TEMPORARY DIAGNOSTIC LOGGING — REMOVE AFTER THE PHYSICAL-DEVICE RETEST.
 * ============================================================================
 *
 * Added to answer one question the unit tests cannot: on the real device, which
 * detector produced the spurious rep, and what did the pipeline actually see?
 * The synthetic reproduction proves the mechanism in `RepDetector`, but the
 * device session is the only place the real angle stream, the real readiness
 * phase and the real per-side phase transitions can be observed.
 *
 * WHAT IT PRINTS (state CHANGES only, not every frame)
 *   - presence changes (tracked / lost)
 *   - readiness gate phase changes, with the hip-anchor offset that caused it
 *   - per-side detector phase and arming changes
 *   - every detector-level completion, and whether the SESSION counted it
 *   - the per-frame knee angle whenever the phase or arming state changed
 *
 * WHAT IT DELIBERATELY DOES NOT PRINT
 *   - a line per frame. At ~10Hz a full dump is thousands of lines and the
 *     interesting transitions get lost in it.
 *
 * It is dev-only (`__DEV__`) so it can never ship in a release build.
 * To collect a trace: run a development build, reproduce the false rep, then
 * `adb logcat -s NOVENDIAG` (or read the Metro console) and paste the output.
 * Delete this file and its two call sites once the retest is done.
 */

import type { RepPhase } from './types';

/** One side's observable detector state, as of a single frame. */
export type SideDiagnostic = {
  angle: number | null;
  phase: RepPhase;
  armed: boolean;
  /** Range (deg) the side has seen since its current cycle began. */
  cycleMin: number | null;
  cycleMax: number | null;
  /** True on the frame THIS side completed a cycle (before session cooldown). */
  completed: boolean;
  completedRange: number | null;
};

export type FrameDiagnostic = {
  timestampMs: number;
  presence: string;
  gatePhase: string;
  /** Hip-anchor offset that drops readiness, when the gate is not ready. */
  anchorOffset: number | null;
  left: SideDiagnostic;
  right: SideDiagnostic;
  sessionReps: number;
};

/** What the last printed frame looked like, so only changes are logged. */
type Signature = string;

/**
 * TEMPORARY DIAGNOSTIC. React Native defines `__DEV__` globally, but the plain
 * node test harness does not — so it is read through `typeof` and a missing
 * global is treated as "not a dev build", which keeps the diagnostics silent
 * under `npm test` instead of throwing.
 */
export function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

const noSide: SideDiagnostic = {
  angle: null,
  phase: 'rest',
  armed: false,
  cycleMin: null,
  cycleMax: null,
  completed: false,
  completedRange: null,
};

let lastSignature: Signature | null = null;

function sideSignature(side: SideDiagnostic): Signature {
  // angle is deliberately excluded: it moves every frame. The phase, the
  // arming flag and the observed cycle bounds are what actually change the
  // detector's behaviour, and the angle is printed alongside them anyway.
  return [
    side.phase,
    side.armed ? 'armed' : 'unarmed',
    side.cycleMin === null ? '-' : side.cycleMin.toFixed(0),
    side.cycleMax === null ? '-' : side.cycleMax.toFixed(0),
  ].join('/');
}

function frameSignature(d: FrameDiagnostic): Signature {
  return [
    d.presence,
    d.gatePhase,
    sideSignature(d.left),
    sideSignature(d.right),
    d.left.completed ? 'L+DONE' : '',
    d.right.completed ? 'R+DONE' : '',
  ].join('|');
}

function sideLine(label: string, side: SideDiagnostic): string {
  const angle = side.angle === null ? 'n/a' : `${side.angle.toFixed(1)}deg`;
  const cycle =
    side.cycleMin === null && side.cycleMax === null
      ? 'cycle n/a'
      : `cycle ${side.cycleMin?.toFixed(1)}..${side.cycleMax?.toFixed(1)}`;
  let line = `${label}=${angle} ${cycle} ${side.phase} ${side.armed ? 'ARMED' : 'unarmed'}`;
  if (side.completed) line += ` >>> DETECTOR COMPLETED rep range=${side.completedRange?.toFixed(1)}deg`;
  return line;
}

/**
 * Prints `diagnostic` if anything material changed since the previous frame.
 * Safe to call unconditionally: it is a no-op in release builds and a no-op when
 * nothing changed.
 */
export function logFrameDiagnostic(d: FrameDiagnostic): void {
  if (!isDevBuild()) return;

  const signature = frameSignature(d);
  if (signature === lastSignature) return;
  lastSignature = signature;

  const offset = d.anchorOffset === null ? '' : ` anchorOffset=${d.anchorOffset.toFixed(3)}`;
  console.log(
    `[NOVENDIAG] t=${d.timestampMs} presence=${d.presence} gate=${d.gatePhase}${offset} ` +
      `| ${sideLine('L', d.left)} | ${sideLine('R', d.right)} | sessionReps=${d.sessionReps}`,
  );
}

/** A placeholder side state for frames where that side was never measured. */
export function emptySideDiagnostic(): SideDiagnostic {
  return { ...noSide };
}

/** Clears the change-tracking state. Call on Start/resume/reset so a new session
 * always prints its first frame instead of being suppressed as "unchanged". */
export function resetFrameDiagnostics(): void {
  lastSignature = null;
}
