import type { SessionMetrics } from './types';

/** Minimum active seconds before pace is reported as data. */
const MIN_SECONDS_FOR_PACE = 15;
/** Minimum completed reps before consistency is reported as data. */
const MIN_REPS_FOR_CONSISTENCY = 2;

/**
 * Describes how many reps, ranges (deg), and elapsed seconds were observed.
 * The rep/range accumulation lives in the session; this turns the raw counters
 * into the patient-facing metric display values, or nulls when there is not
 * enough data.
 */
export function buildSessionMetrics(input: {
  reps: number;
  durationSeconds: number;
  repRanges: number[];
  rangeMinDeg: number | null;
  rangeMaxDeg: number | null;
}): SessionMetrics {
  const { reps, durationSeconds, repRanges, rangeMinDeg, rangeMaxDeg } = input;

  let paceRpm: number | null = null;
  if (reps > 0 && durationSeconds >= MIN_SECONDS_FOR_PACE) {
    paceRpm = reps / (durationSeconds / 60);
  }

  let consistencyPct: number | null = null;
  if (repRanges.length >= MIN_REPS_FOR_CONSISTENCY) {
    const mean = repRanges.reduce((sum, r) => sum + r, 0) / repRanges.length;
    const variance =
      repRanges.reduce((sum, r) => sum + (r - mean) ** 2, 0) / repRanges.length;
    const stddev = Math.sqrt(variance);
    const spreadRatio = mean > 0 ? stddev / mean : 1;
    consistencyPct = Math.max(0, Math.min(100, Math.round((1 - spreadRatio) * 100)));
  }

  return {
    reps,
    durationSeconds,
    paceRpm,
    rangeMinDeg,
    rangeMaxDeg,
    consistencyPct,
  };
}

/** "MM:SS" from a total number of seconds. */
export function formatDurationLabel(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/** "4.5" for pace, or "--" when the value is missing. */
export function formatPaceLabel(paceRpm: number | null): string {
  if (paceRpm === null) return '--';
  return paceRpm.toFixed(1);
}

/** "35° – 168°" or "--" when no angle range was observed. */
export function formatRangeLabel(
  rangeMinDeg: number | null,
  rangeMaxDeg: number | null,
): string {
  if (rangeMinDeg === null || rangeMaxDeg === null) return '--';
  return `${Math.round(rangeMinDeg)}° – ${Math.round(rangeMaxDeg)}°`;
}

/** "86%" or "Not enough data". */
export function formatConsistencyLabel(consistencyPct: number | null): string {
  if (consistencyPct === null) return 'Not enough data';
  return `${consistencyPct}%`;
}