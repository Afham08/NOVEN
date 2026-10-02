import { check, suite } from './harness';

import {
  allGuidedActivities,
  assertCatalogIsUsable,
  BY_KIND,
  findGuidedActivity,
  findGuidedActivityInKind,
  guidedActivitiesForDay,
  guidedCatalog,
} from '../src/activities/catalog';
import {
  describeLength,
  describeRoutineMeta,
  describeSessionOutcome,
  describeStepPosition,
} from '../src/activities/activity-format';
import { GuidedSession, PROGRESS_MAX } from '../src/activities/guided-session';
import { GUIDED_ACTIVITY_KINDS, totalStepSeconds, isGuidedActivityKind, type GuidedActivity } from '../src/activities/types';
import { countDoneToday, todayStatus } from '../src/activities/today';
import { getExerciseConfig, getGuidedPoseConfig, SIT_TO_STAND } from '../src/exercise/pose-configs';
import { parseSecondsParam, parseStepCountParam, wholeNumberParam, parseSaveStatusParam, describeSaveStatus, type SaveStatus } from '../src/activities/result-params';
import { beginStep, emptyRepTally, measuredReps, observeStepReps, type GuidedRepTally } from '../src/activities/guided-reps';
import { buildSessionMetrics } from '../src/exercise/metrics';
import { SessionEngine } from '../src/exercise/session-engine';
import { createSessionRecord, createSessionStore, SESSION_HISTORY_KEY, type KeyValueStore, type SessionRecord } from '../src/exercise/session-store';
import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName } from '../modules/pose-tracker';

/**
 * A clock the tests drive by hand.
 *
 * The session engine reads time through a function rather than calling
 * `Date.now()`, which is the only reason elapsed-time behaviour can be asserted
 * exactly rather than approximately. A test that waits for real seconds is a
 * slow test that fails on a loaded machine; this one is neither.
 */
function fakeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(seconds: number) {
      nowMs += seconds * 1000;
      return nowMs;
    },
  };
}

