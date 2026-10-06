import { check, suite } from './harness';

import {
  BOX_BREATHING,
  BREATHING_TECHNIQUES,
  BreathCycleEngine,
  getBreathingTechnique,
  isBreathingTechniqueId,
  nextBreathAnnouncement,
  type BreathingTechnique,
  type BreathPhaseId,
} from '../src/activities/breath-cycle';
import { GuidedSession } from '../src/activities/guided-session';
import { meditationSessions } from '../src/activities/meditation';
import {
  createSessionRecord,
  parseSessionRecord,
  SESSION_HISTORY_KEY,
  type SessionRecord,
} from '../src/exercise/session-store';

/**
 * ============================================================================
 * The breathing guide: phases, boundaries, cycles, pauses, and what it may say.
 * ============================================================================
 *
 * Every test here drives the engine with timestamps it chose itself. That is the
 * point of the engine being clock-driven rather than tick-driven: the whole file is
 * deterministic, so a boundary can be checked on the millisecond it happens rather
 * than approximated by sleeping and hoping.
 */

/*
 * The last suite in this file reads the guided screen's source instead of importing
 * it, for the same reason activity-flow.test.ts does: the screen is a React Native
 * component with `@/` aliases and native-only imports, and the test build
 * deliberately excludes it. What is guarded there is the wiring — one timer, one
 * announcement per phase, one engine per step — which cannot be observed any other
 * way without a renderer.
 */
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};

const fs = require('fs') as ReturnType<typeof require>;
const nodePath = require('path') as ReturnType<typeof require>;

/** The guided screen as text. `__dirname` is the compiled test directory. */
function readScreen(): string {
  return fs.readFileSync(
    nodePath.resolve(__dirname, '../../src/components/guided/guided-activity-screen.tsx'),
    'utf8',
  );
}

/** Strips comments, so a claim in prose about the screen is not read as the screen. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The shape the catalogue's breathing step is expected to have. */
const BOX = BOX_BREATHING;

/** Box breathing runs four four-second phases, so one cycle is sixteen seconds. */
const CYCLE_MS = 16_000;
const PHASE_MS = 4_000;

/**
 * An engine started at a known instant, with the clock handed in rather than read.
 *
 * The default is a clock the test moves by hand: `at(ms)` returns a clock stuck at
 * that moment, so a test can say "two seconds later" without any of it being real
 * time. Nothing in the engine is allowed to consult a clock of its own, and this is
 * how that is enforced rather than merely intended.
 */
function rig(technique: BreathingTechnique = BOX) {
  let clockMs = 1_000_000;
  const now = () => clockMs;
  const engine = new BreathCycleEngine(technique, now);
  return {
    engine,
    /** Moves the injected clock to an absolute moment. */
    setClock: (ms: number) => {
      clockMs = ms;
    },
    /** Moves the injected clock forward by a delta. */
    advanceClock: (deltaMs: number) => {
      clockMs += deltaMs;
    },
    /** Starts the guide and returns its first reading. */
    start: (atMs = clockMs) => {
      engine.start(atMs);
      return engine.snapshot();
    },
  };
}

/**
 * Runs an engine from its start to a moment `elapsedMs` later, in one jump.
 *
 * The single-jump form is the honest way to ask "where is the breath at t?" because
 * it cannot be accused of arriving at that answer one phase at a time.
 */
function atElapsed(elapsedMs: number, technique: BreathingTechnique = BOX) {
  const { engine, setClock } = rig(technique);
  const origin = 1_000_000;
  setClock(origin);
  engine.start(origin);
  setClock(origin + elapsedMs);
  return engine.snapshot();
}

/** True when `snapshot` reports the given phase. */
function isPhase(snapshot: { phaseId: BreathPhaseId | null }, id: BreathPhaseId): boolean {
  return snapshot.phaseId === id;
}

suite('breath cycle: the Box Breathing definition', () => {
  /*
   * The technique is DATA. If it were a function or a rule engine, "four phases of
   * four seconds" would not be a thing this file could check at all, and a technique
   * could only be verified by running it.
   */
  check('box breathing has exactly four phases', BOX.phases.length === 4, BOX.phases.length);
  check(
    'in the order inhale, hold, exhale, hold',
    BOX.phases.map((p) => p.id).join(',') === 'inhale,hold-after-inhale,exhale,hold-after-exhale',
    BOX.phases.map((p) => p.id),
  );
  check('every phase lasts four seconds', BOX.phases.every((p) => p.seconds === 4), BOX.phases.map((p) => p.seconds));

  /*
   * One whole cycle is sixteen seconds, which is the number the rest of this file
   * measures every boundary against.
   */
  check('one cycle is sixteen seconds', atElapsed(0).cycleMs === CYCLE_MS, atElapsed(0).cycleMs);
  check('a cycle is the sum of its phases', atElapsed(0).cycleMs === BOX.phases.reduce((t, p) => t + p.seconds, 0) * 1000);

  /*
   * The two holds are told apart by their ids. They share a label, and they are
   * different instructions at different moments - the top of the box and the bottom
   * of it - so an id that cannot tell them apart could not be used to decide
   * whether a phase had changed.
   */
  const holds = BOX.phases.filter((p) => p.id.startsWith('hold-'));
  check('the two holds have different ids', new Set(holds.map((h) => h.id)).size === 2, holds.map((h) => h.id));
  check('and the same label, which is what the screen shows', new Set(holds.map((h) => h.label)).size === 1, holds.map((h) => h.label));
  check('every phase has a label', BOX.phases.every((p) => p.label.length > 0));

  /*
   * Phases are identified by id, never by position. An engine that walked an array
   * and reported "phase 2" would still pass every assertion in this file while being
   * unable to tell the caller anything stable, so the ids are checked as ids.
   */
  check('every phase id is stable and unique', new Set(BOX.phases.map((p) => p.id)).size === 4);
  check('the ids are the ones the type declares', BOX.phases.every((p) =>
    ['inhale', 'hold-after-inhale', 'exhale', 'hold-after-exhale'].includes(p.id),
  ), BOX.phases.map((p) => p.id));
});

suite('breath cycle: the technique registry', () => {
  check('box breathing is registered', isBreathingTechniqueId('box-breathing'));
  check('it resolves by id', getBreathingTechnique('box-breathing')?.id === 'box-breathing');
  check('an unknown technique resolves to nothing', getBreathingTechnique('coherent') === undefined);
  check('a missing one resolves to nothing', getBreathingTechnique(undefined) === undefined);
  check('a route-style array resolves on its first element', getBreathingTechnique(['box-breathing', 'x'])?.id === 'box-breathing');
  check('an invented id is not a technique id', !isBreathingTechniqueId('coherent'));
  check('a misspelled one is not either', !isBreathingTechniqueId('box-breathingg'), isBreathingTechniqueId('box-breathingg'));
  check('and it resolves to nothing rather than to box breathing', getBreathingTechnique('box-breathingg') === undefined);
  check('a non-string is not a technique id', !isBreathingTechniqueId(7));

  /*
   * One technique only. A second one would be a feature, and this phase is the
   * engine plus box breathing; the architecture has to allow the next one without
   * having any of them already.
   */
  check('box breathing is the only technique implemented', Object.keys(BREATHING_TECHNIQUES).length === 1, Object.keys(BREATHING_TECHNIQUES));
});

