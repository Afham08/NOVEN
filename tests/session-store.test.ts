import { check, suite } from './harness';

import { buildSessionMetrics } from '../src/exercise/metrics';
import {
  createSessionId,
  createSessionRecord,
  createSessionStore,
  dayLabel,
  MAX_SAVED_SESSIONS,
  parseSessionHistory,
  parseSessionRecord,
  SESSION_HISTORY_KEY,
  type KeyValueStore,
  type SessionRecord,
} from '../src/exercise/session-store';

// Reading the history component's source is how the user-visible wording is
// checked, matching how result-routing.test.ts guards the Result screen. The
// minimal declarations are declared here rather than pulling in @types/node.
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};

/**
 * A `KeyValueStore` with no device behind it.
 *
 * Backed by a plain object, so it can also be PRE-SEEDED with whatever garbage
 * a previous version, a crash mid-write, or a curious user left behind — which
 * is how the malformed-data cases are exercised.
 *
 * `throwing` makes every operation reject, so the "storage is unavailable"
 * degradation path is testable too.
 */
function fakeStore(seed: Record<string, string> = {}, throwing = false): KeyValueStore & {
  data: Record<string, string>;
  writes: number;
} {
  const data: Record<string, string> = { ...seed };
  const self = {
    data,
    writes: 0,
    getItem(key: string): Promise<string | null> {
      if (throwing) return Promise.reject(new Error('storage unavailable'));
      return Promise.resolve(key in data ? data[key] : null);
    },
    setItem(key: string, value: string): Promise<void> {
      if (throwing) return Promise.reject(new Error('storage unavailable'));
      self.writes += 1;
      data[key] = value;
      return Promise.resolve();
    },
    removeItem(key: string): Promise<void> {
      if (throwing) return Promise.reject(new Error('storage unavailable'));
      delete data[key];
      return Promise.resolve();
    },
  };
  return self;
}

/** A finished session's metrics, as `end()` would build them. */
function metrics(overrides: Partial<ReturnType<typeof buildSessionMetrics>> = {}) {
  return {
    ...buildSessionMetrics({
      reps: 5,
      durationSeconds: 154,
      repRanges: [82, 80, 79],
      rangeMinDeg: 88,
      rangeMaxDeg: 170,
    }),
    ...overrides,
  };
}

function record(id: string, completedAt: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ...createSessionRecord({
      id,
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      completedAt,
      metrics: metrics(),
    }),
    ...overrides,
  };
}

