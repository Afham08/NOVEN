import { almostEqual, check, suite } from './harness';

import {
  buildHistorySummary,
  describeHistorySummary,
  describeSessionCount,
  sessionsForExercise,
  steadinessLabel,
  timeOfDayLabel,
} from '../src/exercise/history-format';
import type { SessionRecord } from '../src/exercise/session-store';

/**
 * A fixed clock for the day-label assertions, mirroring the fake clock the
 * session-store tests use: `dayLabel` reads local time, so the timestamps are
 * built with local `new Date(y, m, d, h)` constructors rather than UTC ones,
 * which keeps the Today/Yesterday boundary exact on any machine.
 */
const NOW = new Date(2026, 8, 27, 12, 0, 0).getTime(); // 27 Sep 2026, noon, local.

function record(overrides: Partial<SessionRecord> & { id: string }): SessionRecord {
  return {
    exerciseId: 'seated-knee-extension',
    exerciseName: 'Seated Knee Extension',
    completedAt: new Date(NOW - 60 * 60 * 1000).toISOString(), // one hour ago: today.
    reps: 10,
    durationSeconds: 56,
    paceRpm: 10.7,
    rangeMinDeg: 35,
    rangeMaxDeg: 168,
    consistencyPct: 86,
    ...overrides,
  };
}