suite('breath cycle: initial state', () => {
  const { engine } = rig();

  check('a guide that has not started is ready', engine.snapshot().phase === 'ready', engine.snapshot().phase);
  check('and names no phase', engine.snapshot().phaseId === null, engine.snapshot().phaseId);
  check('and has no cycles', engine.snapshot().completedCycles === 0);
  check('and no time', engine.snapshot().elapsedMs === 0);
  check('and no progress', engine.snapshot().phaseProgress === 0);
  check('but it does say which technique it is', engine.snapshot().techniqueId === 'box-breathing', engine.snapshot().techniqueId);
  check('and its cycle length, so a panel has something to draw against', engine.snapshot().cycleMs === CYCLE_MS);
});

suite('breath cycle: starting', () => {
  const { engine, start, setClock } = rig();
  const first = start();

  check('the guide is running', first.phase === 'running', first.phase);
  check('it begins on the inhale', isPhase(first, 'inhale'), first.phaseId);
  check('at the very start of it', first.phaseElapsedMs === 0, first.phaseElapsedMs);
  check('with the whole phase still to go', first.phaseRemainingSeconds === 4, first.phaseRemainingSeconds);
  check('no cycles yet', first.completedCycles === 0);
  check('and no elapsed time', first.elapsedMs === 0);

  setClock(1_000_000 + 999);
  check('one second in it is still the inhale', isPhase(engine.snapshot(), 'inhale'));
  check('a second into it', engine.snapshot().phaseElapsedMs === 999, engine.snapshot().phaseElapsedMs);
  check('with no cycles', engine.snapshot().completedCycles === 0);

  setClock(1_000_000 + 1_000);
  check('at a full second the countdown steps down to three', engine.snapshot().phaseRemainingSeconds === 3, engine.snapshot().phaseRemainingSeconds);

  /*
   * Starting twice must not restart the breath. A screen that re-rendered into a
   * second `start()` would otherwise silently rewind somebody mid-inhale.
   */
  engine.start();
  check('a second start changes nothing', engine.snapshot().elapsedMs === 1_000, engine.snapshot().elapsedMs);
  check('and does not rewind the phase', engine.snapshot().phaseElapsedMs === 1_000, engine.snapshot().phaseElapsedMs);
  check('nor restart the count', engine.snapshot().completedCycles === 0);
});

suite('breath cycle: phase transitions', () => {
  check('at zero it is the inhale', isPhase(atElapsed(0), 'inhale'));
  check('at the end of the inhale it is the first hold', isPhase(atElapsed(PHASE_MS), 'hold-after-inhale'));
  check('at the end of that hold it is the exhale', isPhase(atElapsed(2 * PHASE_MS), 'exhale'));
  check('at the end of the exhale it is the second hold', isPhase(atElapsed(3 * PHASE_MS), 'hold-after-exhale'));
  check('and at the end of the cycle it is the inhale again', isPhase(atElapsed(CYCLE_MS), 'inhale'));
  check('with one cycle banked', atElapsed(CYCLE_MS).completedCycles === 1, atElapsed(CYCLE_MS).completedCycles);

  /*
   * Each phase must be entered once and left once. Read as a walk over the whole
   * cycle at 100ms, this catches a duplicate phase and a skipped one in the same
   * assertion - the two failures that a set of boundary spot-checks would miss.
   */
  const seen: BreathPhaseId[] = [];
  for (let t = 0; t < CYCLE_MS; t += 100) {
    const id = atElapsed(t).phaseId;
    if (seen[seen.length - 1] !== id) seen.push(id as BreathPhaseId);
  }
  check(
    'one walk of the cycle visits each phase exactly once, in order',
    seen.join(',') === 'inhale,hold-after-inhale,exhale,hold-after-exhale',
    seen,
  );
});

suite('breath cycle: exact boundaries', () => {
  /*
   * The boundary rule is that a moment exactly on a phase's end belongs to the NEXT
   * phase. These are the millisecond either side of every boundary in the cycle,
   * because an off-by-one here is invisible in every other test in this file.
   */
  check('at 3999ms it is still the inhale', isPhase(atElapsed(3999), 'inhale'), atElapsed(3999).phaseId);
  check('at exactly 4000ms it is the first hold', isPhase(atElapsed(4000), 'hold-after-inhale'), atElapsed(4000).phaseId);
  check('and not the inhale', !isPhase(atElapsed(4000), 'inhale'));
  check('at 4001ms it is still the hold', isPhase(atElapsed(4001), 'hold-after-inhale'));

  check('at 7999ms it is still the first hold', isPhase(atElapsed(7999), 'hold-after-inhale'));
  check('at exactly 8000ms it is the exhale', isPhase(atElapsed(8000), 'exhale'), atElapsed(8000).phaseId);
  check('at 11999ms it is still the exhale', isPhase(atElapsed(11999), 'exhale'));
  check('at exactly 12000ms it is the second hold', isPhase(atElapsed(12000), 'hold-after-exhale'), atElapsed(12000).phaseId);

  check('at 15999ms it is still the second hold', isPhase(atElapsed(15999), 'hold-after-exhale'));
  check('at exactly 16000ms the cycle has turned over', isPhase(atElapsed(16000), 'inhale'));
  check('and the cycle is counted', atElapsed(16000).completedCycles === 1);
  check('but at 15999ms it is not', atElapsed(15999).completedCycles === 0, atElapsed(15999).completedCycles);

  /*
   * Elapsed time inside a phase must never exceed the phase, and remaining time
   * must never go negative. A phase that ran to 4100ms while claiming a 4000ms
   * length would make the progress bar overflow its own track.
   */
  for (const elapsed of [0, 1, 3999, 4000, 4001, 7999, 8000, 12000, 15999, 16000]) {
    const snapshot = atElapsed(elapsed);
    check(
      `at ${elapsed}ms the phase reading stays inside its own phase`,
      snapshot.phaseElapsedMs >= 0 && snapshot.phaseElapsedMs <= PHASE_MS,
      { elapsedMs: snapshot.phaseElapsedMs },
    );
    check(
      `at ${elapsed}ms the remaining time is never negative`,
      snapshot.phaseRemainingSeconds >= 0,
      snapshot.phaseRemainingSeconds,
    );
    check(
      `at ${elapsed}ms the progress stays between nothing and all of it`,
      snapshot.phaseProgress >= 0 && snapshot.phaseProgress <= 1,
      snapshot.phaseProgress,
    );
  }

  /*
   * The countdown is rounded UP, so each number lasts a whole second: "4" is on
   * screen for the first second of the inhale rather than for its first quarter,
   * and "1" is on screen for the last second instead of nothing at all. A person
   * watching this should never see it reach zero while a phase still has time left.
   */
  check('a fresh four-second phase shows four', atElapsed(0).phaseRemainingSeconds === 4);
  check('and still shows four at 999ms, because a second has not passed', atElapsed(999).phaseRemainingSeconds === 4, atElapsed(999).phaseRemainingSeconds);
  check('it shows three at 1000ms', atElapsed(1000).phaseRemainingSeconds === 3, atElapsed(1000).phaseRemainingSeconds);
  check('two at 2000ms', atElapsed(2000).phaseRemainingSeconds === 2, atElapsed(2000).phaseRemainingSeconds);
  check('one at 3000ms', atElapsed(3000).phaseRemainingSeconds === 1, atElapsed(3000).phaseRemainingSeconds);
  check('and one at 3999ms, so it never shows a zero that is not the end', atElapsed(3999).phaseRemainingSeconds === 1, atElapsed(3999).phaseRemainingSeconds);
  check('at exactly 4000ms the phase has changed and shows four again', atElapsed(4000).phaseRemainingSeconds === 4);
  check('and no moment of the cycle shows a zero', [0, 1000, 2000, 3000, 4000, 8000, 12000, 16000].every((t) => atElapsed(t).phaseRemainingSeconds > 0));
});

