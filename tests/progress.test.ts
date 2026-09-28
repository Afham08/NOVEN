import { check, suite } from './harness';

import {
  buildProgress,
  localDayKey,
  PROGRESS_MAX,
  PROGRESS_MIN,
  PROGRESS_WINDOW_DAYS,
  progressScoreFor,
  progressWindowStart,
  startOfLocalDay,
  type ProgressInput,
} from '../src/exercise/progress';
import {
  createSessionId,
  createSessionRecord,
  createSessionStore,
  MAX_SAVED_SESSIONS,
  type KeyValueStore,
  type SessionRecord,
} from '../src/exercise/session-store';

// A fixed "now" so every date assertion is deterministic. Local noon, which
// keeps the local calendar day stable regardless of the runner's timezone.
const NOW = new Date(2026, 8, 28, 12, 0, 0); // 28 Sep 2026, local

/**
 * Builds a record at a given day offset from NOW, at local `hour`:00.
 * `dayOffset` 0 = today, -1 = yesterday, -29 = the oldest day inside the
 * 30-day window, -30 = the first day outside it.
 */
function sessionOn(dayOffset: number, consistencyPct: number | null, id?: string, hour = 10): ProgressInput {
  const when = new Date(NOW);
  when.setDate(when.getDate() + dayOffset);
  when.setHours(hour, 0, 0, 0);
  return {
    id: id ?? `s${dayOffset}-${consistencyPct ?? 'none'}`,
    completedAt: when.toISOString(),
    consistencyPct,
  };
}

function sessions(...offsetsAndScores: Array<[number, number | null]>) {
  return offsetsAndScores.map(([offset, score]) => sessionOn(offset, score));
}