export function run(): void {
  suite('history format: the time line tells same-day rows apart', () => {
    const stamp = new Date(2026, 8, 27, 9, 41, 0).toISOString();
    const label = timeOfDayLabel(stamp);

    check('a parseable timestamp produces a line', label !== null, label);
    check('it reads as a clock time', label !== null && /at \d{1,2}:\d{2}/.test(label), label);
    check('it says the stored hour', label !== null && label.includes('9'), label);

    check('an unparseable timestamp produces no line', timeOfDayLabel('not a date') === null);
    check('an empty timestamp produces no line', timeOfDayLabel('') === null);
  });

  suite('history format: steadiness is shown only when it was measured', () => {
    check(
      'a measured session says its steadiness',
      steadinessLabel(record({ id: 'a', consistencyPct: 86 })) === 'Steadiness 86%',
      steadinessLabel(record({ id: 'a', consistencyPct: 86 })),
    );
    check('zero steadiness is a real zero, not hidden', steadinessLabel(record({ id: 'b', consistencyPct: 0 })) === 'Steadiness 0%');
    check('an unmeasured session shows none', steadinessLabel(record({ id: 'c', consistencyPct: null })) === null);
  });

  suite('history format: the summary counts only what is stored', () => {
    const summary = buildHistorySummary([
      record({ id: 'a', exerciseName: 'Seated Knee Extension' }),
      record({ id: 'b', exerciseName: 'Seated Knee Extension' }),
      record({ id: 'c', exerciseName: 'Sit-to-Stand', exerciseId: 'sit-to-stand' }),
      record({ id: 'd', exerciseName: 'Morning Routine', activityKind: 'yoga' as const }),
      record({ id: 'e', exerciseName: 'Two Minutes of Calm', activityKind: 'meditation' as const }),
    ], NOW);

    check('every stored session is counted', summary.totalSessions === 5, summary.totalSessions);
    check('only camera sessions count as exercises', summary.exerciseSessions === 3, summary.exerciseSessions);
    check('each exercise is counted separately', summary.exerciseCounts.length === 2, summary.exerciseCounts.length);
    check(
      'the most-done exercise leads',
      summary.exerciseCounts[0]?.name === 'Seated Knee Extension' && summary.exerciseCounts[0]?.count === 2,
      summary.exerciseCounts,
    );
    check('days are counted from real timestamps', summary.dayCounts.length === 1, summary.dayCounts.length);
    check('that day is today', summary.dayCounts[0]?.day === 'Today', summary.dayCounts[0]?.day);
  });

  suite('history format: the summary is built, never typed', () => {
    const described = describeHistorySummary(
      buildHistorySummary([
        record({ id: 'a', exerciseName: 'Seated Knee Extension' }),
        record({ id: 'b', exerciseName: 'Seated Knee Extension' }),
        record({ id: 'c', exerciseName: 'Sit-to-Stand', exerciseId: 'sit-to-stand' }),
        record({ id: 'd', exerciseName: 'Morning Routine', activityKind: 'yoga' as const }),
      ], NOW),
    );

    check('it opens by saying how many', described !== null && described.includes('4 saved sessions'), described);
    check('it lists each exercise with its count', described !== null && described.includes('2 Seated Knee Extension') && described.includes('1 Sit-to-Stand'), described);
    check('it does not count guided routines as exercises', described !== null && !described.includes('Morning Routine'), described);
    // All four fixtures sit on the same local day, so the day clause is the
    // single-day form; the multi-day form is covered in the sorting suite.
    check('it says which day', described !== null && described.includes('all on today'), described);

    const single = describeHistorySummary(
      buildHistorySummary([record({ id: 'a', exerciseName: 'Sit-to-Stand', exerciseId: 'sit-to-stand' })], NOW),
    );
    check('a single session is named with an article', single === 'Your one saved session: a Sit-to-Stand, all on today', single);
    check(
      'an empty history says nothing',
      describeHistorySummary(buildHistorySummary([])) === null,
    );
  });

  suite('history format: counts read the way a person would say them', () => {
    check('a small count is shown exactly', describeSessionCount(7) === '7');
    check('twenty is shown exactly', describeSessionCount(20) === '20');
    check('a count past twenty reads as over twenty', describeSessionCount(21) === 'Over 20');
    check('a much larger count still reads the same way', describeSessionCount(200) === 'Over 20');
  });

  suite('history format: days sort with the recent ones first', () => {
    const summary = buildHistorySummary([
      record({ id: 'a', completedAt: new Date(2026, 7, 1, 10, 0, 0).toISOString() }),
      record({ id: 'b', completedAt: new Date(2026, 8, 27, 9, 0, 0).toISOString() }),
      record({ id: 'c', completedAt: new Date(2026, 8, 26, 9, 0, 0).toISOString() }),
    ], NOW);

    check('today sorts first', summary.dayCounts[0]?.day === 'Today', summary.dayCounts.map((d) => d.day));
    check('yesterday sorts second', summary.dayCounts[1]?.day === 'Yesterday', summary.dayCounts.map((d) => d.day));
    check('older locale dates follow', summary.dayCounts.length === 3, summary.dayCounts.length);
    check('the day counts are the real counts', summary.dayCounts.every((d) => d.count === 1), summary.dayCounts);

    const described = describeHistorySummary(summary);
    check(
      'a multi-day history says how many days and which was last',
      described !== null && described.includes('3 different days') && described.includes('the most recent today'),
      described,
    );
  });

  suite('history format: an empty history is a real zero, not a crash', () => {
    const summary = buildHistorySummary([], NOW);

    check('no sessions', summary.totalSessions === 0);
    check('no exercises', summary.exerciseSessions === 0);
    check('no exercise groups', summary.exerciseCounts.length === 0);
    check('no days', summary.dayCounts.length === 0);
    check('and no sentence', describeHistorySummary(summary) === null);
  });

  suite('history format: the helpers stay pure on the stored shape', () => {
    // A record missing the guided fields entirely is the shape every
    // pre-guided-history install still has on disk. The helpers must read it
    // exactly as they read a fresh one.
    const legacy: SessionRecord = {
      id: 'legacy',
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      completedAt: new Date(NOW).toISOString(),
      reps: 14,
      durationSeconds: 56,
      paceRpm: null,
      rangeMinDeg: null,
      rangeMaxDeg: null,
      consistencyPct: 92,
    };

    const summary = buildHistorySummary([legacy], NOW);
    check('a legacy record is counted as an exercise', summary.exerciseSessions === 1, summary.exerciseSessions);
    check('and by its real name', summary.exerciseCounts[0]?.name === 'Seated Knee Extension', summary.exerciseCounts);
    check('its unmeasured pace costs nothing', steadinessLabel(legacy) === 'Steadiness 92%');
    almostEqual(summary.totalSessions, 1);
  });

  suite('history format: one exercise can be read out of the mixed history', () => {
    /*
     * The progress list holds every kind of session together; the Exercise
     * Library's detail screen asks the other question — how THIS movement went.
     * The selector must answer only that question: the right exercise, guided
     * routines excluded even on an id collision, and the shared history left
     * untouched so the whole list beside it is unaffected.
     */
    const history = [
      record({ id: 'a', exerciseId: 'seated-knee-extension' }),
      record({ id: 'b', exerciseId: 'sit-to-stand' }),
      record({ id: 'c', exerciseId: 'seated-knee-extension' }),
      record({ id: 'd', exerciseId: 'seated-knee-extension', activityKind: 'exercise' as const }),
      record({ id: 'e', exerciseId: 'chair-yoga-flow', activityKind: 'yoga' as const }),
    ];

    const knee = sessionsForExercise(history, 'seated-knee-extension');
    check('only the chosen exercise is returned', knee.length === 3, knee.map((r) => r.id).join(','));
    check(
      'every returned row really is that exercise',
      knee.every((r) => r.exerciseId === 'seated-knee-extension'),
    );
    check(
      'the store order is preserved, newest first',
      knee.map((r) => r.id).join(',') === 'a,c,d',
      knee.map((r) => r.id).join(','),
    );
    check(
      'a record that names its kind as an exercise still counts',
      knee.some((r) => r.id === 'd'),
    );
    check(
      'an exercise with no sessions gets an empty list',
      sessionsForExercise(history, 'seated-arm-raise').length === 0,
    );
    check(
      'a guided routine is never read out as an exercise session',
      sessionsForExercise(history, 'chair-yoga-flow').length === 0,
    );
    check('the mixed history itself is untouched', history.length === 5, history.length);
  });
}