suite('breath cycle: counting whole cycles', () => {
  check('an incomplete cycle counts nothing', atElapsed(0).completedCycles === 0);
  check('nor does most of one', atElapsed(CYCLE_MS - 1).completedCycles === 0, atElapsed(CYCLE_MS - 1).completedCycles);
  check('starting a cycle counts nothing', atElapsed(CYCLE_MS).completedCycles === 1);
  check('one completed cycle counts one', atElapsed(CYCLE_MS).completedCycles === 1);
  check('two completed cycles count two', atElapsed(2 * CYCLE_MS).completedCycles === 2, atElapsed(2 * CYCLE_MS).completedCycles);
  check('seven completed cycles count seven', atElapsed(7 * CYCLE_MS).completedCycles === 7);

  /*
   * The specific non-events that a cycle count is easiest to get wrong. Beginning
   * the exhale, entering the first hold and reaching three quarters of the way
   * through are all inside one cycle and must leave the count alone.
   */
  check('entering the first hold does not count a cycle', atElapsed(PHASE_MS).completedCycles === 0);
  check('entering the exhale does not count a cycle', atElapsed(2 * PHASE_MS).completedCycles === 0);
  check('entering the second hold does not count a cycle', atElapsed(3 * PHASE_MS).completedCycles === 0);
  check('nor does being most of the way through it', atElapsed(CYCLE_MS - 1).completedCycles === 0);

  /*
   * A session that ends part-way through a cycle reports the whole ones only. The
   * catalogue's breathing step is 120 seconds against a sixteen-second cycle, so this
   * is the routine's real arithmetic and not a hypothetical: it must say seven, and
   * the breath must be left where the person actually was - 120s is seven whole
   * cycles and eight seconds, which is the middle of the exhale, not the end of one.
   */
  const breathingStep = meditationSessions
    .flatMap((a) => a.steps)
    .find((s) => s.breathingTechniqueId !== undefined);
  if (breathingStep) {
    const stepMs = breathingStep.seconds * 1000;
    check('the catalogue breathing step is 120 seconds', stepMs === 120_000, stepMs);
    check(
      'and completes seven whole cycles, not a fraction of an eighth',
      atElapsed(stepMs).completedCycles === 7,
      atElapsed(stepMs).completedCycles,
    );
    check(
      'finishing part-way through a cycle leaves it part-way through, not counted',
      isPhase(atElapsed(stepMs), 'exhale'),
      atElapsed(stepMs).phaseId,
    );
    check(
      'exactly at the start of that exhale, because 120s is eight seconds into the eighth cycle',
      atElapsed(stepMs).phaseElapsedMs === 0,
      atElapsed(stepMs).phaseElapsedMs,
    );
    check(
      'and half a second later it is half a second in',
      atElapsed(stepMs + 500).phaseElapsedMs === 500,
      atElapsed(stepMs + 500).phaseElapsedMs,
    );
  } else {
    check('the catalogue has a breathing step', false);
  }
});

suite('breath cycle: large timestamp jumps', () => {
  /*
   * The realistic failure: the app was backgrounded, or a frame took seconds. A
   * step-at-a-time implementation would have to walk every phase it missed before it
   * could answer, which is slow in proportion to the delay and - if the clock ever
   * went backwards - potentially never-ending.
   */
  check('a jump of four whole phases lands back on the inhale', isPhase(atElapsed(4 * PHASE_MS + 10), 'inhale'), atElapsed(4 * PHASE_MS + 10).phaseId);
  check('a jump into a later hold finds that hold, not the phase before it', isPhase(atElapsed(5 * PHASE_MS + 10), 'hold-after-inhale'), atElapsed(5 * PHASE_MS + 10).phaseId);
  check('a jump past ten cycles counts ten', atElapsed(10 * CYCLE_MS).completedCycles === 10, atElapsed(10 * CYCLE_MS).completedCycles);
  check('and lands back on the inhale', isPhase(atElapsed(10 * CYCLE_MS), 'inhale'));

  /*
   * Five minutes in one update - the whole of the catalogue's breathing step, plus
   * change. Bounded work: the phase is found by dividing, so the answer does not
   * depend on how long the delay was.
   */
  const fiveMinutes = atElapsed(300_000);
  check('five minutes is eighteen whole cycles', fiveMinutes.completedCycles === 18, fiveMinutes.completedCycles);
  check('300000ms is twelve seconds into the nineteenth cycle', isPhase(fiveMinutes, 'hold-after-exhale'), fiveMinutes.phaseId);
  check('which is the exact start of that phase, being eight cycles of sixteen', fiveMinutes.phaseElapsedMs === 0, fiveMinutes.phaseElapsedMs);
  check('and its phase reading is still inside that phase', fiveMinutes.phaseElapsedMs < PHASE_MS, fiveMinutes.phaseElapsedMs);

  /*
   * An hour, and a time far enough in the future to be worth asking about. Both are
   * arithmetic rather than iteration, so both have to come back immediately with a
   * sane reading - there is no loop here to run away.
   */
  const anHour = atElapsed(3_600_000);
  check('an hour counts 225 whole cycles', anHour.completedCycles === 225, anHour.completedCycles);
  check('and still names a phase', anHour.phaseId !== null);
  const distant = atElapsed(1_000_000_000);
  check('a very distant moment is still a phase inside its phase', distant.phaseElapsedMs >= 0 && distant.phaseElapsedMs <= PHASE_MS, distant.phaseElapsedMs);
  check('and its cycle count is that many cycles', distant.completedCycles === Math.floor(1_000_000_000 / CYCLE_MS));

  /*
   * A clock that has gone backwards must not rewind into a negative span, and must
   * not hang. `Date.now` is a wall clock, so an NTP correction or a person
   * correcting the device's time can hand back an instant earlier than the run span
   * began.
   *
   * Both clocks are driven from one here, deliberately. The span is clamped at zero
   * in the breath, and the step clock that owns it clamps the same way, so a person
   * whose device clock jumps backwards sees the breath and the stage agree rather
   * than seeing one of them rewind alone. That agreement is the thing worth testing;
   * the clamp on its own would only be a snapshot of one number.
   */
  let sharedMs = 1_000_000;
  const fiveStage = meditationSessions.find((a) => a.id === 'five-minute-breathing');
  const stepClock = new GuidedSession(fiveStage ?? meditationSessions[0], () => sharedMs);
  const clocked = new BreathCycleEngine(BOX, () => sharedMs);
  stepClock.start();
  clocked.start();

  sharedMs += 2_000;
  check('two seconds in, both clocks agree', clocked.snapshot().elapsedMs === stepClock.snapshot().stepElapsedMs, {
    breath: clocked.snapshot().elapsedMs,
    step: stepClock.snapshot().stepElapsedMs,
  });

  sharedMs -= 60_000;
  const backwards = clocked.snapshot();
  check('a backwards clock reports no negative time', backwards.elapsedMs === 0, backwards.elapsedMs);
  check('nor a negative time inside the phase', backwards.phaseElapsedMs === 0, backwards.phaseElapsedMs);
  check('and it is still a real reading, not a broken one', backwards.phaseId === 'inhale', backwards.phaseId);
  check('with no cycles invented for the time that went backwards', backwards.completedCycles === 0, backwards.completedCycles);
  check('and the countdown still reads as a whole phase', backwards.phaseRemainingSeconds === 4, backwards.phaseRemainingSeconds);
  check('and the session clamps the same way', stepClock.snapshot().stepElapsedMs === backwards.elapsedMs, {
    breath: backwards.elapsedMs,
    step: stepClock.snapshot().stepElapsedMs,
  });

  // Time moving forwards again still works, from where it left off.
  sharedMs = 1_000_000 + 3_000;
  check('and the clock resuming is not stuck at the backwards moment', clocked.snapshot().elapsedMs === 3_000, clocked.snapshot().elapsedMs);
});