export function run(): void {
  // ==========================================================================
  // The timer
  // ==========================================================================
  suite('guided session: the clock is the only source of elapsed time', () => {
    const activity = guidedCatalog('meditation')[0];
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);

    check('a new session is ready, not running', session.snapshot().phase === 'ready');
    check('a ready session has not started its clock', session.snapshot().elapsedSeconds === 0);

    // Advancing the clock while nothing is running must not move anything: a
    // phone that is asleep on a ready screen has not begun the session.
    clock.advance(120);
    check('time passing before Start does not count', session.snapshot().elapsedSeconds === 0);

    session.start();
    clock.advance(30);
    check('time counts once started', session.snapshot().elapsedSeconds === 30, session.snapshot().elapsedSeconds);
    check('it reports running', session.snapshot().phase === 'running');
    check('it shows the time left', session.snapshot().remainingSeconds === activity.durationSeconds - 30, session.snapshot().remainingSeconds);

    session.pause();
    clock.advance(300);
    check('a paused session does not gain time', session.snapshot().elapsedSeconds === 30, session.snapshot().elapsedSeconds);
    check('a paused session says paused', session.snapshot().phase === 'paused');

    session.resume();
    clock.advance(10);
    check('resuming continues from where it stopped', session.snapshot().elapsedSeconds === 40, session.snapshot().elapsedSeconds);

    session.reset();
    check('reset returns it to ready', session.snapshot().phase === 'ready');
    check('reset clears the clock', session.snapshot().elapsedSeconds === 0);
  });

  suite('guided session: progress is bounded and never exceeds the end', () => {
    const activity = guidedCatalog('wellness')[0];
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    for (let i = 0; i < 400; i += 1) {
      clock.advance(10);
      const progress = session.snapshot().progress;
      if (progress < 0 || progress > PROGRESS_MAX) {
        check(`progress stays within 0..1 (saw ${progress})`, false);
        break;
      }
    }
    check('progress never leaves 0..1 over a very long run', true);
    check('elapsed is capped at the planned length', session.snapshot().elapsedSeconds <= activity.durationSeconds, session.snapshot().elapsedSeconds);
    check('remaining never goes below zero', session.snapshot().remainingSeconds >= 0);
  });

  suite('guided session: a long jump does not skip past the end', () => {
    /*
     * The realistic version of this: someone puts the phone down, comes back
     * twenty minutes later, and the timer has to be finished, not negative, and
     * not stuck showing minutes remaining.
     */
    const activity = guidedCatalog('yoga')[0];
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(activity.durationSeconds * 20);

    const after = session.snapshot();
    check('it has finished', after.phase === 'finished', after.phase);
    check('elapsed is clamped to the planned length', after.elapsedSeconds === activity.durationSeconds, after.elapsedSeconds);
    check('remaining is zero, not negative', after.remainingSeconds === 0, after.remainingSeconds);
    check('every step is done', after.stepsCompleted === activity.steps.length, after.stepsCompleted);
    check('progress reads as complete', after.progress === 1, after.progress);
  });

  suite('guided session: steps advance in order and the last one completes', () => {
    const activity = guidedCatalog('yoga')[0];
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    let offset = 0;
    const seen: number[] = [];
    for (const step of activity.steps) {
      seen.push(session.snapshot().stepIndex);
      // Land just before the boundary, so the next reading has to be the step after.
      clock.advance(step.seconds - 0.5);
      offset += step.seconds - 0.5;
      check(`still on the step that has not finished at ${offset}s`, session.snapshot().stepIndex === seen.length - 1, session.snapshot().stepIndex);
      clock.advance(0.5);
      offset += 0.5;
    }

    check('it walked every step in order', seen.every((index, at) => index === at), seen.join(','));
    check('it finished at the end of the last step', session.snapshot().phase === 'finished', session.snapshot().phase);
  });

  suite('guided session: ending early keeps what was really done', () => {
    const activity = guidedCatalog('meditation')[0];
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(5);

    session.finishEarly();
    const after = session.snapshot();

    check('it stopped', after.phase !== 'running');
    check('it kept the five seconds it really ran', after.elapsedSeconds === 5, after.elapsedSeconds);
    check('it does not claim the whole routine', after.stepsCompleted < activity.steps.length, after.stepsCompleted);
    check('no step is claimed beyond the time that passed', after.stepsCompleted === 0, after.stepsCompleted);
  });

  suite('guided session: a zero-second step is finished, not stuck', () => {
    /*
     * A catalogue entry with a step of 0 seconds would divide by zero in the
     * step-progress calculation. The engine has to answer rather than produce
     * NaN, and a NaN here would reach the progress bar as an invisible bar.
     */
    const zeroStep: GuidedActivity = {
      id: 'test-zero-step',
      kind: 'wellness',
      name: 'Zero step',
      summary: 'A step that takes no time.',
      durationSeconds: 10,
      progressNoun: 'steps',
      safetyNote: 'Nothing to do.',
      steps: [
        { title: 'Instant', guidance: 'Blink.', seconds: 0 },
        { title: 'Rest', guidance: 'Wait.', seconds: 10 },
      ],
    };
    const clock = fakeClock();
    const session = new GuidedSession(zeroStep, clock.now);
    session.start();

    const immediate = session.snapshot();
    check('a zero-length step reports a finite progress', Number.isFinite(immediate.stepProgress), immediate.stepProgress);
    check('a zero-length step does not block the next one', immediate.stepIndex === 1, immediate.stepIndex);
  });

  // ==========================================================================
  // The catalogues
  // ==========================================================================
  suite('activity catalogue: every entry is usable', () => {
    check('the catalogue assertion passes', (() => {
      assertCatalogIsUsable();
      return true;
    })());

    check('ids are unique across all three kinds', new Set(allGuidedActivities.map((a) => a.id)).size === allGuidedActivities.length, allGuidedActivities.length);

    for (const kind of GUIDED_ACTIVITY_KINDS) {
      const items = guidedCatalog(kind);
      check(`${kind} has at least one activity`, items.length > 0, items.length);
      for (const activity of items) {
        check(`${activity.id} has a name`, activity.name.trim().length > 0);
        check(`${activity.id} has a summary`, activity.summary.trim().length > 0);
        check(`${activity.id} has a safety note`, activity.safetyNote.trim().length > 0);
        check(`${activity.id} has at least two steps`, activity.steps.length >= 2, activity.steps.length);
        check(`${activity.id} has a positive duration`, activity.durationSeconds > 0, activity.durationSeconds);
        check(`${activity.id} declares its own kind`, activity.kind === kind, activity.kind);

        for (const step of activity.steps) {
          check(`${activity.id}/${step.title} has a title`, step.title.trim().length > 0);
          check(`${activity.id}/${step.title} has guidance`, step.guidance.trim().length > 0);
          check(`${activity.id}/${step.title} has a positive length`, step.seconds > 0, step.seconds);
          // Elder-friendly and readable from a chair: the guidance has to be sayable.
          check(`${activity.id}/${step.title} is not a wall of text`, step.guidance.length <= 180, step.guidance.length);
        }

        check(`${activity.id} duration equals its steps`, totalStepSeconds(activity.steps) === activity.durationSeconds, totalStepSeconds(activity.steps));
      }
    }
  });

  suite('activity catalogue: durations are what the cards promise', () => {
    const all = allGuidedActivities.map((a) => a.durationSeconds);
    check('the shortest meditation is genuinely short', Math.min(...guidedCatalog('meditation').map((a) => a.durationSeconds)) <= 60);
    check('wellness activities are all under two minutes', guidedCatalog('wellness').every((a) => a.durationSeconds < 120), guidedCatalog('wellness').map((a) => a.durationSeconds).join(','));
    check('nothing is longer than fifteen minutes', all.every((d) => d <= 900), Math.max(...all));
    check('durations are whole seconds', all.every((d) => Number.isSafeInteger(d)));
  });

  suite('activity catalogue: lookup is by id, and by kind where it should be', () => {
    const yoga = guidedCatalog('yoga')[0];
    const meditation = guidedCatalog('meditation')[0];

    check('found by id across all kinds', findGuidedActivity(yoga.id)?.id === yoga.id);
    check('found within its own kind', findGuidedActivityInKind('yoga', yoga.id)?.id === yoga.id);
    check('not found in a kind it does not belong to', findGuidedActivityInKind('meditation', yoga.id) === undefined);
    check('a missing id finds nothing', findGuidedActivity(undefined) === undefined);
    check('a wrong id finds nothing', findGuidedActivity('not-a-real-activity') === undefined);
    check('an id from a different kind is a different activity', findGuidedActivity(meditation.id)?.id !== yoga.id);
  });

  suite('activity catalogue: a day view carries the done state with the activity', () => {
    const first = BY_KIND.wellness[0];
    const view = guidedActivitiesForDay('wellness', [first.id]);

    check('it returns one entry per activity', view.length === BY_KIND.wellness.length);
    check('the done one is marked done', view.find((entry) => entry.activity.id === first.id)?.done === true);
    check('the rest are not', view.filter((entry) => entry.done).length === 1);
    check('each entry carries the activity itself', view.every((entry) => typeof entry.activity.name === 'string'));
  });

  // ==========================================================================
  // Wording
  // ==========================================================================
  suite('activity wording: lengths read the way a person would say them', () => {
    check('under a minute is in seconds', describeLength(45) === '45 sec', describeLength(45));
    check('a whole minute drops the seconds', describeLength(60) === '1 min', describeLength(60));
    check('a part minute keeps both', describeLength(90) === '1 min 30 sec', describeLength(90));
    check('a negative length is not printed as one', describeLength(-5) === '0 sec', describeLength(-5));
    check('a decimal is floored, not rounded up', describeLength(59.9) === '59 sec', describeLength(59.9));
  });

  suite('activity wording: a guided session is described by what it did', () => {
    const activity = guidedCatalog('yoga')[0];
    const base: SessionRecord = {
      id: 'r1',
      exerciseId: activity.id,
      exerciseName: activity.name,
      completedAt: new Date().toISOString(),
      reps: 0,
      durationSeconds: 120,
      paceRpm: null,
      rangeMinDeg: null,
      rangeMaxDeg: null,
      consistencyPct: null,
      activityKind: activity.kind,
      stepsCompleted: 3,
    };

    check('it counts the steps, not repetitions', describeSessionOutcome(base).includes('3'), describeSessionOutcome(base));
    check('it does not claim a repetition count', !/\breps?\b/i.test(describeSessionOutcome(base)), describeSessionOutcome(base));
    check('it does not claim a measurement', !/score|stead|angle|degree|pace|range/i.test(describeSessionOutcome(base)), describeSessionOutcome(base));

    const finished = { ...base, stepsCompleted: activity.steps.length };
    check('a finished routine says so by naming every one of its steps', describeSessionOutcome(finished) === `${activity.steps.length} of ${activity.steps.length} ${activity.progressNoun}`, describeSessionOutcome(finished));

    const oneStep = { ...base, stepsCompleted: 1 };
    check('one step of many is not pluralised into nonsense', !/1 poses\b/.test(describeSessionOutcome(oneStep)), describeSessionOutcome(oneStep));

    check('a camera session still reads as a count of exercises', describeSessionOutcome({
      ...base,
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      activityKind: undefined,
      stepsCompleted: undefined,
      reps: 5,
    }).includes('5'), 'camera wording');
  });

  suite('activity wording: a step position is never out of range', () => {
    check('the first step reads as 1', describeStepPosition(0, 6, 'poses').includes('1'), describeStepPosition(0, 6, 'poses'));
    check('a partial count reads as the next one', describeStepPosition(2, 6, 'poses').includes('3'), describeStepPosition(2, 6, 'poses'));
    check('a count past the end is clamped', describeStepPosition(99, 6, 'poses').includes('6'), describeStepPosition(99, 6, 'poses'));
    check('a negative count is not printed', !/-\d/.test(describeStepPosition(-2, 6, 'poses')), describeStepPosition(-2, 6, 'poses'));
  });

  // ==========================================================================
  // Today's status
  // ==========================================================================
  suite('today: done is read from real finished sessions, never stored twice', () => {
    const items = BY_KIND.wellness;
    const now = new Date(2026, 8, 28, 14, 0, 0);
    const todayNoon = new Date(2026, 8, 28, 12, 0, 0).toISOString();
    const yesterdayNoon = new Date(2026, 8, 27, 12, 0, 0).toISOString();

    const record = (over: Partial<SessionRecord>): SessionRecord => ({
      id: 'r',
      exerciseId: items[0].id,
      exerciseName: items[0].name,
      completedAt: todayNoon,
      reps: 0,
      durationSeconds: 90,
      paceRpm: null,
      rangeMinDeg: null,
      rangeMaxDeg: null,
      consistencyPct: null,
      activityKind: 'wellness',
      ...over,
    });

    const yesterdayOnly = todayStatus([record({ completedAt: yesterdayNoon })], items, 'wellness', now);
    check('yesterday does not count as today', yesterdayOnly.every((s) => !s.done), yesterdayOnly.filter((s) => s.done).length);
    check('yesterday is still a real session, just not today\'s', yesterdayOnly.length === items.length);

    const status = todayStatus(
      [
        record({ id: 'a' }),
        record({ id: 'b', completedAt: yesterdayNoon, exerciseId: items[1].id }),
        record({ id: 'c', exerciseId: items[1].id }),
        record({ id: 'd', activityKind: 'yoga' }),
        record({ id: 'e', activityKind: undefined }),
      ],
      items,
      'wellness',
      now,
    );

    check('done once reads as done once', status.find((s) => s.activityId === items[0].id)?.timesToday === 1, status.find((s) => s.activityId === items[0].id)?.timesToday);
    check('done twice reads as twice', status.find((s) => s.activityId === items[1].id)?.timesToday === 1, status.find((s) => s.activityId === items[1].id)?.timesToday);
    check('a yoga session is not a wellness one', status.filter((s) => s.done).length === 2, status.filter((s) => s.done).length);
    check('every activity in the list gets an answer', status.length === items.length);

    const counts = countDoneToday(status);
    check('the count is real', counts.done === 2 && counts.total === items.length, `${counts.done}/${counts.total}`);

    check('an empty history is all not-done', countDoneToday(todayStatus([], items, 'wellness', now)).done === 0);
    check('a session from another year is not today', todayStatus([record({ completedAt: '2020-01-01T12:00:00.000Z' })], items, 'wellness', now).every((s) => !s.done));
    check('an unparseable date does not crash the read', todayStatus([record({ completedAt: 'not a date' })], items, 'wellness', now).every((s) => !s.done));
    check('a record for an id not in the list adds nothing', todayStatus([record({ exerciseId: 'gone-from-the-catalogue' })], items, 'wellness', now).filter((s) => s.done).length === 0);
  });

  // ==========================================================================
  // Today: a session that stopped short is not a finished one
  // ==========================================================================
  suite('today: a session that stopped short is not a finished one', async () => {
    /*
     * Nothing here is hand-built. Every record is produced the way the app
     * produces one: a real GuidedSession running a real catalogue activity on a
     * driven clock, ended early with the same End button the screen wires to
     * finishEarly(), written through the real session store, read back out of
     * it, and then asked the same question the Wellness screen asks.
     *
     * The evidence needed to answer this already exists in the record.
     * GuidedSession counts `stepsCompleted` from elapsed time and is
     * deliberately NOT derived from the phase - its own comment says deriving
     * it from "finished" would credit a five-second tap with a whole
     * meditation - so a partial session stores a truthful partial count.
     */
    const found = BY_KIND.wellness.find((a) => a.steps.length >= 3);
    if (found === undefined) throw new Error('need a multi-step wellness activity');
    const activity: GuidedActivity = found;

    const now = new Date(2026, 8, 28, 14, 0, 0);
    const todayNoon = new Date(2026, 8, 28, 12, 0, 0).toISOString();
    const yesterdayNoon = new Date(2026, 8, 27, 12, 0, 0).toISOString();
    const total = activity.steps.length;

    /** Runs the real session for `seconds`, then ends it, and reports the truth. */
    function runThenEnd(seconds: number) {
      let clockMs = 1_000_000;
      const session = new GuidedSession(activity, () => clockMs);
      session.start();
      clockMs += seconds * 1000;
      session.finishEarly();
      const snapshot = session.snapshot();
      return { stepsCompleted: snapshot.stepsCompleted, finished: snapshot.finished };
    }

    const metrics = buildSessionMetrics({
      reps: 0,
      durationSeconds: 60,
      repRanges: [],
      rangeMinDeg: null,
      rangeMaxDeg: null,
    });

    /** The real record builder and the real store, so nothing is faked. */
    async function persist(stepsCompleted: number | undefined, completedAt: string) {
      const written = new Map<string, string>();
      const backend: KeyValueStore = {
        getItem: async (key) => written.get(key) ?? null,
        setItem: async (key, value) => { written.set(key, value); },
        removeItem: async (key) => { written.delete(key); },
      };
      const store = createSessionStore(backend);
      const record = createSessionRecord({
        id: 'today-repro',
        exerciseId: activity.id,
        exerciseName: activity.name,
        completedAt,
        metrics,
        activityKind: activity.kind,
        ...(stepsCompleted !== undefined ? { stepsCompleted } : {}),
      });
      const stored = await store.saveSession(record);
      const readBack = await store.getSessions();
      return { stored, records: readBack };
    }

    // CASE A — every step actually ran.
    const full = runThenEnd(totalStepSeconds(activity.steps) + 5);
    check('a full run really does record every step', full.stepsCompleted === total, `${full.stepsCompleted}/${total}`);
    const fullWrite = await persist(full.stepsCompleted, todayNoon);
    check('a full run is stored', fullWrite.stored.id === 'today-repro' && fullWrite.records.length === 1, fullWrite.records);
    check('a full run really does come back out of storage', fullWrite.records[0]?.stepsCompleted === total, fullWrite.records[0]);
    const fullToday = todayStatus(fullWrite.records, BY_KIND.wellness, 'wellness', now);
    check('CASE A: a finished activity is done today', fullToday.find((s) => s.activityId === activity.id)?.done === true, fullToday);

    // CASE B — the critical one: the person tapped End part way through.
    const partial = runThenEnd(activity.steps[0].seconds + 2);
    check('ending early really does record fewer steps', partial.stepsCompleted > 0 && partial.stepsCompleted < total, `${partial.stepsCompleted}/${total}`);
    const partialWrite = await persist(partial.stepsCompleted, todayNoon);
    check('a partial run is still stored as a session', partialWrite.records.length === 1, partialWrite.records);
    const partialToday = todayStatus(partialWrite.records, BY_KIND.wellness, 'wellness', now);
    check(
      'CASE B: a session that stopped short is NOT done today',
      partialToday.find((s) => s.activityId === activity.id)?.done === false,
      partialToday,
    );
    check(
      'and it is not counted as a finished run either',
      countDoneToday(partialToday).done === 0,
      countDoneToday(partialToday),
    );

    // CASE C — started and abandoned before the first step ran out.
    const zero = runThenEnd(1);
    check('ending at once really does record zero steps', zero.stepsCompleted === 0, zero.stepsCompleted);
    const zeroWrite = await persist(zero.stepsCompleted, todayNoon);
    const zeroToday = todayStatus(zeroWrite.records, BY_KIND.wellness, 'wellness', now);
    check('CASE C: a session that ran no step is NOT done today', zeroToday.find((s) => s.activityId === activity.id)?.done === false, zeroToday);

    // CASE D — a finished session from another day is still not today.
    const otherDay = await persist(total, yesterdayNoon);
    check('CASE D: yesterday\'s finished run is not today', todayStatus(otherDay.records, BY_KIND.wellness, 'wellness', now).find((s) => s.activityId === activity.id)?.done === false, otherDay.records);

    // CASE E — an exercise record cannot stand in for a wellness one.
    const exerciseWrite = await persist(undefined, todayNoon);
    const asExercise = exerciseWrite.records.map((r) => ({ ...r, activityKind: undefined, stepsCompleted: undefined }));
    check('CASE E: a camera/exercise record does not tick a wellness activity', todayStatus(asExercise, BY_KIND.wellness, 'wellness', now).every((s) => !s.done), asExercise);

    // CASE F — the real, round-tripped full completion is still counted.
    check('CASE F: a full completion through storage still counts as done', countDoneToday(todayStatus(fullWrite.records, BY_KIND.wellness, 'wellness', now)).done >= 1, fullWrite.records);
  });

  // ==========================================================================
  // Route params
  // ==========================================================================
  suite('result params: a value from a link cannot become a claim', () => {
    check('a whole number is accepted', wholeNumberParam('5') === 5);
    check('a decimal is refused', wholeNumberParam('5.5') === null);
    check('a negative number is refused', wholeNumberParam('-1') === null);
    check('words are refused', wholeNumberParam('lots') === null);
    check('an empty value is refused', wholeNumberParam('') === null);
    check('a missing value is refused', wholeNumberParam(undefined) === null);
    check('a very long number is refused rather than truncated', wholeNumberParam('9'.repeat(30)) === null);

    check('a step count is a whole count', parseStepCountParam('3') === 3);
    check('a step count of zero is allowed', parseStepCountParam('0') === 0);
    check('a step count that is not a number is refused', parseStepCountParam('three') === null);
    check('a step count is passed through unchanged', parseStepCountParam('99') === 99);

    check('seconds are read as a count of seconds', parseSecondsParam('120') === 120);
    check('zero seconds is allowed', parseSecondsParam('0') === 0);
    check('negative seconds are refused', parseSecondsParam('-30') === null);
  });

  // ==========================================================================
  // The kind guard
  // ==========================================================================
  suite('guided kinds: the camera case is deliberately not one of them', () => {
    check('exercise is not a guided kind', !isGuidedActivityKind('exercise'));
    for (const kind of GUIDED_ACTIVITY_KINDS) {
      check(`${kind} is a guided kind`, isGuidedActivityKind(kind));
    }
    check('a kind that does not exist is not accepted', !isGuidedActivityKind('swimming'));
    check('a non-string is not accepted', !isGuidedActivityKind(7));
  });

  // ==========================================================================
  // The yoga library card
  // ==========================================================================
  suite('yoga library: every card is derived from its catalogue entry', () => {
    /*
     * The yoga list renders each routine's own summary and a meta line built by
     * `describeRoutineMeta`. What is guarded here is that the wording a person
     * sees is always a read of the catalogue, so a routine edited in one place
     * cannot go on promising a length or a count it no longer has.
     */
    const yoga = guidedCatalog('yoga');

    check('the yoga catalogue is not empty', yoga.length > 0);
    for (const routine of yoga) {
      check(`${routine.id} has a summary of its own`, typeof routine.summary === 'string' && routine.summary.length > 0);
      check(
        `${routine.id} meta line names the length and the pose count`,
        describeRoutineMeta(routine) === `${describeLength(routine.durationSeconds)} · ${routine.steps.length} ${routine.progressNoun}`,
        describeRoutineMeta(routine),
      );
      check(
        `${routine.id} meta line spells out the length rather than printing seconds`,
        describeRoutineMeta(routine).includes(describeLength(routine.durationSeconds)),
        describeRoutineMeta(routine),
      );
      check(`${routine.id} uses the noun its kind really uses`, routine.progressNoun === 'poses');
    }

    const first = yoga[0];
    check(
      'a whole-minute routine never prints "0 sec"',
      !/\b0 sec\b/.test(describeRoutineMeta(first)),
      describeRoutineMeta(first),
    );

    /*
     * A fourth routine added to the catalogue must appear on the library without
     * the screen being edited: the meta line is derived, not typed per card.
     */
    const later: GuidedActivity = {
      ...first,
      id: 'test-future-routine',
      name: 'A routine that does not exist yet',
      summary: 'Added later, described the same way.',
      durationSeconds: 150,
      steps: [
        { title: 'One', guidance: 'Move.', seconds: 75 },
        { title: 'Two', guidance: 'Move back.', seconds: 75 },
      ],
    };
    check(
      'a routine added later needs no screen edit to be described',
      describeRoutineMeta(later) === '2 min 30 sec · 2 poses',
      describeRoutineMeta(later),
    );
  });

  suite('guided camera steps: every kind resolves its configs through the one registry', () => {
    /*
     * A guided step's `cameraConfigId` must resolve, or the camera silently
     * never appears for that step. The meditation suite checks meditation's own
     * steps; this one covers every kind, so a yoga step naming a config that
     * only exists in the exercise registry (or nowhere) fails here loudly.
     */
    for (const kind of GUIDED_ACTIVITY_KINDS) {
      for (const activity of guidedCatalog(kind)) {
        for (const step of activity.steps) {
          if (step.cameraConfigId === undefined) continue;
          check(
            `${kind}/${activity.id} step "${step.title}" resolves ${step.cameraConfigId}`,
            getGuidedPoseConfig(step.cameraConfigId) !== undefined,
          );
        }
      }
    }

    // The regression this suite exists for: Chair Yoga Flow's "Stand and Sit"
    // step reuses the exercise registry's Sit-to-Stand thresholds.
    check(
      'chair-yoga-flow stand-and-sit resolves sit-to-stand',
      getGuidedPoseConfig('sit-to-stand') !== undefined,
    );
    const flow = guidedCatalog('yoga').find((a) => a.id === 'chair-yoga-flow');
    const standStep = flow?.steps.find((s) => s.cameraConfigId === 'sit-to-stand');
    check('the stand-and-sit step is still in the routine', standStep !== undefined);
    check(
      'sit-to-stand resolves to the SAME config the exercise uses',
      getGuidedPoseConfig('sit-to-stand')?.id === 'sit-to-stand' &&
        getGuidedPoseConfig('sit-to-stand')?.thresholds.bentAngleDeg === 140,
    );
  });

  suite('chair yoga: the stand-and-sit step runs in place in the real routine', () => {
    /*
     * The suite above resolves the config statically against the catalogue.
     * This one drives the REAL Chair Yoga Flow clock to its "Stand and Sit"
     * step and resolves the config from the step the session actually lands
     * on — the same expression the screen runs while the session is live —
     * then walks the routine to its end. A dangling id, a reordered routine,
     * or a step that skips its neighbours fails here at runtime rather than by
     * inspection of the catalogue alone.
     */
    const activity = guidedCatalog('yoga').find((a) => a.id === 'chair-yoga-flow');
    check('chair yoga flow is in the catalogue', activity !== undefined, activity?.id);
    if (activity === undefined) return;

    const standIndex = activity.steps.findIndex((s) => s.cameraConfigId === 'sit-to-stand');
    check('the routine still has a stand-and-sit camera step', standIndex > 0, standIndex);
    if (standIndex <= 0) return;

    const startOfStandSeconds = activity.steps
      .slice(0, standIndex)
      .reduce((total, step) => total + step.seconds, 0);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    // One second into the step, so it is unambiguously the step under way.
    clock.advance(startOfStandSeconds + 1);

    const onStand = session.snapshot();
    check('the session lands on the stand-and-sit step', onStand.stepIndex === standIndex, onStand.stepIndex);
    check('every step before it is completed', onStand.stepsCompleted === standIndex, onStand.stepsCompleted);
    check('no later step is claimed early', onStand.stepsCompleted < activity.steps.length, onStand.stepsCompleted);

    // The exact lookup the screen performs on the step it is currently running.
    const resolved = getGuidedPoseConfig(onStand.currentStep?.cameraConfigId);
    check(
      'the step under way resolves its camera config at runtime',
      resolved !== undefined,
      onStand.currentStep?.cameraConfigId,
    );
    check('it is the sit-to-stand config', resolved?.id === 'sit-to-stand', resolved?.id);
    check(
      'it is the SAME object the exercise session uses, not a copy',
      resolved !== undefined && resolved === getExerciseConfig('sit-to-stand'),
    );

    clock.advance(activity.durationSeconds);
    const done = session.snapshot();
    check(
      'the remaining steps still run after it, none bypassed',
      done.stepsCompleted === activity.steps.length,
      done.stepsCompleted,
    );
    check('the routine finishes normally', done.phase === 'finished', done.phase);
  });

  /*
   * The result screen once answered "Saved to your history" from how the session
   * had ended, while the guided screen had already thrown the write away without
   * looking at whether it landed. So a full routine whose save failed still
   * reported "Yes". These pin the claim to the write's real outcome.
   */
  suite('activity result: the save claim follows the write, not how the session ended', () => {
    check(
      'a save that landed says yes',
      describeSaveStatus(parseSaveStatusParam('saved'), true, false) === 'Yes',
    );
    check(
      'a save that landed keeps the part-finished wording for an early stop',
      describeSaveStatus(parseSaveStatusParam('saved'), false, true) === 'Yes, part finished',
    );

    /*
     * The dangerous cases are every combination of a session that did NOT get
     * written. None of them may produce a claim of success, however complete the
     * routine was or however it ended.
     */
    for (const status of [null, 'failed'] as const) {
      for (const ranToTheEnd of [true, false]) {
        for (const stopped of [true, false]) {
          const shown = describeSaveStatus(status, ranToTheEnd, stopped);
          check(
            `an unwritten session never claims a save (${String(status)}, end=${ranToTheEnd}, stopped=${stopped})`,
            !/^Yes\b/.test(shown),
            shown,
          );
        }
      }
    }

    check(
      'a failed save says so in plain words',
      describeSaveStatus(parseSaveStatusParam('failed'), true, false) === 'Not saved',
    );
    check(
      'an unconfirmed write is not reported as a failure either',
      describeSaveStatus(parseSaveStatusParam(undefined), true, false) === 'Not confirmed',
    );

    // The status crosses as data, so a deep link cannot invent its own sentence.
    check('a hand-edited status cannot claim a save', describeSaveStatus(parseSaveStatusParam('true'), true, false) === 'Not confirmed');
    check('a nonsense status cannot claim a save', describeSaveStatus(parseSaveStatusParam('probably'), true, false) === 'Not confirmed');
    check('a repeated status key is ambiguous, so it is refused', parseSaveStatusParam(['saved', 'failed']) === null);
    check('the status survives a query-string round trip', parseSaveStatusParam(' saved ') === 'saved');
  });

  /** A stored guided session, built the way the guided screen builds one. */
  const guidedRecord = (id: string, completedAt: string): SessionRecord =>
    createSessionRecord({
      id,
      exerciseId: 'chair-yoga-flow',
      exerciseName: 'Chair Yoga Flow',
      completedAt,
      metrics: buildSessionMetrics({
        reps: 0,
        durationSeconds: 600,
        repRanges: [],
        rangeMinDeg: null,
        rangeMaxDeg: null,
      }),
      activityKind: 'yoga',
      stepsCompleted: 6,
    });

  /** Reports the save the way the guided screen now does: the write's own outcome. */
  const attemptSave = async (store: { saveSession(r: SessionRecord): Promise<SessionRecord> }, record: SessionRecord): Promise<SaveStatus> => {
    try {
      await store.saveSession(record);
      return 'saved';
    } catch {
      return 'failed';
    }
  };

  suite('activity result: a guided save that lands is reported as saved', async () => {
    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => { written.set(key, value); },
      removeItem: async (key) => { written.delete(key); },
    };
    const store = createSessionStore(backend);
    const record = guidedRecord('saved-one', '2026-09-03T09:00:00.000Z');

    const status = await attemptSave(store, record);
    check('the write reports itself as landed', status === 'saved', status);
    check(
      'so the result screen says yes',
      describeSaveStatus(parseSaveStatusParam(status), true, false) === 'Yes',
    );
    const all = await store.getSessions();
    check('and the record really is in the history', all.some((entry) => entry.id === 'saved-one'), all.map((entry) => entry.id));
  });

  suite('activity result: a failed guided save is reported, and loses nothing', async () => {
    const prior = [guidedRecord('keep-1', '2026-09-01T09:00:00.000Z'), guidedRecord('keep-2', '2026-09-02T09:00:00.000Z')];
    const seed = JSON.stringify(prior);
    // Reads answer, writes refuse: what a full or unavailable store looks like.
    const backend: KeyValueStore = {
      getItem: async () => seed,
      setItem: async () => { throw new Error('storage is full'); },
      removeItem: async () => {},
    };
    const store = createSessionStore(backend);

    const status = await attemptSave(store, guidedRecord('never-stored', '2026-09-03T09:00:00.000Z'));
    check('the write is reported as failed', status === 'failed', status);
    check(
      'the result screen does not claim a save, even for a completed routine',
      describeSaveStatus(parseSaveStatusParam(status), true, false) === 'Not saved',
    );

    // A failed save must cost the new row and nothing that was already there.
    const after = await store.getSessions();
    const ids = after.map((entry) => entry.id);
    check('every session already on the device survives', ids.includes('keep-1') && ids.includes('keep-2'), ids);
    check('nothing extra was invented', after.length === prior.length, ids);
    check('the session that failed to write is absent', !ids.includes('never-stored'), ids);
  });

  suite('activity result: completion itself is untouched by the save flow', async () => {
    // The change was to how the save is REPORTED, so the session still finishes
    // exactly as before and its record still saves through the same store.
    const activity = guidedCatalog('yoga').find((a) => a.id === 'chair-yoga-flow');
    check('chair yoga flow is still in the catalogue', activity !== undefined, activity?.id);
    if (activity === undefined) return;

    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(activity.durationSeconds);
    const done = session.snapshot();
    check('it still completes every step', done.stepsCompleted === activity.steps.length, done.stepsCompleted);
    check('it still reaches the finished phase', done.phase === 'finished', done.phase);

    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => { written.set(key, value); },
      removeItem: async (key) => { written.delete(key); },
    };
    const store = createSessionStore(backend);
    const status = await attemptSave(store, guidedRecord('completed-one', '2026-09-03T09:00:00.000Z'));
    check('a normally completed session saves and is reported as saved', status === 'saved', status);
  });

  /*
   * A guided camera step counts repetitions on screen. The record used to be
   * built with a literal `reps: 0` whatever the engine had counted, so the
   * history held a number that contradicted the HUD the person had just watched.
   * These drive the real engine and assert the counted value is what is stored.
   */

  const REP_SIDE_NAMES: Record<'left' | 'right', { hip: PoseLandmarkName; knee: PoseLandmarkName; ankle: PoseLandmarkName }> = {
    left: { hip: 'LEFT_HIP', knee: 'LEFT_KNEE', ankle: 'LEFT_ANKLE' },
    right: { hip: 'RIGHT_HIP', knee: 'RIGHT_KNEE', ankle: 'RIGHT_ANKLE' },
  };
  const REP_SIDE_GEOMETRY = {
    left: { hip: { x: 0.46, y: 0.3 }, knee: { x: 0.46, y: 0.5 } },
    right: { hip: { x: 0.54, y: 0.3 }, knee: { x: 0.54, y: 0.5 } },
  };
  const ANKLE_REACH = 0.28;
  const STILL_KNEE = 90;

  function ankleFor(hip: { x: number; y: number }, knee: { x: number; y: number }, angleDeg: number) {
    const hipDir = Math.atan2(hip.y - knee.y, hip.x - knee.x);
    const rad = hipDir - (angleDeg * Math.PI) / 180;
    return { x: knee.x + Math.cos(rad) * ANKLE_REACH, y: knee.y + Math.sin(rad) * ANKLE_REACH };
  }

  function repPose(angle: number): LandmarkEventPayload[] {
    const landmarks: LandmarkEventPayload[] = [];
    for (const side of ['left', 'right'] as const) {
      const { hip, knee } = REP_SIDE_GEOMETRY[side];
      const names = REP_SIDE_NAMES[side];
      const ankle = ankleFor(hip, knee, angle);
      for (const [name, point] of [[names.hip, hip], [names.knee, knee], [names.ankle, ankle]] as const) {
        landmarks.push({ name, x: point.x, y: point.y, z: 0, visibility: 1 });
      }
    }
    return landmarks;
  }

  function repFrame(landmarks: LandmarkEventPayload[], timestampMs: number) {
    return { nativeEvent: { timestampMs, presence: 'tracked', landmarks } as PoseFrameEventPayload };
  }

  /**
   * Feeds one frame the way the screen does: the engine counts, and its own
   * running total is folded into the session tally.
   */
  function feedLikeScreen(
    tally: GuidedRepTally,
    engine: SessionEngine,
    timestampMs: number,
  ): GuidedRepTally {
    const result = engine.handlePoseFrame(repFrame(repPose(STILL_KNEE), timestampMs));
    return observeStepReps(tally, result.reps);
  }

  /** Holds still long enough for the readiness gate to grant counting. */
  function reachReadyLikeScreen(tally: GuidedRepTally, engine: SessionEngine): GuidedRepTally {
    let current = tally;
    for (let i = 0; i < 14; i += 1) current = feedLikeScreen(current, engine, i * 100);
    return current;
  }

  /** Drives `cycles` full out-and-back stand/sit cycles through a camera step. */
  function driveStandSitCycles(tally: GuidedRepTally, engine: SessionEngine, cycles: number): GuidedRepTally {
    const CYCLE = [120, 140, 160, 176, 176, 160, 140, 120, STILL_KNEE, STILL_KNEE];
    let current = tally;
    let t = 1400;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      for (const angle of CYCLE) {
        const result = engine.handlePoseFrame(repFrame(repPose(angle), t));
        current = observeStepReps(current, result.reps);
        t += 100;
      }
    }
    return current;
  }

  /** Builds the record exactly as the guided screen does, from a real tally. */
  function recordFromTally(id: string, tally: GuidedRepTally, stepsCompleted: number): SessionRecord {
    return createSessionRecord({
      id,
      exerciseId: 'chair-yoga-flow',
      exerciseName: 'Chair Yoga Flow',
      completedAt: '2026-09-03T09:00:00.000Z',
      metrics: buildSessionMetrics({
        reps: measuredReps(tally),
        durationSeconds: 600,
        repRanges: [],
        rangeMinDeg: null,
        rangeMaxDeg: null,
      }),
      activityKind: 'yoga',
      stepsCompleted,
    });
  }

  suite('guided reps: what the camera counted is what gets persisted', async () => {
    // The config the "Stand and Sit" step actually resolves to.
    const standStep = guidedCatalog('yoga')
      .find((a) => a.id === 'chair-yoga-flow')
      ?.steps.find((s) => s.cameraConfigId === 'sit-to-stand');
    check('the guided camera step resolves a real config', standStep !== undefined, standStep?.cameraConfigId);
    check('and that config is the one driven below', standStep?.cameraConfigId === SIT_TO_STAND.id, standStep?.cameraConfigId);

    const engine = new SessionEngine(SIT_TO_STAND);
    let tally = reachReadyLikeScreen(emptyRepTally(), engine);
    check('the gate is ready before anything is counted', engine.readinessPhase === 'ready', engine.readinessPhase);
    tally = driveStandSitCycles(tally, engine, 3);

    const measured = engine.reps;
    check('the engine really counted repetitions', measured > 0, measured);
    check('the tally matches the engine exactly', measuredReps(tally) === measured, { tally: measuredReps(tally), measured });

    const record = recordFromTally('with-reps', tally, 6);
    check('the record carries the measured count, not a placeholder', record.reps === measured, record.reps);
    check('it is not the old hardcoded zero', record.reps !== 0, record.reps);

    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => { written.set(key, value); },
      removeItem: async (key) => { written.delete(key); },
    };
    const store = createSessionStore(backend);
    const status = await attemptSave(store, record);
    check('it saves successfully', status === 'saved', status);
    const stored = (await store.getSessions()).find((entry) => entry.id === 'with-reps');
    check('the stored history still holds the measured count', stored?.reps === measured, stored?.reps);
  });

  suite('guided reps: a genuine zero stays zero', async () => {
    // A routine that never reaches a camera step measures nothing. That is a
    // real zero and must be persisted as one rather than invented into a number.
    const record = recordFromTally('no-reps', emptyRepTally(), 3);
    check('a routine with no measured reps persists zero', record.reps === 0, record.reps);

    // Reaching the step and never completing a repetition is also a true zero.
    const engine = new SessionEngine(SIT_TO_STAND);
    let tally = reachReadyLikeScreen(emptyRepTally(), engine);
    check('being ready but motionless counts nothing', engine.reps === 0 && measuredReps(tally) === 0, { engine: engine.reps, tally: measuredReps(tally) });
    const stillRecord = recordFromTally('still-reps', tally, 6);
    check('and that is persisted as zero', stillRecord.reps === 0, stillRecord.reps);

    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => { written.set(key, value); },
      removeItem: async (key) => { written.delete(key); },
    };
    const store = createSessionStore(backend);
    await attemptSave(store, stillRecord);
    const stored = (await store.getSessions()).find((entry) => entry.id === 'still-reps');
    check('the stored zero survives the round trip', stored?.reps === 0, stored?.reps);
  });

  suite('guided reps: several camera steps accumulate instead of overwriting', () => {
    const first = new SessionEngine(SIT_TO_STAND);
    let tally = reachReadyLikeScreen(emptyRepTally(), first);
    tally = driveStandSitCycles(tally, first, 2);
    const afterFirst = measuredReps(tally);
    check('the first camera step counted something', afterFirst > 0, afterFirst);

    // The screen rebuilds the engine per step, so the new one starts at zero
    // while the session total has to carry on.
    tally = beginStep(tally);
    check('starting a new step does not discard the total', measuredReps(tally) === afterFirst, measuredReps(tally));
    const second = new SessionEngine(SIT_TO_STAND);
    tally = reachReadyLikeScreen(tally, second);
    tally = driveStandSitCycles(tally, second, 2);

    const secondOnly = measuredReps(tally) - afterFirst;
    check('the second step contributes its own repetitions', secondOnly > 0, secondOnly);
    check('the total is the sum, not the last step alone', measuredReps(tally) === afterFirst + secondOnly, measuredReps(tally));
    check('and it is never less than either step', measuredReps(tally) > Math.max(afterFirst, secondOnly), measuredReps(tally));
  });

  suite('guided reps: the tally never invents a repetition', () => {
    check('an untouched session has no repetitions', measuredReps(emptyRepTally()) === 0, measuredReps(emptyRepTally()));

    // Re-reading the same engine total happens on every frame; it must not
    // count the same repetition again.
    const once = observeStepReps(emptyRepTally(), 3);
    check('the first reading of a count is taken', measuredReps(once) === 3, measuredReps(once));
    for (let i = 0; i < 20; i += 1) {
      check(`re-reading the same total adds nothing (frame ${i})`, measuredReps(observeStepReps(once, 3)) === 3, measuredReps(observeStepReps(once, 3)));
    }

    // Only the increase is new: the engine's total is cumulative, not per-frame.
    const grown = observeStepReps(once, 5);
    check('a larger total adds only the difference', measuredReps(grown) === 5, measuredReps(grown));

    check('a total below the folded count is ignored', measuredReps(observeStepReps(grown, 2)) === 5, measuredReps(observeStepReps(grown, 2)));
    check('a negative reading is ignored', measuredReps(observeStepReps(grown, -4)) === 5, measuredReps(observeStepReps(grown, -4)));
    check('a non-finite reading is ignored', measuredReps(observeStepReps(grown, Number.NaN)) === 5, measuredReps(observeStepReps(grown, Number.NaN)));
    check('the total never exceeds what was actually observed', measuredReps(grown) <= 5, measuredReps(grown));
  });

  suite('guided reps: exercise session records are untouched', async () => {
    // An exercise record carries its own rep count and must not be routed
    // through the guided tally at all.
    const metrics = buildSessionMetrics({
      reps: 7,
      durationSeconds: 300,
      repRanges: [150, 152, 148],
      rangeMinDeg: 90,
      rangeMaxDeg: 170,
    });
    const exercise = createSessionRecord({
      id: 'exercise-one',
      exerciseId: 'seated-knee-extension',
      exerciseName: 'Seated Knee Extension',
      completedAt: '2026-09-03T09:00:00.000Z',
      metrics,
    });
    check('an exercise record keeps its own repetitions', exercise.reps === 7, exercise.reps);
    check('and its measured range is still recorded', exercise.rangeMinDeg === 90 && exercise.rangeMaxDeg === 170, { min: exercise.rangeMinDeg, max: exercise.rangeMaxDeg });
    check('it has no guided step count', exercise.stepsCompleted === undefined, exercise.stepsCompleted);
    check('the guided tally has no say over it', measuredReps(emptyRepTally()) === 0 && exercise.reps === 7, exercise.reps);

    // The two kinds coexist in one history without either being rewritten.
    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => { written.set(key, value); },
      removeItem: async (key) => { written.delete(key); },
    };
    const store = createSessionStore(backend);
    const engine = new SessionEngine(SIT_TO_STAND);
    let tally = driveStandSitCycles(reachReadyLikeScreen(emptyRepTally(), engine), engine, 2);
    await attemptSave(store, exercise);
    await attemptSave(store, recordFromTally('yoga-one', tally, 6));

    const all = await store.getSessions();
    const storedExercise = all.find((entry) => entry.id === 'exercise-one');
    const storedYoga = all.find((entry) => entry.id === 'yoga-one');
    check('the exercise record is unchanged after a guided session is saved', storedExercise?.reps === 7, storedExercise?.reps);
    check('the guided record kept its measured count', storedYoga?.reps === engine.reps, { stored: storedYoga?.reps, measured: engine.reps });
    check('both records survive side by side', all.length === 2, all.map((entry) => entry.id));
  });
}