export function run(): void {
  suite('session history: a saved session comes back exactly as it was saved', async () => {
    const store = createSessionStore(fakeStore());
    const saved = record('a1', '2026-09-27T09:00:00.000Z', {
      reps: 5,
      durationSeconds: 154,
      paceRpm: 1.9,
      rangeMinDeg: 88,
      rangeMaxDeg: 170,
      consistencyPct: 99,
    });

    await store.saveSession(saved);
    const all = await store.getSessions();

    check('exactly one session is stored', all.length === 1, all.length);
    check('it is the record that was saved', all[0].id === 'a1', all[0]);
    check('reps survive the round trip', all[0].reps === 5, all[0].reps);
    check('duration survives the round trip', all[0].durationSeconds === 154, all[0].durationSeconds);
    check('pace survives the round trip', all[0].paceRpm === 1.9, all[0].paceRpm);
    check('range survives the round trip', all[0].rangeMinDeg === 88 && all[0].rangeMaxDeg === 170, all[0]);
    check('consistency survives the round trip', all[0].consistencyPct === 99, all[0].consistencyPct);
    check('the exercise name is kept', all[0].exerciseName === 'Seated Knee Extension', all[0].exerciseName);

    const byId = await store.getSessionById('a1');
    check('it is retrievable by id', byId !== null && byId.id === 'a1', byId);
    check('an unknown id returns null', (await store.getSessionById('nope')) === null);
  });

  suite('session history: multiple sessions are preserved, newest first', async () => {
    const store = createSessionStore(fakeStore());
    await store.saveSession(record('old', '2026-09-25T08:00:00.000Z'));
    await store.saveSession(record('newest', '2026-09-27T19:00:00.000Z'));
    await store.saveSession(record('middle', '2026-09-26T08:00:00.000Z'));

    const all = await store.getSessions();
    check('all three sessions survive', all.length === 3, all.map((r) => r.id));
    check('newest comes first', all[0].id === 'newest', all.map((r) => r.id));
    check('then the middle one', all[1].id === 'middle', all.map((r) => r.id));
    check('oldest comes last', all[2].id === 'old', all.map((r) => r.id));
  });

  suite('session history: newest-first order holds regardless of insertion order', () => {
    const shuffled = [
      record('b', '2026-09-26T10:00:00.000Z'),
      record('a', '2026-09-25T10:00:00.000Z'),
      record('c', '2026-09-27T10:00:00.000Z'),
    ];
    const sorted = parseSessionHistory(JSON.stringify(shuffled));
    check('sorted by completedAt, descending', sorted.map((r) => r.id).join(',') === 'c,b,a', sorted.map((r) => r.id));
  });

  suite('session history: the same completed session is saved only once', async () => {
    const store = createSessionStore(fakeStore());
    const completed = record('same', '2026-09-27T10:00:00.000Z');

    // Saving the identical completed session repeatedly must not inflate the
    // history. This is the storage-level half of the once-only guarantee; the
    // other half is the terminal guard on the session screen's End handler.
    await store.saveSession(completed);
    await store.saveSession(completed);
    await store.saveSession(completed);

    const all = await store.getSessions();
    check('three saves produce one session', all.length === 1, all.map((r) => r.id));
    check('and the record is unchanged', all[0].reps === completed.reps && all[0].durationSeconds === completed.durationSeconds, all[0]);
  });

  suite('session history: deleting removes only the requested session', async () => {
    const store = createSessionStore(fakeStore());
    await store.saveSession(record('a', '2026-09-26T10:00:00.000Z'));
    await store.saveSession(record('b', '2026-09-27T10:00:00.000Z'));

    check('deleting a stored id reports success', (await store.deleteSession('a')) === true);
    const afterDelete = await store.getSessions();
    check('only the other session remains', afterDelete.length === 1 && afterDelete[0].id === 'b', afterDelete.map((r) => r.id));
    check('deleting an unknown id reports false', (await store.deleteSession('missing')) === false);

    await store.clearSessions();
    check('clearSessions empties the history', (await store.getSessions()).length === 0);
  });

  suite('session history: a zero-rep session is recorded honestly', async () => {
    const store = createSessionStore(fakeStore());
    // A session the user ended without completing a rep is still a session they
    // finished, so it is kept — and it must not be dressed up with a score.
    const zero = createSessionRecord({
      id: 'zero',
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      completedAt: '2026-09-27T10:00:00.000Z',
      metrics: metrics({
        reps: 0,
        durationSeconds: 0,
        paceRpm: null,
        rangeMinDeg: null,
        rangeMaxDeg: null,
        consistencyPct: null,
      }),
    });

    await store.saveSession(zero);
    const [stored] = await store.getSessions();

    check('the zero-rep session is kept', stored !== undefined, stored);
    check('reps stay zero', stored.reps === 0, stored.reps);
    check('duration stays zero', stored.durationSeconds === 0, stored.durationSeconds);
    check('an unmeasured pace stays null', stored.paceRpm === null, stored.paceRpm);
    check('an unmeasured range stays null', stored.rangeMinDeg === null && stored.rangeMaxDeg === null, stored);
    check('unmeasured consistency stays null', stored.consistencyPct === null, stored.consistencyPct);
    check('no score field is invented', !('score' in stored), Object.keys(stored));
  });

  suite('session history: optional metrics stay null rather than becoming fake values', async () => {
    const store = createSessionStore(fakeStore());
    // A 4-second session cannot produce a pace, and a single rep cannot produce
    // a consistency. Both must round-trip as null, not as 0.
    const thin = createSessionRecord({
      id: 'thin',
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      completedAt: '2026-09-27T10:00:00.000Z',
      metrics: metrics({ reps: 1, durationSeconds: 4, paceRpm: null, consistencyPct: null }),
    });

    await store.saveSession(thin);
    const [stored] = await store.getSessions();
    check('pace survives as null', stored.paceRpm === null, stored.paceRpm);
    check('consistency survives as null', stored.consistencyPct === null, stored.consistencyPct);
    check('a real range is still kept', stored.rangeMaxDeg === 170, stored.rangeMaxDeg);
  });

  suite('session history: malformed stored data does not crash the app', async () => {
    // Every one of these is something a crash mid-write, a downgrade, or a
    // hand-edited value could leave in storage. None may throw, and none may
    // invent a number.
    const hostile: unknown[] = [
      undefined,
      null,
      '',
      'not json at all',
      '{"broken":',
      '"a bare string"',
      '42',
      '{}',
      '[]',
      [null, 1, 'x'],
      [{}],
      [{ id: '', exerciseId: 'e', exerciseName: 'E', completedAt: '2026-09-27T10:00:00.000Z', reps: 1, durationSeconds: 1 }],
      [{ id: 'x', exerciseId: 'e', exerciseName: 'E', completedAt: 'yesterday', reps: 1, durationSeconds: 1 }],
      [{ id: 'x', exerciseId: 'e', exerciseName: 'E', completedAt: '2026-09-27T10:00:00.000Z', reps: 5.7, durationSeconds: 1 }],
      [{ id: 'x', exerciseId: 'e', exerciseName: 'E', completedAt: '2026-09-27T10:00:00.000Z', reps: -3, durationSeconds: 1 }],
      [{ id: 'x', exerciseId: 'e', exerciseName: 'E', completedAt: '2026-09-27T10:00:00.000Z', reps: 1, durationSeconds: -10 }],
      [
        {
          id: 'x',
          exerciseId: 'e',
          exerciseName: 'E',
          completedAt: '2026-09-27T10:00:00.000Z',
          reps: 1,
          durationSeconds: 10,
          paceRpm: 'fast',
        },
      ],
      [
        {
          id: 'x',
          exerciseId: 'e',
          exerciseName: 'E',
          completedAt: '2026-09-27T10:00:00.000Z',
          reps: 1,
          durationSeconds: 10,
          consistencyPct: 900,
        },
      ],
    ];

    for (const [index, value] of hostile.entries()) {
      let threw: unknown = null;
      let parsed: SessionRecord[] | null = null;
      try {
        parsed = parseSessionHistory(typeof value === 'string' ? value : JSON.stringify(value));
      } catch (error) {
        threw = error;
      }
      check(`hostile input #${index} does not throw`, threw === null, threw === null ? null : String(threw));
      check(`hostile input #${index} yields no records`, parsed !== null && parsed.length === 0, parsed);
    }

    // NaN and Infinity cannot survive JSON, so they are checked on the record
    // parser directly, where hand-built objects can carry them.
    check('NaN pace is rejected', parseSessionRecord({ ...record('a', '2026-09-27T10:00:00.000Z'), paceRpm: Number.NaN }) === null);
    check('Infinity pace is rejected', parseSessionRecord({ ...record('a', '2026-09-27T10:00:00.000Z'), paceRpm: Infinity }) === null);
    check('NaN reps is rejected', parseSessionRecord({ ...record('a', '2026-09-27T10:00:00.000Z'), reps: Number.NaN }) === null);
    check('an id that is not a string is rejected', parseSessionRecord({ ...record('a', '2026-09-27T10:00:00.000Z'), id: 7 }) === null);
  });

  suite('session history: a corrupt entry is dropped and the good ones survive', async () => {
    const good = record('good', '2026-09-27T10:00:00.000Z');
    const alsoGood = record('also-good', '2026-09-26T10:00:00.000Z');
    // One unreadable record sitting between two valid ones.
    const store = createSessionStore(
      fakeStore({
        [SESSION_HISTORY_KEY]: JSON.stringify([good, { id: 'broken' }, alsoGood]),
      }),
    );

    const all = await store.getSessions();
    check('the valid sessions are still readable', all.length === 2, all.map((r) => r.id));
    check('and still ordered newest first', all[0].id === 'good', all.map((r) => r.id));
  });

  suite('session history: unreadable storage degrades to an empty history', async () => {
    const store = createSessionStore(fakeStore({}, true));
    check('a failing read yields no sessions', (await store.getSessions()).length === 0);

    // A failing write must not leave the in-memory view claiming a session that
    // was never stored.
    let rejected = false;
    try {
      await store.saveSession(record('x', '2026-09-27T10:00:00.000Z'));
    } catch {
      rejected = true;
    }
    check('a failing write surfaces its error to the caller', rejected, rejected);
    check('and stores nothing', (await store.getSessions()).length === 0);
  });

  suite('session history: sessions survive a restart of the app', async () => {
    // The defining property of persistence: a brand new store instance over the
    // same storage — which is exactly what an app launch produces — still sees
    // the session. An in-memory-only store would fail this.
    const backing = fakeStore();
    const first = createSessionStore(backing);
    await first.saveSession(record('persisted', '2026-09-27T10:00:00.000Z', { reps: 6 }));

    const afterRestart = createSessionStore(backing);
    const all = await afterRestart.getSessions();
    check('a new store instance still sees the session', all.length === 1, all.length);
    check('with its real rep count', all[0].reps === 6, all[0].reps);
    check('and it lives under one single storage key', Object.keys(backing.data).join(',') === SESSION_HISTORY_KEY, Object.keys(backing.data));
  });

  suite('session history: the record is built from real session metrics', () => {
    const built = createSessionRecord({
      id: 'r',
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      completedAt: '2026-09-27T10:00:00.000Z',
      metrics: buildSessionMetrics({
        reps: 3,
        durationSeconds: 22,
        repRanges: [80, 80, 80],
        rangeMinDeg: 90,
        rangeMaxDeg: 170,
      }),
    });

    check('reps are carried over', built.reps === 3, built.reps);
    check('a 22s session does produce a real pace', built.paceRpm !== null && built.paceRpm > 8 && built.paceRpm < 9, built.paceRpm);
    check('identical reps give full consistency', built.consistencyPct === 100, built.consistencyPct);
    check('the range is carried over', built.rangeMinDeg === 90 && built.rangeMaxDeg === 170, built);
  });

  suite('session history: ids are unique and sortable', () => {
    const a = createSessionId(1_757_000_000_000, 0.5);
    const b = createSessionId(1_757_000_000_000, 0.9);
    check('two sessions in the same millisecond differ', a !== b, { a, b });
    check('the id is not empty', a.length > 0, a);
  });

  suite('session history: the history cannot grow without bound', async () => {
    const store = createSessionStore(fakeStore());
    // One more than the cap, written oldest-first so the drop is observable.
    for (let i = 0; i <= MAX_SAVED_SESSIONS; i += 1) {
      const at = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
      await store.saveSession(record(`s${i}`, at));
    }
    const all = await store.getSessions();
    check('the stored history is capped', all.length === MAX_SAVED_SESSIONS, all.length);
    check('the oldest sessions are the ones dropped', all[0].id === `s${MAX_SAVED_SESSIONS}`, all[0].id);
  });

  suite('session history: day labels are plain language', () => {
    const now = new Date(2026, 8, 27, 12, 0, 0).getTime();
    const today = new Date(2026, 8, 27, 9, 0, 0).toISOString();
    const yesterday = new Date(2026, 8, 26, 9, 0, 0).toISOString();
    const lastWeek = new Date(2026, 8, 20, 9, 0, 0).toISOString();

    check('today reads as Today', dayLabel(today, now) === 'Today', dayLabel(today, now));
    check('yesterday reads as Yesterday', dayLabel(yesterday, now) === 'Yesterday', dayLabel(yesterday, now));
    // The exact form follows the device locale ("Sep 20" / "20 Sept" / "20/09"),
    // so the assertion is that it is a short label naming the day, not Today or
    // Yesterday, rather than one hardcoded spelling.
    const older = dayLabel(lastWeek, now);
    check('an older session gets a plain date label', older !== null && older !== 'Today' && older !== 'Yesterday', older);
    check('and that label names the day it happened', older !== null && older.includes('20'), older);
    check('an undatable record has no label', dayLabel('not a date', now) === null);
  });

  suite('session history UI: the wording stays plain and scores nothing', () => {
    const nodeRequire = require as unknown as (id: string) => {
      readFileSync(path: string, encoding: 'utf8'): string;
      resolve(...segments: string[]): string;
    };
    const raw = nodeRequire('fs').readFileSync(
      nodeRequire('path').resolve(__dirname, '../../src/components/session/session-history.tsx'),
      'utf8',
    );

    // Comments are stripped before any wording check. They deliberately spell out
    // several clinical terms in order to rule them out, so scanning raw source
    // would flag the explanation as if it were the wording.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Clinical or judgemental vocabulary has no place in a history list. This
    // scans the whole comment-stripped file, not just string literals, so a
    // clinical term cannot reappear in a formatted value either.
    const banned = [
      'accuracy', 'score', 'health', 'healthy', 'recovery', 'performance',
      'diagnos', 'patient', 'therapy', 'rehab', 'quality', 'grade', 'level',
      'calorie', 'target', 'goal', 'improvement', 'symptom', 'clinical',
    ];
    for (const word of banned) {
      check(
        `the history screen never says "${word}"`,
        !code.toLowerCase().includes(word),
        code.match(new RegExp(`.{0,40}${word}.{0,40}`, 'i')),
      );
    }

    // The empty state must invite the first session rather than imply a lack.
    // It also names every kind of session now, because all four land in this one
    // list — saying "exercise sessions" would be wrong for somebody whose only
    // session so far has been a yoga routine.
    check('the empty state says there are none yet', code.includes('No sessions yet'));
    check('and explains what will fill it', code.includes('Finish an exercise, a yoga routine, or a calm moment'));

    // The count is phrased the same way the Result screen phrases it, so the two
    // never disagree about the same session.
    check(
      'the count is phrased as exercises completed',
      code.includes('exercise') && code.includes('exercises') && code.includes('completed'),
    );
    check('the singular is handled', code.includes("reps === 1 ? 'exercise' : 'exercises'"));

    // A metric the engine could not measure must be hidden, not shown as a zero.
    check(
      'an unmeasured pace is hidden rather than shown as zero',
      code.includes('record.paceRpm !== null'),
    );
    check(
      'an unmeasured day is hidden rather than shown as a blank',
      code.includes('day !== null'),
    );
  });
}