suite('breath cycle: pause', () => {
  const { engine, start, setClock, advanceClock } = rig();
  start();
  advanceClock(2_000);
  const running = engine.snapshot();

  engine.pause();
  const paused = engine.snapshot();

  check('a paused guide says so', paused.phase === 'paused', paused.phase);
  check('it stops on the phase it was in', paused.phaseId === running.phaseId, { was: running.phaseId, now: paused.phaseId });
  check('with the same time in it', paused.phaseElapsedMs === running.phaseElapsedMs, { was: running.phaseElapsedMs, now: paused.phaseElapsedMs });
  check('and the same cycles', paused.completedCycles === running.completedCycles);

  /*
   * The test that matters: thirty seconds of wall clock pass and none of it is
   * credited. Elapsed time is read as a difference, so there is nothing to
   * accumulate here and nothing that could.
   */
  advanceClock(30_000);
  const stillPaused = engine.snapshot();
  check('thirty seconds paused banks no breathing time', stillPaused.elapsedMs === running.elapsedMs, { was: running.elapsedMs, now: stillPaused.elapsedMs });
  check('the phase does not move', stillPaused.phaseId === 'inhale', stillPaused.phaseId);
  check('the time inside it does not move', stillPaused.phaseElapsedMs === running.phaseElapsedMs);
  check('no cycles are counted', stillPaused.completedCycles === 0, stillPaused.completedCycles);
  check('and it is still paused', stillPaused.phase === 'paused');

  // Pause while paused, and resume while running, both do nothing.
  engine.pause();
  check('pausing twice changes nothing', engine.snapshot().elapsedMs === running.elapsedMs);
});

suite('breath cycle: resume', () => {
  /*
   * The exact case in the brief: two seconds into the inhale, a thirty-second
   * interruption, and on resuming the inhale is still two seconds in. Not thirty-two.
   */
  const { engine, start, advanceClock } = rig();
  start();
  advanceClock(2_000);
  const before = engine.snapshot();
  engine.pause();
  advanceClock(30_000);
  engine.resume();
  const resumed = engine.snapshot();

  check('a resumed guide is running', resumed.phase === 'running', resumed.phase);
  check('it is still the same phase', resumed.phaseId === 'inhale', resumed.phaseId);
  check('still two seconds in, not thirty-two', resumed.phaseElapsedMs === before.phaseElapsedMs, { before: before.phaseElapsedMs, after: resumed.phaseElapsedMs });
  check('with no cycles credited for the pause', resumed.completedCycles === 0);
  check('and the same total breathing time', resumed.elapsedMs === 2_000, resumed.elapsedMs);

  advanceClock(1_000);
  check('and it carries on from there', engine.snapshot().phaseElapsedMs === 3_000, engine.snapshot().phaseElapsedMs);
  check('which crosses no boundary', engine.snapshot().phaseId === 'inhale');

  /*
   * Resuming across a phase boundary. The pause happens near the end of the inhale,
   * so the phase that follows the resume is a different one - and the boundary is
   * crossed by real elapsed time rather than by the pause itself.
   */
  const crossing = rig();
  crossing.start();
  crossing.advanceClock(3_900);
  crossing.engine.pause();
  crossing.advanceClock(60_000);
  crossing.engine.resume();
  crossing.advanceClock(200);
  check('a pause spanning a boundary does not cross it', crossing.engine.snapshot().phaseId === 'hold-after-inhale', crossing.engine.snapshot().phaseId);
  check('and lands 100ms into the next phase', crossing.engine.snapshot().phaseElapsedMs === 100, crossing.engine.snapshot().phaseElapsedMs);

  // Resuming while running, and while ready, both do nothing.
  const idle = rig();
  idle.engine.resume();
  check('resuming a ready guide does nothing', idle.engine.snapshot().phase === 'ready');
});

suite('breath cycle: completion is terminal', () => {
  const { engine, start, advanceClock } = rig();
  start();
  advanceClock(7 * CYCLE_MS + 1_000);
  const running = engine.snapshot();
  check('seven cycles before it is finished', running.completedCycles === 7, running.completedCycles);
  check('and it is a second into the inhale of the eighth', running.phaseId === 'inhale', running.phaseId);

  engine.complete();
  const done = engine.snapshot();
  check('a completed guide says completed', done.phase === 'completed', done.phase);
  check('it keeps the phase it was in', done.phaseId === running.phaseId, { was: running.phaseId, now: done.phaseId });
  check('and the cycles it had', done.completedCycles === 7);
  check('and its elapsed time', done.elapsedMs === running.elapsedMs);

  /*
   * The failure this guards: the engine keeps running after the step is over, so the
   * count on a screen nobody is watching quietly climbs, and a person coming back to
   * a finished session is told they did nine cycles when they did seven.
   */
  advanceClock(60_000);
  const later = engine.snapshot();
  check('a completed guide does not keep counting', later.completedCycles === 7, later.completedCycles);
  check('nor does its time move on', later.elapsedMs === done.elapsedMs, { before: done.elapsedMs, after: later.elapsedMs });
  check('nor does the phase', later.phaseId === done.phaseId);
  check('and it stays completed', later.phase === 'completed');

  engine.resume();
  check('resuming a completed guide does nothing', engine.snapshot().phase === 'completed');
  check('and moves nothing', engine.snapshot().completedCycles === 7);

  engine.complete();
  check('completing twice changes nothing', engine.snapshot().completedCycles === 7);

  /*
   * Reset is the one thing that does bring it back, because that is what starting a
   * session over is supposed to do.
   */
  engine.reset();
  check('reset returns it to ready', engine.snapshot().phase === 'ready');
  check('with no cycles', engine.snapshot().completedCycles === 0);
  check('and no time', engine.snapshot().elapsedMs === 0);
  check('and no phase', engine.snapshot().phaseId === null);
});

