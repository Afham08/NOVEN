import type { SessionMetrics } from './types';

/**
 * NOVEN's 30-day progress layer.
 *
 * WHAT THE PROGRESS SCORE IS
 * --------------------------
 * The progress score is the app's existing `consistencyPct` and nothing else.
 *
 * That number is already produced by `buildSessionMetrics()`: it is
 * `round((1 - stddev/mean) * 100)` over the ranges of the session's completed
 * repetitions, clamped to 0..100, where 100 means every repetition travelled
 * the same distance. In plain words it measures how STEADY the movement was.
 *
 * Why it is used unchanged, rather than combined with other metrics:
 *
 *   - It already has a defined 0..100 scale, so using it introduces no new
 *     constant, no new threshold, and no new normalisation to justify.
 *   - Every alternative needed a number the codebase does not contain. Range is
 *     only stored as min/max degrees, so scoring "how far" would have required
 *     inventing a target angle; inventing that is exactly the failure mode
 *     this project already removed once (see the note in session-store.ts about
 *     the deleted mock that stored a fabricated 0-100 score).
 *   - Pace is deliberately NOT part of the score. NOVEN's own exercise data
 *     tells the user to repeat "at a calm, steady pace", so a higher
 *     reps-per-minute is not better, and rewarding it would contradict the
 *     instructions the app itself gives.
 *   - Reps and duration are deliberately NOT part of the score either, so a
 *     longer session can never score higher than a shorter one doing the same
 *     movement well.
 *
 * It is a movement-steadiness indicator derived inside the app. It is not a
 * clinical, medical, diagnostic, or fitness assessment, and it must never be
 * described as one.
 *
 * A session with no `consistencyPct` - fewer than two completed repetitions -
 * has NO progress score. Those sessions are counted but never plotted, because
 * inventing a number for them (especially a zero) would misrepresent them.
 */

/** Calendar days the progress view covers, including today. */
export const PROGRESS_WINDOW_DAYS = 30;

/** Lowest and highest value a progress score can take, inherited from `consistencyPct`. */
export const PROGRESS_MIN = 0;
export const PROGRESS_MAX = 100;

/** Local midnight for the calendar day containing `value`. */
export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

/**
 * Local calendar day as `YYYY-MM-DD`.
 *
 * Local, not UTC: a session completed at 9am was completed that morning where
 * the user was standing. `completedAt` is stored as an ISO instant, so the UTC
 * date can name a different day than the one the session actually happened on.
 */
export function localDayKey(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * First instant inside the progress window: local midnight, 29 days before the
 * day `now` falls on, so today is the thirtieth day.
 *
 * Built with the Date constructor's day arithmetic rather than by subtracting
 * 29 * 86_400_000 ms, which lands on the wrong day across a daylight-saving
 * boundary.
 */
export function progressWindowStart(now: Date): Date {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (PROGRESS_WINDOW_DAYS - 1),
    0,
    0,
    0,
    0,
  );
}

/**
 * The progress score for one session, or null when it cannot be measured.
 *
 * A pure function of a single session, so the same session always produces the
 * same score regardless of what else is stored. Returns null - never a zero -
 * when the session has too few completed repetitions to measure steadiness.
 */
export function progressScoreFor(
  metrics: Pick<SessionMetrics, 'consistencyPct'>,
): number | null {
  const value = metrics.consistencyPct;
  if (value === null || typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < PROGRESS_MIN || value > PROGRESS_MAX) return null;
  return Math.round(value);
}

/** One plotted session. */
export type ProgressPoint = {
  id: string;
  /** ISO timestamp exactly as stored. */
  completedAt: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  dayKey: string;
  score: number;
};

export type ProgressSummary = {
  /** Scoreable sessions, oldest first. Empty when nothing can be scored. */
  points: ProgressPoint[];
  /** Every session inside the window, including ones with no score. */
  sessionsInWindow: number;
  /** Sessions inside the window that produced a score. */
  scoredInWindow: number;
  /** Most recent scoreable session. */
  latest: ProgressPoint | null;
  /** Mean of the plotted scores, rounded. Null when nothing is plotted. */
  average: number | null;
  highest: number | null;
  lowest: number | null;
  /** Local day key the window opens on. */
  windowStartDayKey: string;
  windowDays: number;
};

export type ProgressInput = Pick<
  SessionMetrics,
  'consistencyPct'
> & {
  id: string;
  completedAt: string;
};

/**
 * Turns stored session history into the series the chart draws.
 *
 * Only ever READS. Nothing here writes, prunes, or rewrites history, so a
 * session older than the window stays in storage and comes back into view if
 * the user ever widens the range. `parseSessionHistory` has already discarded
 * malformed records, but the date is re-checked here because an unparseable
 * `completedAt` cannot be placed on a time axis and must not reach the chart.
 *
 * Sessions are returned oldest first, because a time axis runs left to right.
 * Ties on the exact timestamp are broken by id so the output is fully
 * deterministic.
 */
export function buildProgress(
  records: readonly ProgressInput[],
  now: Date = new Date(),
): ProgressSummary {
  const windowStart = progressWindowStart(now);
  const windowStartMs = windowStart.getTime();

  const inWindow = records
    .filter((record) => {
      // The type is checked before parsing because Date.parse coerces its
      // argument: given a number it happily parses the digits as a year and
      // returns a real timestamp, which would plot a nonsense date instead of
      // dropping the record. `parseSessionHistory` already guarantees a string,
      // but this function is public and must hold on its own.
      if (typeof record.completedAt !== 'string' || record.completedAt.length === 0) return false;
      const completedMs = Date.parse(record.completedAt);
      // A NaN date fails this comparison, which is how unparseable timestamps
      // are dropped without a separate branch.
      return Number.isFinite(completedMs) && completedMs >= windowStartMs;
    })
    .sort((a, b) => {
      const delta = Date.parse(a.completedAt) - Date.parse(b.completedAt);
      if (delta !== 0) return delta;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const points: ProgressPoint[] = [];
  for (const record of inWindow) {
    const score = progressScoreFor(record);
    if (score === null) continue;
    points.push({
      id: record.id,
      completedAt: record.completedAt,
      dayKey: localDayKey(new Date(record.completedAt)),
      score,
    });
  }

  const scores = points.map((point) => point.score);
  const sum = scores.reduce((total, score) => total + score, 0);

  return {
    points,
    sessionsInWindow: inWindow.length,
    scoredInWindow: points.length,
    latest: points.length > 0 ? points[points.length - 1] : null,
    average: scores.length > 0 ? Math.round(sum / scores.length) : null,
    highest: scores.length > 0 ? Math.max(...scores) : null,
    lowest: scores.length > 0 ? Math.min(...scores) : null,
    windowStartDayKey: localDayKey(windowStart),
    windowDays: PROGRESS_WINDOW_DAYS,
  };
}

/**
 * The one-line explanation shown under the score card.
 *
 * Kept next to `buildProgress` so the wording can only ever describe a state the
 * summary can actually be in, and so it can be checked in tests. The score card's
 * bar is the same number as the chart's last dot.
 */
export function progressHint(
  summary: ProgressSummary | null,
  totalSessions: number | null,
): string {
  if (summary === null) return 'Reading your saved sessions.';
  if (totalSessions === 0 || summary.sessionsInWindow === 0) {
    return 'No sessions in the last 30 days yet.';
  }
  if (summary.scoredInWindow === 0) {
    return 'Sessions this month were too short to measure.';
  }
  const latest = summary.latest;
  if (latest === null) return 'Your steadiness over the last 30 days.';
  return `Steadiness of your latest session, out of ${PROGRESS_MAX}.`;
}