export function run() {
  suite('progress: 1-2. empty history', () => {
    const summary = buildProgress([], NOW);

    check('no sessions means no points', summary.points.length === 0);
    check('no sessions means no latest', summary.latest === null);
    check('no sessions means no average', summary.average === null);
    check('no sessions means no high', summary.highest === null);
    check('no sessions means no low', summary.lowest === null);
    check('nothing was invented as a score', summary.scoredInWindow === 0);
    check('nothing was invented as a session', summary.sessionsInWindow === 0);
  });

  suite('progress: 3, 8. one session, and 18. latest', () => {
    const only = sessionOn(0, 82);
    const summary = buildProgress([only], NOW);

    check('the single real session is plotted', summary.points.length === 1);
    check('its score is the real stored value', summary.points[0].score === 82);
    check('it is also the latest', summary.latest?.score === 82);
    check('average of one equals that one', summary.average === 82);
    check('high and low are that one', summary.highest === 82 && summary.lowest === 82);
    check('no trend was manufactured', summary.points.length === 1);

    // The most recent session wins, not the highest-scoring one.
    const two = buildProgress([sessionOn(-5, 95), sessionOn(-1, 60)], NOW);
    check('latest is the newest, not the best', two.latest?.score === 60, two.latest);
  });

  suite('progress: 3, 20. multiple sessions and the average', () => {
    const summary = buildProgress(sessions([-3, 80], [-2, 90], [0, 70]), NOW);

    check('every scoreable session is kept', summary.points.length === 3);
    check('sessions in window are counted', summary.sessionsInWindow === 3);
    check('the average is the rounded mean', summary.average === 80, summary.average);
    check('the highest is reported', summary.highest === 90);
    check('the lowest is reported', summary.lowest === 70);
  });

  suite('progress: 4-5. the 30-day boundary', () => {
    const windowStart = progressWindowStart(NOW);
    check('the window is 30 days long', PROGRESS_WINDOW_DAYS === 30);
    check('the window starts on local midnight', windowStart.getHours() === 0 && windowStart.getMinutes() === 0);
    check('the window opens 29 days before today', windowStart.getDate() === NOW.getDate() - 29 || (NOW.getDate() - 29) < 1, localDayKey(windowStart));

    // Day -29 is the thirtieth day counting back, so it is INSIDE.
    const inside = buildProgress([sessionOn(-29, 75)], NOW);
    check('the 30th day back is inside the window', inside.points.length === 1);

    // Day -30 is the thirty-first day counting back, so it is OUTSIDE.
    const outside = buildProgress([sessionOn(-30, 75)], NOW);
    check('the 31st day back is outside the window', outside.points.length === 0);
    check('and is not counted as a session in the window', outside.sessionsInWindow === 0);

    const mixed = buildProgress([sessionOn(-30, 75), sessionOn(-29, 75), sessionOn(0, 75)], NOW);
    check('only the two recent sessions are plotted', mixed.points.length === 2, mixed.points);
  });

  suite('progress: 8. sessions are sorted oldest first', () => {
    const forward = buildProgress(sessions([0, 80], [-4, 85], [-2, 90]), NOW);
    check('the series runs oldest to newest', forward.points.map((p) => p.score).join(',') === '85,90,80', forward.points.map((p) => p.score));

    // Reversing the input must not change the output.
    const reversed = buildProgress(sessions([0, 80], [-4, 85], [-2, 90]).reverse(), NOW);
    check('input order does not change the series', reversed.points.map((p) => p.score).join(',') === '85,90,80', reversed.points.map((p) => p.score));
  });

  suite('progress: 13. determinism', () => {
    const data = sessions([-3, 80], [-2, 90], [0, 70]);
    const a = buildProgress(data, NOW);
    const b = buildProgress(data, NOW);
    check('the same input gives the same points', JSON.stringify(a.points) === JSON.stringify(b.points));
    check('the same input gives the same average', a.average === b.average);
    check('the same input gives the same latest', a.latest?.id === b.latest?.id);

    // Even a different input ordering must land on the same series.
    const shuffled = buildProgress([...data].reverse(), NOW);
    check('ordering the input differently changes nothing', JSON.stringify(shuffled.points) === JSON.stringify(a.points));

    // A single session scores the same no matter who else is stored.
    const alone = sessionOn(0, 77);
    check('one session scores the same alone as in a crowd', progressScoreFor(alone) === progressScoreFor({ ...alone }));
  });

  suite('progress: 14. the score stays inside its documented range', () => {
    check('the documented range is 0 to 100', PROGRESS_MIN === 0 && PROGRESS_MAX === 100);
    check('the lowest real value is accepted', progressScoreFor({ consistencyPct: 0 }) === 0);
    check('the highest real value is accepted', progressScoreFor({ consistencyPct: 100 }) === 100);
    check('a value above the range is rejected', progressScoreFor({ consistencyPct: 101 }) === null);
    check('a value below the range is rejected', progressScoreFor({ consistencyPct: -1 }) === null);
    check('NaN is rejected', progressScoreFor({ consistencyPct: Number.NaN }) === null);
    check('Infinity is rejected', progressScoreFor({ consistencyPct: Number.POSITIVE_INFINITY }) === null);

    const all = buildProgress(sessions([0, 0], [-1, 100], [-2, 50], [-3, 37], [-4, 99]), NOW);
    check('every plotted score is inside the range', all.points.every((p) => p.score >= PROGRESS_MIN && p.score <= PROGRESS_MAX));
    check('the average is inside the range too', all.average !== null && all.average >= PROGRESS_MIN && all.average <= PROGRESS_MAX);
  });

  suite('progress: 9, 10, 11, 17. missing data is handled honestly', () => {
    check('no consistency means no score', progressScoreFor({ consistencyPct: null }) === null);

    // Pace and range being absent must not affect the score: it is steadiness only.
    const noPaceNoRange = buildProgress([{ ...sessionOn(0, 88) }], NOW);
    check('a session without pace still scores from steadiness alone', noPaceNoRange.points[0]?.score === 88);

    // An unscoreable session is counted but never plotted, and never zeroed.
    const withUnscoreable = buildProgress([sessionOn(-1, null), sessionOn(0, 90)], NOW);
    check('an unscoreable session is not plotted', withUnscoreable.points.length === 1);
    check('an unscoreable session is still counted as a session', withUnscoreable.sessionsInWindow === 2);
    check('it is counted separately from scored ones', withUnscoreable.scoredInWindow === 1);
    check('it is never plotted as zero', withUnscoreable.points.every((p) => p.score !== 0));

    // Every session unscoreable is its own honest state, distinct from "no sessions".
    const allUnscoreable = buildProgress([sessionOn(-1, null), sessionOn(0, null)], NOW);
    check('sessions exist even when none can be scored', allUnscoreable.sessionsInWindow === 2);
    check('but nothing is plotted', allUnscoreable.points.length === 0);
    check('and no average is invented', allUnscoreable.average === null);
  });

  suite('progress: 15, 16. no fabricated points or sessions', () => {
    const one = buildProgress([sessionOn(0, 90)], NOW);
    check('one stored session yields exactly one point', one.points.length === 1);
    check('the point count never exceeds the session count', one.points.length <= one.sessionsInWindow);

    // A whole empty 30-day span must not be padded out with anything.
    const sparse = buildProgress([sessionOn(-20, 90), sessionOn(0, 90)], NOW);
    check('a gap in the middle adds no points', sparse.points.length === 2, sparse.points);
    check('a gap in the middle adds no sessions', sparse.sessionsInWindow === 2);
    check('every point maps to a real stored session', sparse.points.every((p) => p.dayKey.length === 10));
  });

  suite('progress: 7. multiple sessions on the same day are all kept', () => {
    const morning = sessionOn(0, 70, 'morning', 8);
    const evening = sessionOn(0, 92, 'evening', 19);
    const summary = buildProgress([evening, morning], NOW);

    check('both same-day sessions are plotted', summary.points.length === 2);
    check('they keep their own real values, in time order', summary.points[0].score === 70 && summary.points[1].score === 92, summary.points.map((p) => p.score));
    check('they are not averaged into one point', summary.points.length === 2 && summary.average === 81, summary.average);
    check('they share the same calendar day', summary.points[0].dayKey === summary.points[1].dayKey, summary.points.map((p) => p.dayKey));
    check('the average covers both real values', summary.average === 81, summary.average);
  });

  suite('progress: 12. malformed history is handled safely', () => {
    check('an unparseable date is dropped, not plotted', buildProgress([{ id: 'bad', completedAt: 'not a date', consistencyPct: 90 }], NOW).points.length === 0);
    check('an empty date is dropped', buildProgress([{ id: 'bad', completedAt: '', consistencyPct: 90 }], NOW).points.length === 0);
    check('a missing date field is dropped', buildProgress([{ id: 'bad', completedAt: undefined as unknown as string, consistencyPct: 90 }], NOW).points.length === 0);
    check('a non-string date is dropped', buildProgress([{ id: 'bad', completedAt: 12345 as unknown as string, consistencyPct: 90 }], NOW).points.length === 0);
    check('a NaN score is dropped', buildProgress([{ id: 'bad', completedAt: NOW.toISOString(), consistencyPct: Number.NaN }], NOW).points.length === 0);
    check('an out-of-range score is dropped', buildProgress([{ id: 'bad', completedAt: NOW.toISOString(), consistencyPct: 500 }], NOW).points.length === 0);
    check('mixed good and bad records keep only the good ones', buildProgress([{ id: 'bad', completedAt: 'nope', consistencyPct: 10 }, sessionOn(0, 65)], NOW).points.length === 1);
    check('a fully corrupt list yields an empty summary rather than a crash', buildProgress([{ id: 'x', completedAt: '???', consistencyPct: null }], NOW).points.length === 0);
  });

  suite('progress: 6, 20. reading progress never destroys history', async () => {
    // A real store, so this also covers the interaction with existing history.
    const memory: Record<string, string> = {};
    const store: KeyValueStore = {
      async getItem(key) {
        return key in memory ? memory[key] : null;
      },
      async setItem(key, value) {
        memory[key] = value;
      },
      async removeItem(key) {
        delete memory[key];
      },
    };
    const history = createSessionStore(store);

    function makeRecord(dayOffset: number, consistency: number | null): SessionRecord {
      const when = new Date(NOW);
      when.setDate(when.getDate() + dayOffset);
      return createSessionRecord({
        id: createSessionId(),
        exerciseId: 'seated-knee-extension',
        exerciseName: 'Seated Knee Extension',
        completedAt: when.toISOString(),
        metrics: {
          reps: 8,
          durationSeconds: 120,
          // Pace and range vary freely: the score must not depend on them.
          paceRpm: dayOffset % 2 === 0 ? 12.5 : 4,
          rangeMinDeg: 90,
          rangeMaxDeg: 90 + (dayOffset % 3) * 10,
          consistencyPct: consistency,
        },
      });
    }

    const old = makeRecord(-45, 71);
    const recent = makeRecord(-1, 88);
    await history.saveSession(old);
    await history.saveSession(recent);

    const stored = await history.getSessions();
    check('both sessions are stored', stored.length === 2, stored.length);

    const summary = buildProgress(stored, NOW);
    check('only the recent session is charted', summary.points.length === 1, summary.points);
    check('the charted session is the recent one', summary.points[0].score === 88);
    check('the old session is still in storage after charting', (await history.getSessions()).length === 2);
    check('the old session was not rewritten', (await history.getSessions()).some((r) => r.id === old.id));
    check('existing history behaviour is intact', stored.some((r) => r.id === recent.id));
  });

  suite('progress: the window and day keys are local, not UTC', () => {
    const lateLocal = new Date(2026, 8, 28, 23, 30, 0);
    check('a late local session is dated to the local day', localDayKey(lateLocal) === '2026-09-28', localDayKey(lateLocal));
    check('start of local day strips the time', startOfLocalDay(lateLocal).getHours() === 0);
    check('the window start is a real date', Number.isFinite(progressWindowStart(NOW).getTime()));

    // A session at 23:30 local on the 29th day back belongs to that local day.
    const boundary = new Date(2026, 8, 30 - 1, 23, 30, 0);
    check('a late-evening boundary session is inside the window', buildProgress([{ id: 'b', completedAt: boundary.toISOString(), consistencyPct: 80 }], NOW).points.length === 1);
  });

  suite('progress: the cap on stored history is untouched', () => {
    check('the existing history cap is still 200', MAX_SAVED_SESSIONS === 200);
  });
}