suite('breath cycle: correctness does not depend on how often it is read', () => {
  /*
   * The engine derives everything from one elapsed figure, so the reading rate
   * cannot change the answer. These are the two extremes: a reading every ten
   * milliseconds, and a single reading for the whole thing - and both end on the
   * same instant, so the comparison is about how they got there and not about when.
   */
  const readingsAt = (stepMs: number, untilMs: number) => {
    const { engine, setClock } = rig();
    const origin = 1_000_000;
    setClock(origin);
    engine.start(origin);
    let last = engine.snapshot();
    for (let t = stepMs; t < untilMs; t += stepMs) {
      setClock(origin + t);
      last = engine.snapshot();
    }
    setClock(origin + untilMs);
    return engine.snapshot();
  };

  for (const until of [1, 999, 4_000, 4_001, 8_000, 16_000, 33_333, 120_000]) {
    const dense = readingsAt(10, until);
    const sparse = readingsAt(2_500, until);
    const once = atElapsed(until);
    check(`at ${until}ms every reading rate agrees on the phase`, dense.phaseId === sparse.phaseId && sparse.phaseId === once.phaseId, {
      dense: dense.phaseId,
      sparse: sparse.phaseId,
      once: once.phaseId,
    });
    check(`at ${until}ms every reading rate agrees on the cycles`, dense.completedCycles === sparse.completedCycles && sparse.completedCycles === once.completedCycles, {
      dense: dense.completedCycles,
      sparse: sparse.completedCycles,
      once: once.completedCycles,
    });
    check(
      `at ${until}ms every reading rate agrees on the time in the phase`,
      dense.phaseElapsedMs === sparse.phaseElapsedMs && sparse.phaseElapsedMs === once.phaseElapsedMs,
      { dense: dense.phaseElapsedMs, sparse: sparse.phaseElapsedMs, once: once.phaseElapsedMs },
    );
  }

  /*
   * Reading the same moment repeatedly is free of consequence. A screen that
   * re-renders three times in one millisecond must not bank three periods of
   * breathing.
   */
  const { engine, setClock } = rig();
  setClock(1_000_000);
  engine.start(1_000_000);
  setClock(1_000_000 + 5_000);
  const readings = [engine.snapshot(), engine.snapshot(), engine.snapshot()];
  check('three reads of one moment agree exactly', readings.every((r) => r.elapsedMs === 5_000 && r.completedCycles === 0 && r.phaseElapsedMs === 1_000), readings[0]);
});

suite('breath cycle: a technique whose phases are not equal', () => {
  /*
   * Box breathing is the easy case - four phases of the same length. The engine has
   * to be right about a technique that is not shaped like a square, or "box
   * breathing works" would prove nothing about the arithmetic.
   *
   * Not a shipped technique and not exported: a local fixture, so this file can
   * check the general case without adding a second pattern to the catalogue.
   */
  const uneven: BreathingTechnique = {
    id: 'test-uneven',
    name: 'Uneven',
    phases: [
      { id: 'inhale', label: 'Inhale', seconds: 2 },
      { id: 'hold-after-inhale', label: 'Hold', seconds: 1 },
      { id: 'exhale', label: 'Exhale', seconds: 5 },
    ],
  };
  const UNEVEN_CYCLE = 8_000;

  check('the uneven cycle is the sum of its phases', atElapsed(0, uneven).cycleMs === UNEVEN_CYCLE, atElapsed(0, uneven).cycleMs);
  check('two seconds in it is the hold', isPhase(atElapsed(2_000, uneven), 'hold-after-inhale'), atElapsed(2_000, uneven).phaseId);
  check('three seconds in it is the exhale', isPhase(atElapsed(3_000, uneven), 'exhale'), atElapsed(3_000, uneven).phaseId);
  check('at the end of the cycle it is the inhale again', isPhase(atElapsed(UNEVEN_CYCLE, uneven), 'inhale'));
  check('and the cycle is counted once', atElapsed(UNEVEN_CYCLE, uneven).completedCycles === 1);

  /*
   * A technique with no holds at all, which is the shape a future relaxing exhale
   * pattern would have.
   */
  const noHolds: BreathingTechnique = {
    id: 'test-in-out',
    name: 'In and out',
    phases: [
      { id: 'inhale', label: 'Inhale', seconds: 4 },
      { id: 'exhale', label: 'Exhale', seconds: 6 },
    ],
  };
  check('a two-phase technique cycles every ten seconds', atElapsed(0, noHolds).cycleMs === 10_000);
  check('on the inhale at the start', isPhase(atElapsed(0, noHolds), 'inhale'));
  check('on the exhale at four seconds', isPhase(atElapsed(4_000, noHolds), 'exhale'));
  check('and back to the inhale at ten', isPhase(atElapsed(10_000, noHolds), 'inhale'));

  /*
   * A degenerate technique - a zero-length phase - must not spin the phase walk or
   * divide by zero. It is skipped, and the cycle it belongs to is still a cycle.
   */
  const withZero: BreathingTechnique = {
    id: 'test-zero',
    name: 'With a zero',
    phases: [
      { id: 'hold-after-inhale', label: 'Hold', seconds: 0 },
      { id: 'inhale', label: 'Inhale', seconds: 4 },
    ],
  };
  const zero = atElapsed(0, withZero);
  check('a zero-length phase does not break the cycle length', zero.cycleMs === 4_000, zero.cycleMs);
  check('and the zero-length phase is never the one reported', !isPhase(zero, 'hold-after-inhale'), zero.phaseId);
  check('the remaining phase is', isPhase(zero, 'inhale'), zero.phaseId);

  const empty: BreathingTechnique = { id: 'test-empty', name: 'Empty', phases: [] };
  const emptySnapshot = new BreathCycleEngine(empty, () => 0);
  emptySnapshot.start();
  check('a technique with no phases is inert rather than fatal', emptySnapshot.snapshot().phaseId === null);
  check('and reports no cycles', emptySnapshot.snapshot().completedCycles === 0);
});

suite('breath cycle: announcing each phase once', () => {
  /*
   * The rule is a pure function so it can be asked directly, without a renderer and
   * without a timer running at four hundred readings a second.
   */
  check('the first phase of a session is announced', nextBreathAnnouncement(null, 'inhale') === 'inhale');
  check('the same phase again is not', nextBreathAnnouncement('inhale', 'inhale') === null);
  check('a new phase is', nextBreathAnnouncement('inhale', 'hold-after-inhale') === 'hold-after-inhale');
  check('a guide that has not started announces nothing', nextBreathAnnouncement(null, null) === null);
  check('a finished guide announces nothing', nextBreathAnnouncement('exhale', null) === null);

  /*
   * The two holds are the whole reason this compares ids. Both are labelled "Hold",
   * so a caller keying on the label would decide the second hold of every cycle had
   * already been said.
   */
  check('the first hold is announced', nextBreathAnnouncement('inhale', 'hold-after-inhale') === 'hold-after-inhale');
  check('and so is the second, which shares its label', nextBreathAnnouncement('exhale', 'hold-after-exhale') === 'hold-after-exhale');

  /*
   * The scenario the rule exists for: a screen reading the breath four times a
   * second through a four-second inhale. Sixteen readings, one word. A missing guard
   * here is the difference between a calm session and a machine gun.
   */
  let guard: BreathPhaseId | null = null;
  const throughInhale: BreathPhaseId[] = [];
  for (let t = 0; t < 4_000; t += 250) {
    const due = nextBreathAnnouncement(guard, atElapsed(t).phaseId);
    if (due !== null) {
      throughInhale.push(due);
      guard = due;
    }
  }
  check('sixteen readings of one phase produce one announcement', throughInhale.length === 1, throughInhale);
  check('and it is that phase', throughInhale[0] === 'inhale', throughInhale[0]);
  check('re-reading the same phase after it was announced produces none', [0, 250, 500, 3_750].filter((t) => nextBreathAnnouncement(guard, atElapsed(t).phaseId) !== null).length === 0);

  /*
   * The same again across a whole cycle at that rate, which is what actually
   * happens: one announcement per phase, four per cycle, and the count never depends
   * on how many readings happened in between.
   */
  let last: BreathPhaseId | null = null;
  const spoken: BreathPhaseId[] = [];
  for (let t = 0; t < CYCLE_MS; t += 250) {
    const due = nextBreathAnnouncement(last, atElapsed(t).phaseId);
    if (due !== null) {
      spoken.push(due);
      last = due;
    }
  }
  check(
    'a whole cycle at four readings a second announces each phase exactly once',
    spoken.join(',') === 'inhale,hold-after-inhale,exhale,hold-after-exhale',
    spoken,
  );

  /*
   * A pause freezes the phase, so the guard is never even asked to suppress: the
   * guide stops changing and nothing further is said. A resume continues the same
   * phase, which is therefore also not re-announced - the person was told it a
   * moment ago and was not gone away.
   */
  const { engine, start, advanceClock } = rig();
  start();
  advanceClock(1_000);
  let lastSaid: BreathPhaseId | null = null;
  const said: BreathPhaseId[] = [];
  const say = () => {
    const due = nextBreathAnnouncement(lastSaid, engine.snapshot().phaseId);
    if (due !== null) {
      said.push(due);
      lastSaid = due;
    }
  };
  say();
  engine.pause();
  for (let i = 0; i < 40; i++) {
    advanceClock(250);
    say();
  }
  engine.resume();
  advanceClock(500);
  say();
  check('the phase is announced once before the pause', said.length === 1, said);
  check('and not again for the pause or the resume', said.length === 1, said);
  check('the phase is still the one that was announced', lastSaid === 'inhale', lastSaid);

  advanceClock(3_000);
  say();
  check('the next phase is announced when it arrives', said.length === 2, said);
  check('and it is the hold', said[1] === 'hold-after-inhale', said[1]);
});

