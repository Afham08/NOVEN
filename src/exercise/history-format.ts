import { dayLabel, type SessionRecord } from './session-store';

/**
 * ============================================================================
 * Presentational helpers for the history list.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * The history list needs three things the store deliberately does not provide:
 * the time of day, the steadiness wording, and an honest summary of the whole
 * saved history. None of them are persistence concerns, so none of them belong
 * in `session-store.ts`; and all of them are pure functions of stored records,
 * so they live together here where they can be tested without a device.
 *
 * WHAT THEY HAVE IN COMMON
 * Everything here reads only what a finished session really stored. A value the
 * session never produced is either omitted or shown as "not enough data" —
 * never as a zero, a percentage, or a guess — for the same reason the store
 * keeps unmeasured metrics as null rather than filling them in.
 */

/**
 * The time of day a session happened, as a small clock line ("at 9:41 AM").
 *
 * WHY THIS BELONGS IN THE LIST
 * A person can do two sessions in one day, and both rows would otherwise read
 * identically: "Today, 10 exercises completed, 01:12". The day label alone was
 * enough when sessions were rare; with several a day it stops identifying the
 * row. Local time, matching `dayLabel`, because "when did I do this" is a local
 * question.
 *
 * Unparseable timestamps return null, and the row renders without the line
 * rather than under a guessed clock time.
 */