suite('breath cycle: what the breathing guide is allowed to claim', () => {
  /*
   * NOVEN has no microphone in a meditation and no breathing signal from the camera,
   * so every word the guide can put in front of a person comes from the phase data.
   * These assertions are about the DATA, because that is the only place a claim
   * could enter: a snapshot field that described a breath as detected, counted or
   * confirmed would have to be a field, and there is none.
   */
  const snapshot = atElapsed(8_000);
  const fields = Object.keys(snapshot).sort();

  check('the snapshot says when, and how long, and nothing else', fields.every((f) => !/detect|measur|breathRate|resp|actual|verified|complian/i.test(f)), fields);
  check('it names a phase', snapshot.phaseId !== null);
  check('it names a technique', snapshot.techniqueId === 'box-breathing');

  /*
   * The labels are the words a screen and a voice put in front of somebody. All
   * three permitted ones, and nothing resembling a verdict on the person.
   */
  const labels = new Set(BOX.phases.map((p) => p.label));
  check('the only words the guide can say are the phase names', [...labels].every((l) => ['Inhale', 'Hold', 'Exhale'].includes(l)), [...labels]);
  check('no phase claims anything about the person', [...labels].every((l) => !/good|great|well done|correct|perfect|detected|keep going/i.test(l)), [...labels]);

  /*
   * The routine's own wording has to survive the same test, because it is what the
   * step announcement speaks before any phase does.
   */
  const breathing = meditationSessions
    .flatMap((a) => a.steps)
    .find((s) => s.breathingTechniqueId !== undefined);
  check('there is a breathing step to check', breathing !== undefined);
  if (breathing) {
    check('its guidance claims nothing about being detected', !/detect|camera|measur/i.test(breathing.guidance), breathing.guidance);
    check('and makes no medical or therapeutic claim', !/calm|anxiet|stress|heal|therap|reduce|lower your blood/i.test(breathing.guidance), breathing.guidance);
  }
});

suite('meditation: the breathing routine uses the guide', () => {
  const five = meditationSessions.find((a) => a.id === 'five-minute-breathing');
  check('the five minute breathing session still exists', five !== undefined);
  if (!five) return;

  const breathingSteps = five.steps.filter((s) => s.breathingTechniqueId !== undefined);
  check('it has exactly one paced step', breathingSteps.length === 1, breathingSteps.length);

  const step = breathingSteps[0];
  if (step?.breathingTechniqueId === undefined) {
    check('the paced step names a technique', false);
    return;
  }

  const technique = getBreathingTechnique(step.breathingTechniqueId);
  check('the technique it names resolves', technique !== undefined, step.breathingTechniqueId);
  check('and it is box breathing', technique?.id === 'box-breathing', technique?.id);

  /*
   * A breathing step must not be a camera step. Turning the camera on here would
   * mount a preview whose posture verdict sits next to a breath, and the two are not
   * the same measurement - nothing about a breath is visible in a torso.
   */
  check('a breathing step asks for no camera', step.cameraConfigId === undefined, step.cameraConfigId);
  check('and is not a pose-hold step', step.poseRuleId === undefined, step.poseRuleId);
  check('so it cannot be mistaken for a camera step', step.cameraConfigId === undefined && step.poseRuleId === undefined);

  /*
   * The step's own clock is still the authority for how long the stage lasts. The
   * guide has no length of its own, so it cannot finish the meditation early or
   * late; it is completed when this step ends.
   */
  check('the stage keeps the length the catalogue has always given it', step.seconds === 120, step.seconds);
  check('and the routine is still five minutes long', five.durationSeconds === 300, five.durationSeconds);
  check('with the same five stages', five.steps.length === 5, five.steps.length);

  /*
   * Driven the way the screen drives it. The screen makes a NEW engine when the
   * current step names a technique, seeds it with the step's own elapsed time, and
   * completes it when the step ends - so that is what happens here, and the
   * assertion at every point is that the breath is the step's clock read a
   * different way, never a clock of its own.
   */
  let clockMs = 1_000_000;
  const session = new GuidedSession(five, () => clockMs);
  let engine: BreathCycleEngine | null = null;

  session.start();
  check('the session starts on its settle stage', session.snapshot().stepIndex === 0, session.snapshot().stepIndex);
  check('which asks for the camera', session.snapshot().currentStep?.cameraConfigId === 'meditation-posture');
  check('and so no guide is made for it', engine === null);

  clockMs += 20_000;
  check('twenty seconds in it is the notice stage', session.snapshot().stepIndex === 1, session.snapshot().stepIndex);
  check('which also asks for no breath', session.snapshot().currentStep?.breathingTechniqueId === undefined);

  /*
   * Forty seconds in, the breathing stage begins. This is the seeding that matters:
   * the screen notices the step on a render, so the stage may already be a moment
   * old, and the engine is told when the stage actually started rather than when it
   * was noticed.
   */
  clockMs += 20_000;
  const onBreath = session.snapshot();
  check('forty seconds in it is the breathing stage', onBreath.stepIndex === 2, onBreath.stepIndex);
  check('that stage names the technique', onBreath.currentStep?.breathingTechniqueId === 'box-breathing');
  check('and the stage has just begun', onBreath.stepElapsedMs === 0, onBreath.stepElapsedMs);

  engine = new BreathCycleEngine(technique as BreathingTechnique, () => clockMs);
  engine.start(clockMs - onBreath.stepElapsedMs);
  check('so the two clocks agree from the first breath', engine.snapshot().elapsedMs === onBreath.stepElapsedMs, {
    breath: engine.snapshot().elapsedMs,
    step: onBreath.stepElapsedMs,
  });
  check('and it opens on the inhale', isPhase(engine.snapshot(), 'inhale'));

  /*
   * Read the stage every quarter second for a whole stage, exactly as the screen
   * does on a breathing step, and confirm on every one of them that the breath is
   * the step's own number. Nearly five hundred readings, all of them agreeing.
   */
  let mismatches = 0;
  let sawExhale = false;
  let lastPhase: BreathPhaseId | null = null;
  const phasesSeen: BreathPhaseId[] = [];
  for (let t = 0; t < 120_000; t += 250) {
    clockMs = 1_040_000 + t;
    const reading = session.snapshot();
    const breathing = (engine as BreathCycleEngine).snapshot();
    if (breathing.elapsedMs !== reading.stepElapsedMs) mismatches += 1;
    if (breathing.phaseId === 'exhale') sawExhale = true;
    if (breathing.phaseId !== null && breathing.phaseId !== lastPhase) {
      lastPhase = breathing.phaseId;
      phasesSeen.push(breathing.phaseId);
    }
  }
  check('every reading of the stage agreed with the breath', mismatches === 0, mismatches);
  check('and every phase of the cycle came round', sawExhale);
  /*
   * Thirty four-second phases fit in the stage - seven and a half turns of the box -
   * and each must be reported once as it begins. Reading four times a second, a
   * duplicated phase would show up here as thirty-one entries or a repeat, and a
   * skipped one as twenty-nine.
   */
  check('thirty phases came round in a 120 second stage', phasesSeen.length === 30, phasesSeen.length);
  const order = BOX.phases.map((p) => p.id);
  check(
    'and every one of them was in the order the technique declares',
    phasesSeen.every((id, i) => id === order[i % order.length]),
    phasesSeen,
  );
  check('beginning on the inhale', phasesSeen[0] === 'inhale', phasesSeen[0]);
  check('stopping in the hold the stage actually ended in', phasesSeen[phasesSeen.length - 1] === 'hold-after-inhale', phasesSeen[phasesSeen.length - 1]);

  clockMs = 1_040_000 + 20_000;
  check('twenty seconds into the stage the two clocks still agree', engine.snapshot().elapsedMs === session.snapshot().stepElapsedMs, {
    breath: engine.snapshot().elapsedMs,
    step: session.snapshot().stepElapsedMs,
  });
  check('which is one whole cycle behind it', engine.snapshot().completedCycles === 1, engine.snapshot().completedCycles);
  check('and four seconds into the first hold of the second cycle', isPhase(engine.snapshot(), 'hold-after-inhale'), engine.snapshot().phaseId);

  /*
   * The stage ends at 120 seconds with the guide mid-phase. Finishing the guide is
   * the screen's job when the stage does, and the frozen reading is the phase the
   * person was actually in - the exhale, half of a cycle short of eight.
   */
  clockMs = 1_040_000 + 120_000;
  const endOfStage = session.snapshot();
  check('the stage is over', endOfStage.stepIndex === 3, endOfStage.stepIndex);
  check('and the next one asks for no breath', endOfStage.currentStep?.breathingTechniqueId === undefined);
  check('and the breath agrees it is over', engine.snapshot().elapsedMs === 120_000, engine.snapshot().elapsedMs);

  /*
   * For exactly this one reading the two clocks are not the same number, and that is
   * the whole design: the stage has moved on to the next one, whose elapsed time is
   * zero, while the guide is still holding the phase the person was in. What
   * resolves it is the screen completing the guide, and nothing else - which is why
   * `complete()` has to be called on this reading rather than a frame later.
   */
  check('the next stage starts its own count at zero', endOfStage.stepElapsedMs === 0, endOfStage.stepElapsedMs);

  engine.complete();
  check('the guide is frozen at seven cycles', engine.snapshot().completedCycles === 7, engine.snapshot().completedCycles);
  check('still in the exhale it was in', engine.snapshot().phaseId === 'exhale', engine.snapshot().phaseId);
  check('and is completed', engine.snapshot().phase === 'completed');

  /*
   * And the session itself decides when the whole meditation is over, not the guide:
   * 120 seconds into a five-minute session, the session is a quarter done.
   */
  check('the guide did not finish the activity', session.snapshot().finished === false);
  clockMs += 40_000;
  check('and it has not finished it a minute later either', session.snapshot().finished === false, session.snapshot().elapsedSeconds);
  clockMs = 1_000_000 + 300_000;
  check('the session finishes on its own clock', session.snapshot().finished === true, session.snapshot().elapsedSeconds);
  check('having run every stage', session.snapshot().stepsCompleted === 5, session.snapshot().stepsCompleted);
  check('and the guide did not get the credit for it', session.snapshot().elapsedSeconds === 300);
});

suite('meditation: the other sessions are untouched', () => {
  /*
   * One session gained a paced stage. Nothing else may have changed: the other two
   * must keep their ids, their stages and their lengths, because a person who has
   * done them before is entitled to find them the same.
   */
  const ids = meditationSessions.map((a) => a.id);
  check('there are still three meditation sessions', meditationSessions.length === 3, ids);
  check('one minute of calm is still there', ids.includes('one-minute-calm'), ids);
  check('the ten minute body scan is still there', ids.includes('ten-minute-body-scan'), ids);
  check('and the five minute breathing session', ids.includes('five-minute-breathing'), ids);

  const calm = meditationSessions.find((a) => a.id === 'one-minute-calm');
  const scan = meditationSessions.find((a) => a.id === 'ten-minute-body-scan');
  check('one minute of calm is still sixty seconds', calm?.durationSeconds === 60, calm?.durationSeconds);
  check('and still has its three stages', calm?.steps.length === 3, calm?.steps.length);
  check('the body scan is still ten minutes', scan?.durationSeconds === 600, scan?.durationSeconds);
  check('and still has its five stages', scan?.steps.length === 5, scan?.steps.length);

  /*
   * Neither of them gained a paced stage. A breathing guide in the body scan would
   * be a different session from the one the catalogue describes.
   */
  for (const id of ['one-minute-calm', 'ten-minute-body-scan']) {
    const activity = meditationSessions.find((a) => a.id === id);
    check(`${id} paces no breath`, activity?.steps.every((s) => s.breathingTechniqueId === undefined) === true);
  }

  /*
   * The camera stages are unchanged, which is the other half of keeping the posture
   * tracker honest: it still runs where it did and nowhere else.
   */
  const cameraStages = meditationSessions.flatMap((a) =>
    a.steps.filter((s) => s.cameraConfigId !== undefined).map((s) => s.cameraConfigId),
  );
  check('every camera stage is still the posture config', cameraStages.every((id) => id === 'meditation-posture'), cameraStages);
  check('one per session, still', cameraStages.length === 3, cameraStages.length);
  check('and none of them is a breathing stage', meditationSessions.every((a) => a.steps.every((s) => !(s.cameraConfigId !== undefined && s.breathingTechniqueId !== undefined))));
});