export function timeOfDayLabel(completedAt: string): string | null {
  const ms = Date.parse(completedAt);
  if (!Number.isFinite(ms)) return null;
  return `at ${new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * How steady the repetitions were, or null when the session produced no
 * steadiness to show.
 *
 * This is the stored `consistencyPct` rendered for the list, using the same
 * "Not enough data" honesty the rest of the app uses: sessions with fewer than
 * two repetitions measured no steadiness, so there is nothing to show and
 * nothing is invented for them.
 */
export function steadinessLabel(record: SessionRecord): string | null {
  if (record.consistencyPct === null) return null;
  return `Steadiness ${record.consistencyPct}%`;
}

/**
 * The saved sessions of ONE exercise, out of the mixed whole-history list.
 *
 * WHY THE LIBRARY NEEDS THIS
 * The progress list holds every kind of session together, because that is what
 * a whole-history list is for. The Exercise Library is where a person chooses
 * which movement to do, and the question there is about that movement alone:
 * "how did this go last time?". This selector answers only that question, from
 * the same store read the whole list uses, so the two can never disagree.
 *
 * A record whose activityKind names a guided activity is never returned, even
 * if a future id collision put it behind an exercise's id: a routine's session
 * belongs on the routine's screen, and an exercise list showing one would be
 * describing a session the exercise never had. This mirrors the exercise check
 * `buildHistorySummary` already applies. Order is the store's own newest-first
 * order, preserved by the filter rather than re-derived.
 */
export function sessionsForExercise(
  records: readonly SessionRecord[],
  exerciseId: string,
): SessionRecord[] {
  return records.filter(
    (record) =>
      record.exerciseId === exerciseId &&
      (record.activityKind === undefined || record.activityKind === 'exercise'),
  );
}

/** The smallest summary that can be built, when the history is empty. */
export type HistorySummary = {
  totalSessions: number;
  /** How many of the saved sessions were camera-tracked exercises. */
  exerciseSessions: number;
  /** Camera sessions grouped by exercise name, most-done first, name as tie-break. */
  exerciseCounts: readonly { name: string; count: number }[];
  /** All sessions grouped by day label, most recent day first. */
  dayCounts: readonly { day: string; count: number }[];
};

/**
 * One honest paragraph about the whole saved history.
 *
 * PURE READ-SIDE LOGIC. It sums stored records — never parses dates for a
 * window, never averages, never scores — so it cannot drift from the list
 * beside it: both are reads of the same store read.
 *
 * Only what the data genuinely says is said. "2 exercises" is a count of
 * distinct tracked movements, not a promise of variety; a day count is a day a
 * session actually happened, not a streak.
 */
export function buildHistorySummary(
  records: readonly SessionRecord[],
  nowMs: number = Date.now(),
): HistorySummary {
  const exerciseNames = new Map<string, number>();
  const days = new Map<string, number>();

  for (const record of records) {
    const isExercise = record.activityKind === undefined || record.activityKind === 'exercise';
    if (isExercise) {
      exerciseNames.set(record.exerciseName, (exerciseNames.get(record.exerciseName) ?? 0) + 1);
    }
    // The clock is injected, not called: a function that reads the wall clock
    // itself cannot be tested, and its labels could disagree with the day
    // labels on the rows the user is looking at. Same pattern as `dayLabel`.
    const day = dayLabel(record.completedAt, nowMs);
    if (day !== null) {
      days.set(day, (days.get(day) ?? 0) + 1);
    }
  }

  const exerciseCounts = [...exerciseNames.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const dayCounts = [...days.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => {
      // Only Today and Yesterday have a fixed meaning; sort them before the
      // locale-formatted dates, which then read in the order a person scans a
      // calendar backwards. Equal ranks keep insertion order, and records
      // arrive newest first, so recent days stay recent.
      const rankA = a.day === 'Today' ? 0 : a.day === 'Yesterday' ? 1 : 2;
      const rankB = b.day === 'Today' ? 0 : b.day === 'Yesterday' ? 1 : 2;
      return rankA - rankB;
    });

  return {
    totalSessions: records.length,
    exerciseSessions: [...exerciseNames.values()].reduce((sum, count) => sum + count, 0),
    exerciseCounts,
    dayCounts,
  };
}

/**
 * A day label as it appears mid-sentence.
 *
 * "Today" and "Yesterday" read naturally in lower case; a locale date such as
 * "Sep 20" is kept exactly as `dayLabel` rendered it, because a month name is
 * a proper noun and re-casing it would mangle whatever the locale produced.
 */
function dayPhrase(day: string): string {
  if (day === 'Today') return 'today';
  if (day === 'Yesterday') return 'yesterday';
  return day;
}

/**
 * The summary as one calm sentence, or null when there is nothing to say.
 *
 * Composed from the counted facts, with every clause conditional on its fact
 * existing: no clause invents a number, and a history with one session says
 * something shorter than a history with thirty. A single session of a single
 * movement is named with an article; several of one movement are said plainly
 * to be all that movement; several movements are listed by how many of each.
 */
export function describeHistorySummary(summary: HistorySummary): string | null {
  if (summary.totalSessions === 0) return null;

  const opening =
    summary.totalSessions === 1
      ? 'Your one saved session'
      : `Your ${summary.totalSessions} saved sessions`;

  const clauses: string[] = [];

  if (summary.exerciseCounts.length === 1) {
    const { name, count } = summary.exerciseCounts[0];
    clauses.push(count === 1 ? `a ${name}` : `all ${name}`);
  } else if (summary.exerciseCounts.length > 1) {
    clauses.push(summary.exerciseCounts.map((entry) => `${entry.count} ${entry.name}`).join(', '));
  }

  if (summary.dayCounts.length === 1) {
    clauses.push(`all on ${dayPhrase(summary.dayCounts[0].day)}`);
  } else if (summary.dayCounts.length > 1) {
    clauses.push(`on ${summary.dayCounts.length} different days, the most recent ${dayPhrase(summary.dayCounts[0].day)}`);
  }
  // A summary with no datable record is still worth its opening line, so the
  // missing clauses are simply left out rather than the whole sentence.

  return clauses.length === 0 ? opening : `${opening}: ${clauses.join(', ')}`;
}

/**
 * "Over 20" once a count reaches the round mark, else the plain number.
 *
 * The list shows the most recent 20 and offers more; a saved count of 21 is a
 * detail nobody benefits from at a glance, and "Over 20" stays truthful when
 * more sessions land later. Below 20, the exact number is small enough to be
 * the friendlier form.
 */
export function describeSessionCount(count: number): string {
  return count > 20 ? 'Over 20' : String(count);
}