suite('the guided screen drives the guide', () => {
  const source = readScreen();
  const words = code(source);

  /*
   * The screen asks "which kind of step is this?" in exactly one place, beside the
   * other two, and a breathing step is the kind that needs no camera. If the
   * technique were resolved anywhere else, the answer could differ between the panel
   * and the camera gate.
   */
  check('the screen resolves the technique from the current step', /currentTechnique = getBreathingTechnique\(snapshot\.currentStep\?\.breathingTechniqueId\)/.test(words));
  check('beside the camera and pose kinds, in the same place', /const currentStepConfig[\s\S]{0,900}const currentPoseRule[\s\S]{0,900}const currentTechnique/.test(words));
  check('a breathing step is not a camera step', /const isCameraStep = currentStepConfig !== undefined \|\| isPoseStep/.test(words));
  check('and the camera is gated on that alone', /const showCameraPreview =\s*isCameraStep/.test(words));
  check('the preview needs the camera kind before anything else', /isCameraStep &&\s*running/.test(words));

  /*
   * One timer. A second interval on this screen would be a second opinion about what
   * time it is, and the two would drift; this asserts there is exactly one, and that
   * changing its length is all the breathing does to it.
   */
  const intervals = words.match(/setInterval\(/g) ?? [];
  check('the screen sets up exactly one interval', intervals.length === 1, intervals.length);
  check('and the breathing changes only its length', /setInterval\(tick, isBreathingStep \? BREATH_TICK_MS : SESSION_TICK_MS\)/.test(words));
  check('a breathing step asks four times a second', /const BREATH_TICK_MS = 250;/.test(words));
  check('and everything else still asks once a second', /const SESSION_TICK_MS = 1000;/.test(words));

  /*
   * The once-per-phase guard has to be the pure function, because that is the only
   * part of this that is decided by how often the screen asks rather than by the
   * clock. Keying it on anything else would re-announce a four-second inhale.
   */
  check('the announcement goes through the pure rule', /const phaseId = nextBreathAnnouncement\(\s*announcedBreathPhaseRef\.current,\s*breath\?\.phaseId \?\? null,?\s*\)/.test(words));
  check('and nothing is spoken when it returns nothing', /if \(!running \|\| phaseId === null\) return;/.test(words));
  check('the guard records the phase before speaking it', /announcedBreathPhaseRef\.current = phaseId;/.test(words));
  check('the guard is keyed on the phase id', /useRef<BreathPhaseId \| null>\(null\)/.test(words));
  check('and the spoken text is the phase word alone', /consider\('ready', breath\?\.label \?\? ''\)/.test(words));
  check('the voice is the existing controller', /voiceRef\.current\?\.consider/.test(words));

  /*
   * The guide is tied to the session's lifecycle rather than to the screen's own
   * state: it is completed when the step ends and when the session finishes, and it
   * is paused and resumed with the session.
   */
  check('the session decides when the guide is finished', /if \(snapshot\.finished\) \{\s*engine\.complete\(\);/.test(words));
  check('and pausing the session pauses the breath', /\} else \{\s*engine\.pause\(\);/.test(words));
  check('and resuming resumes it', /engine\.resume\(\);/.test(words));
  check('a guide left behind by an unstarted session is started when it begins', /if \(engine\.snapshot\(\)\.phase === 'ready'\) engine\.start\(\);/.test(words));
  check('and the guide is finished when the step is over', /engine\.complete\(\);\s*\};/.test(words));

  /*
   * The panel. What it shows is the whole of what the guide knows: which technique,
   * which phase, how long is left in it, how far through it, and how many whole
   * cycles. Nothing that would need a measurement to say.
   */
  check('the panel names the technique', /breath\.techniqueName\.toUpperCase\(\)/.test(words));
  check('names the phase', /\{breath\.label\}/.test(words));
  check('counts the phase down', /\{breath\.phaseRemainingSeconds\}/.test(words));
  check('fills a bar through it', /width: `\$\{breath\.phaseProgress \* 100\}%`/.test(words));
  check('counts the whole cycles', /\{breath\.completedCycles\}/.test(words));
  check('and labels it in the singular when there is one', /breath\.completedCycles === 1 \? 'cycle' : 'cycles'/.test(words));
  check('the panel is shown only for a technique step with a phase', /isBreathingStep && breath !== null && breath\.phaseId !== null/.test(words));
  check('the countdown is announced to a screen reader as words', /accessibilityLabel=\{`\$\{breath\.label\}, \$\{breath\.phaseRemainingSeconds\} \$\{/.test(words));
  check('and says how many are left rather than a bare number', /\? 'second' : 'seconds'[\s\S]{0,40}\} left`\}/.test(words));

  /*
   * Where the panel sits, which is not a matter of taste. A breathing step has no
   * camera, so anything inside the camera preview slot would never render at all -
   * the preview is gated on the camera being needed and running - and the panel is
   * therefore in the body, under the step it belongs to.
   */
  const previewAt = words.indexOf('showCameraPreview && (');
  const previewEnd = words.indexOf('{isCameraStep && running && !hasCameraPermission');
  const panelAt = words.indexOf('styles.breathBlock');
  const stepCardAt = words.indexOf('styles.stepGuidance');
  const listAt = words.indexOf('title="What you will do"');
  check('the screen does gate the camera preview on the camera being needed', previewAt >= 0 && previewEnd > previewAt, { previewAt, previewEnd });
  check('the panel is rendered once', words.match(/styles\.breathBlock/g)?.length === 1, words.match(/styles\.breathBlock/g)?.length);
  check('and it is not inside that preview', previewAt >= 0 && panelAt > previewEnd, { panelAt, previewEnd });
  check('it is in the body, under the step it belongs to', stepCardAt > 0 && panelAt > stepCardAt, { stepCardAt, panelAt });
  check('and above the list of what comes next', listAt > 0 && panelAt < listAt, { panelAt, listAt });
});

suite('meditation: a paced session is still recorded the same way', () => {
  /*
   * The persistence question. Cycle count is not written anywhere: `SessionRecord`
   * has no field for it, and this phase adds none. What the record already carries -
   * the kind, the instant, the stages run - is unchanged by the guide, which is the
   * point: a breathing session is a meditation like any other and is saved like one.
   */
  const five = meditationSessions.find((a) => a.id === 'five-minute-breathing');
  if (!five) {
    check('the breathing session exists', false);
    return;
  }

  const record: SessionRecord = createSessionRecord({
    id: 'breathing-session-1',
    exerciseId: five.id,
    exerciseName: five.name,
    completedAt: '2026-05-04T09:00:00.000Z',
    metrics: {
      reps: 0,
      durationSeconds: five.durationSeconds,
      paceRpm: null,
      rangeMinDeg: null,
      rangeMaxDeg: null,
      consistencyPct: null,
    },
    activityKind: five.kind,
    stepsCompleted: five.steps.length,
  });

  check('it uses the existing history key', SESSION_HISTORY_KEY === 'noven.session-history.v1');
  const parsed = parseSessionRecord(JSON.parse(JSON.stringify(record)));
  check('it survives the round trip through storage', parsed !== null);
  check('keeping its id', parsed?.id === 'breathing-session-1');
  check('keeping its kind as a meditation', parsed?.activityKind === 'meditation', parsed?.activityKind);
  check('keeping the instant it finished', parsed?.completedAt === '2026-05-04T09:00:00.000Z');
  check('keeping every stage it ran', parsed?.stepsCompleted === 5, parsed?.stepsCompleted);
  check('and inventing no repetitions', parsed?.reps === 0, parsed?.reps);

  /*
   * No breathing field reached the record. This is asserted as an absence on purpose:
   * the honest place for a cycle count is a session the person can look at, and the
   * schema does not grow in this phase.
   */
  const fields = Object.keys(parsed ?? {});
  check('and no breathing field was added to it', !fields.some((f) => /breath|cycle|phase/i.test(f)), fields);

  /*
   * And the guard against writing it twice is the screen's existing one: a session
   * that has been recorded is not recorded again by the next reading.
   */
  check('the saved record is a plain session record', fields.includes('reps') && fields.includes('durationSeconds') && fields.includes('activityKind'), fields);
});

export function run(): void {
  // Suites self-register through `suite(...)` as they are declared.
}