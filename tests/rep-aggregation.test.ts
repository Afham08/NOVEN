import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName, PosePresence } from '../modules/pose-tracker';
import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { SessionEngine } from '../src/exercise/session-engine';
import type { Side } from '../src/exercise/types';

/**
 * Regression coverage for the "one physical rep counted as two" bug, and for the
 * session-level aggregation rule that fixes it.
 *
 * THE BUG
 * -------
 * Seated Knee Extension is filmed from the SIDE ("Sit sideways to the camera").
 * In a side view the two legs are separated along the camera's optical axis
 * rather than across the image, so they project almost on top of each other. The
 * occluded leg has no direct visual evidence, so the pose model infers its
 * hip / knee / ankle from body priors and the visible leg — which makes the far
 * leg's derived 2D angle track the near leg's almost exactly.
 *
 * The result: one physical extension produced a valid-looking full cycle in
 * BOTH detectors, and `left.completedReps + right.completedReps` counted the
 * single movement twice. Measured before the fix: one extension produced a
 * 79.42deg range on the left and an 80.00deg range on the right — the same
 * movement measured twice, not two movements.
 *
 * These tests are built around that model of the failure, so they fail if the
 * aggregation rule is ever removed or weakened. Nothing here weakens rep
 * detection to make a test pass: the genuine-rep tests (single leg, alternating
 * legs, shallow-movement rejection) are asserted with the SAME thresholds and
 * must keep working.
 */

type XY = { x: number; y: number };
type AngleSpec = number | 'aliased';

const SIDE_NAMES: Record<Side, { hip: PoseLandmarkName; knee: PoseLandmarkName; ankle: PoseLandmarkName }> = {
  left: { hip: 'LEFT_HIP', knee: 'LEFT_KNEE', ankle: 'LEFT_ANKLE' },
  right: { hip: 'RIGHT_HIP', knee: 'RIGHT_KNEE', ankle: 'RIGHT_ANKLE' },
};

/**
 * SIDE-VIEW geometry. The two hips are only 0.003 apart in x and the two knees
 * 0.004, because the legs are separated in depth, not across the image.
 */
const HIP: Record<Side, XY> = {
  left: { x: 0.5, y: 0.3 },
  right: { x: 0.503, y: 0.302 },
};
const KNEE: Record<Side, XY> = {
  left: { x: 0.5, y: 0.5 },
  right: { x: 0.504, y: 0.506 },
};

/**
 * Where the model places the occluded leg's inferred landmarks relative to the
 * visible leg's projected positions. Deliberately NOT identical for the hip and
 * for the knee/ankle, so the far leg's angle tracks the near leg's with a couple
 * of degrees of error instead of being an exact copy — which is what real
 * inference noise looks like, and what makes this a realistic regression test.
 */
const ALIAS_HIP = { x: 0.002, y: 0.003 };
const ALIAS_LEG = { x: 0.004, y: 0.006 };

function ankleFor(hip: XY, knee: XY, angleDeg: number): XY {
  const hdir = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const rad = hdir - (angleDeg * Math.PI) / 180;
  return { x: knee.x + Math.cos(rad) * 0.28, y: knee.y + Math.sin(rad) * 0.28 };
}

type PoseOpts = { visibility?: number; omit?: PoseLandmarkName[]; nan?: PoseLandmarkName[] };

/**
 * Builds a side-view pose.
 *
 * A number sets that leg's true knee angle. `'aliased'` makes that leg's
 * landmarks track the other leg's — the occluded-limb behaviour described
 * above — so both detectors see the same physical movement.
 */
function sideViewPose(spec: Record<Side, AngleSpec>, opts: PoseOpts = {}): LandmarkEventPayload[] {
  const visibility = opts.visibility ?? 0.9;
  const omit = new Set(opts.omit ?? []);
  const nan = new Set(opts.nan ?? []);

  // The aliased side(s) are defined relative to the explicitly-given side.
  const source = (spec.left === 'aliased' ? 'right' : 'left') as Side;
  const sourceAngle = spec[source] as number;
  const sourceHip = HIP[source];
  const sourceKnee = KNEE[source];
  const sourceAnkle = ankleFor(sourceHip, sourceKnee, sourceAngle);

  const out: LandmarkEventPayload[] = [];
  for (const side of ['left', 'right'] as const) {
    const aliased = spec[side] === 'aliased';
    const hip = aliased ? { x: sourceHip.x + ALIAS_HIP.x, y: sourceHip.y + ALIAS_HIP.y } : HIP[side];
    const knee = aliased ? { x: sourceKnee.x + ALIAS_LEG.x, y: sourceKnee.y + ALIAS_LEG.y } : KNEE[side];
    const ankle = aliased
      ? { x: sourceAnkle.x + ALIAS_LEG.x, y: sourceAnkle.y + ALIAS_LEG.y }
      : ankleFor(HIP[side], KNEE[side], spec[side] as number);

    for (const [name, p] of [
      [SIDE_NAMES[side].hip, hip],
      [SIDE_NAMES[side].knee, knee],
      [SIDE_NAMES[side].ankle, ankle],
    ] as const) {
      if (omit.has(name)) continue;
      const broken = nan.has(name);
      out.push({ name, x: broken ? Number.NaN : p.x, y: broken ? Number.NaN : p.y, z: 0, visibility, presence: 1 });
    }
  }
  return out;
}

function frame(
  landmarks: LandmarkEventPayload[],
  timestampMs: number,
  presence: PosePresence = 'tracked',
): { nativeEvent: PoseFrameEventPayload } {
  return { nativeEvent: { timestampMs, presence, landmarks } as PoseFrameEventPayload };
}

/** One clean rep: bent -> extending -> extended (held) -> returning -> rest. */
const REP = [120, 150, 170, 170, 130, 110, 90, 90];
const REST = 90;

/** Feeds still frames until the readiness gate grants counting. */
function reachReady(engine: SessionEngine, startMs = 0): number {
  return reachReadyAt(engine, REST, startMs);
}

/** As reachReady, but settles the legs at a specific resting angle. */
function reachReadyAt(engine: SessionEngine, angle: number, startMs = 0): number {
  let t = startMs;
  for (let i = 0; i < 14; i++) {
    engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: angle }), t));
    t += 100;
  }
  return t;
}

/**
 * Drives one rep on `side` (the other leg held still).
 *
 * `completionAtMs` is the timestamp of the frame that actually counted the rep,
 * which is what the session cooldown is measured from.
 */
function repOn(side: Side, engine: SessionEngine, startMs: number, stepMs = 100) {
  let t = startMs;
  let completions = 0;
  let completionAtMs: number | null = null;
  for (const angle of REP) {
    const spec: Record<Side, AngleSpec> = { left: REST, right: REST };
    spec[side] = angle;
    if (engine.handlePoseFrame(frame(sideViewPose(spec), t)).repCompletedThisFrame) {
      completions += 1;
      completionAtMs = t;
    }
    t += stepMs;
  }
  return { endMs: t, completions, completionAtMs };
}

/** Feeds a rep cycle on `side` whose completion lands on `completeAtMs`. */
function timedRepOn(side: Side, engine: SessionEngine, completeAtMs: number) {
  // The completion happens on the 8th and final frame of the cadence.
  let t = completeAtMs - (REP.length - 1);
  let completions = 0;
  for (const angle of REP) {
    const spec: Record<Side, AngleSpec> = { left: REST, right: REST };
    spec[side] = angle;
    if (engine.handlePoseFrame(frame(sideViewPose(spec), t)).repCompletedThisFrame) completions += 1;
    t += 1;
  }
  return { completions, completionAtMs: completeAtMs };
}

/** Drives one rep where the occluded leg's landmarks track the moving one. */
function aliasedRep(
  engine: SessionEngine,
  startMs: number,
  moving: Side,
  lagFrames = 0,
  stepMs = 100,
): { endMs: number; completions: number } {
  let t = startMs;
  let completions = 0;
  const history: number[] = [];
  for (const angle of REP) {
    const spec: Record<Side, AngleSpec> = { left: REST, right: REST };
    spec[moving] = angle;
    // The inferred far leg lags the visible one by `lagFrames` frames.
    spec[moving === 'left' ? 'right' : 'left'] = lagFrames === 0 ? 'aliased' : history[history.length - 1 - lagFrames] ?? REST;
    if (engine.handlePoseFrame(frame(sideViewPose(spec), t)).repCompletedThisFrame) completions += 1;
    history.push(angle);
    t += stepMs;
  }
  return { endMs: t, completions };
}

export function run(): void {
  /* --------------------------------- 1/2. one leg, one rep -------------- */

  suite('aggregation: one physical left-leg extension is exactly one rep', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    check('gate ready', engine.readinessPhase === 'ready', engine.readinessPhase);
    const { completions } = repOn('left', engine, t);
    check('one completion event', completions === 1, completions);
    check('one rep counted', engine.reps === 1, engine.reps);
    check('one range recorded', engine.repRanges.length === 1, engine.repRanges);
  });

  suite('aggregation: one physical right-leg extension is exactly one rep', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    const { completions } = repOn('right', engine, t);
    check('one completion event', completions === 1, completions);
    check('one rep counted', engine.reps === 1, engine.reps);
  });

  /* ------------------------------- 3/7. the double-count itself --------- */

  suite('aggregation: REGRESSION one extension with a correlated far leg is one rep', () => {
    // This is the physical-device failure: the user moved ONE knee, but the
    // occluded leg's inferred landmarks tracked it, so both detectors completed.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    const { completions } = aliasedRep(engine, t, 'left');
    check('only one completion event', completions === 1, completions);
    check('only one rep counted', engine.reps === 1, engine.reps);
    check('ranges match the rep count', engine.repRanges.length === engine.reps, engine.repRanges);
  });

  suite('aggregation: REGRESSION the same is true for the other leg', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    const { completions } = aliasedRep(engine, t, 'right');
    check('only one completion event', completions === 1, completions);
    check('only one rep counted', engine.reps === 1, engine.reps);
  });

  suite('aggregation: REGRESSION a far leg lagging the real one is still one rep', () => {
    // Real inference is smoothed, so the occluded leg typically completes a frame
    // or two AFTER the visible one rather than on the same frame.
    for (const lag of [1, 2, 3]) {
      const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
      const t = reachReady(engine);
      const { completions } = aliasedRep(engine, t, 'left', lag);
      check(`lag of ${lag} frame(s) -> 1 rep`, engine.reps === 1, engine.reps);
      check(`lag of ${lag} frame(s) -> 1 completion`, completions === 1, completions);
    }
  });

  suite('aggregation: REGRESSION repeated aliased extensions never inflate', () => {
    // Five physical extensions in a row, far leg correlated throughout. This is
    // the "I did five and it said ten" case.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    for (let i = 0; i < 5; i++) {
      t = aliasedRep(engine, t + 2000, i % 2 === 0 ? 'left' : 'right').endMs;
    }
    check('five physical reps -> five counted', engine.reps === 5, engine.reps);
    check('one range per rep', engine.repRanges.length === 5, engine.repRanges.length);
  });

  /* ------------------------------- 4/5. one event per rep -------------- */

  suite('aggregation: one completed rep never emits two completion events', () => {
    // Count, across three correlated reps, how many individual frames reported a
    // completion. The collapsed second sighting must not raise the flag, or the
    // HUD and the voice would both announce a rep that never happened.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    let completionFrames = 0;
    for (let i = 0; i < 3; i++) {
      for (const angle of REP) {
        const s: Record<Side, AngleSpec> = { left: angle, right: 'aliased' };
        if (engine.handlePoseFrame(frame(sideViewPose(s), t)).repCompletedThisFrame) completionFrames += 1;
        t += 100;
      }
      t += 2000;
    }
    check('exactly one completion frame per rep', completionFrames === 3, completionFrames);
    check('and three reps', engine.reps === 3, engine.reps);
  });

  suite('aggregation: a detector cannot rep without a whole new cycle', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = repOn('left', engine, t).endMs;
    check('one rep so far', engine.reps === 1, engine.reps);

    // Sit still at rest for 200 frames. Nothing may be counted.
    for (let i = 0; i < 200; i++) {
      engine.handlePoseFrame(frame(sideViewPose({ left: REST, right: REST }), t));
      t += 100;
    }
    check('still one rep after sitting still', engine.reps === 1, engine.reps);
  });

  /* ---------------------------------- 6. noise ------------------------- */

  suite('aggregation: noise around the extended threshold adds no reps', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = repOn('left', engine, t).endMs;
    check('one rep so far', engine.reps === 1, engine.reps);

    // Hold the leg oscillating +/-3deg around the 160deg extension threshold.
    // This is the classic boundary-chatter case.
    for (let i = 0; i < 300; i++) {
      const noisy = 160 + (i % 2 === 0 ? 3 : -3);
      engine.handlePoseFrame(frame(sideViewPose({ left: noisy, right: REST }), t));
      t += 100;
    }
    check('threshold chatter adds no rep', engine.reps === 1, engine.reps);

    // And the same, with the far leg correlated: chatter on both sides.
    const both = new SessionEngine(SEATED_KNEE_EXTENSION);
    let u = reachReady(both);
    u = repOn('left', both, u).endMs;
    for (let i = 0; i < 300; i++) {
      const noisy = 160 + (i % 2 === 0 ? 3 : -3);
      const s: Record<Side, AngleSpec> = { left: noisy, right: 'aliased' };
      both.handlePoseFrame(frame(sideViewPose(s), u));
      u += 100;
    }
    check('correlated chatter adds no rep either', both.reps === 1, both.reps);
  });

  suite('aggregation: noise around the bent threshold adds no reps', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    // Oscillate across the 140deg rest threshold without ever truly extending.
    for (let i = 0; i < 300; i++) {
      const jitter = 138 + (i % 2 === 0 ? 4 : -4);
      engine.handlePoseFrame(frame(sideViewPose({ left: jitter, right: REST }), t));
      t += 100;
    }
    check('rest-threshold jitter counts nothing', engine.reps === 0, engine.reps);
  });

  /* ------------------------------ 8. genuine alternation --------------- */

  suite('aggregation: alternating genuine reps still count every one', () => {
    // The aggregation rule must not cost a real rep. Alternating legs a couple
    // of seconds apart is exactly how the exercise is meant to be performed.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    const order: Side[] = ['left', 'right', 'left', 'right', 'left', 'right'];
    for (const side of order) {
      t = repOn(side, engine, t + 2000).endMs;
    }
    check('all six alternating reps counted', engine.reps === 6, engine.reps);
    check('one range per rep', engine.repRanges.length === 6, engine.repRanges.length);
  });

  suite('aggregation: six reps on the same leg all count', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    for (let i = 0; i < 6; i++) {
      t = repOn('left', engine, t + 2000).endMs;
    }
    check('six reps counted', engine.reps === 6, engine.reps);
  });

  /* -------------------- 9. shallow-movement rejection preserved -------- */

  suite('aggregation: a shallow movement is still rejected', () => {
    // The detector's observed range spans the WHOLE cycle including the resting
    // angle, so to exercise minRangeDeg (25) the leg has to settle just under the
    // bent threshold (140) and only creep to the extended threshold (160) — a
    // 22deg range, which is not a rep.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReadyAt(engine, 138);
    for (const angle of [138, 141, 160, 160, 141, 138, 138, 138]) {
      engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: 138 }), t));
      t += 100;
    }
    check('shallow cycle counts nothing', engine.reps === 0, engine.reps);

    // A genuine deep rep immediately afterwards still counts: the rejection is
    // specific to the shallow cycle, not a latched failure.
    t = repOn('left', engine, t + 2000).endMs;
    check('a real rep after a rejected one counts', engine.reps === 1, engine.reps);
  });

  suite('aggregation: a shallow movement is not counted on either leg', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReadyAt(engine, 138);
    for (const angle of [138, 141, 160, 160, 141, 138, 138, 138]) {
      const s: Record<Side, AngleSpec> = { left: angle, right: 'aliased' };
      engine.handlePoseFrame(frame(sideViewPose(s), t));
      t += 100;
    }
    check('shallow cycle counts nothing even when correlated', engine.reps === 0, engine.reps);
  });

  suite('aggregation: a deep movement from the same posture is a real rep', () => {
    // The control for the suite above: same resting posture, but a full-range
    // cycle. This proves the rejection above is the range rule doing its job and
    // not the posture being uncountable.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReadyAt(engine, 138);
    for (const angle of [138, 150, 170, 170, 150, 138, 138, 138]) {
      engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: 138 }), t));
      t += 100;
    }
    check('a 32deg cycle from the same posture counts', engine.reps === 1, engine.reps);
  });

  /* ----------------------------- 10. cooldown preserved --------------- */

  suite('aggregation: the per-leg cooldown still rejects an immediate re-count', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = repOn('left', engine, t).endMs;
    check('first rep counted', engine.reps === 1, engine.reps);

    // A second full cycle on the SAME leg starting immediately: the detector's
    // own 700ms cooldown rejects it, independently of the session rule.
    const startT = t;
    for (const angle of [...REP, ...REP]) {
      engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: REST }), startT));
      engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: REST }), startT + 1));
    }
    check('no immediate second rep', engine.reps === 1, engine.reps);
  });

  suite('aggregation: a rep after the cooldown window does count', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = repOn('left', engine, t).endMs;
    t = repOn('left', engine, t + 5000).endMs;
    check('two well-separated reps counted', engine.reps === 2, engine.reps);
  });

  /* ------------------ interaction with the existing safeguards ---------- */

  suite('aggregation: tracking loss still prevents completion', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    for (const angle of [120, 150, 170, 170]) {
      engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: 'aliased' }), t));
      t += 100;
    }
    engine.handlePoseFrame(frame(sideViewPose({ left: 170, right: 'aliased' }), t, 'lost'));
    t += 100;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(sideViewPose({ left: REST, right: 'aliased' }), t));
      t += 100;
    }
    check('no rep survived the loss', engine.reps === 0, engine.reps);
  });

  suite('aggregation: pause mid-rep prevents a phantom completion', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = repOn('left', engine, t).endMs;
    check('one rep before the pause', engine.reps === 1, engine.reps);

    // Start another rep, then pause partway through it.
    for (const angle of [120, 150, 170, 170]) {
      engine.handlePoseFrame(frame(sideViewPose({ left: angle, right: 'aliased' }), t));
      t += 100;
    }
    engine.pause();
    // The lowering frames are dropped while paused, as the screen does.
    t = repOn('left', engine, t + 5000).endMs;
    check('exactly one new rep after resume', engine.reps === 2, engine.reps);

    // And a correlated far leg must not smuggle in an extra one either.
    t = aliasedRep(engine, t + 2000, 'left').endMs;
    check('still only three in total', engine.reps === 3, engine.reps);
  });

  suite('aggregation: invalid landmarks cannot complete a rep', () => {
    // The broken leg itself can never complete a rep: with no usable angle there
    // is nothing for its detector to see, whatever the other leg does.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    for (const angle of REP) {
      engine.handlePoseFrame(
        frame(sideViewPose({ left: angle, right: REST }, { nan: ['LEFT_ANKLE'] }), t),
      );
      t += 100;
    }
    check('a NaN frame on the moving leg counts nothing', engine.reps === 0, engine.reps);

    // Same defect with the far leg aliased, so the far leg's landmarks track the
    // near leg's. That side is fully readable, so it may legitimately report the
    // movement; what must never happen is the broken leg adding a SECOND rep for
    // the one physical extension.
    const aliased = new SessionEngine(SEATED_KNEE_EXTENSION);
    let at = reachReady(aliased);
    for (const angle of REP) {
      aliased.handlePoseFrame(
        frame(sideViewPose({ left: angle, right: 'aliased' }, { nan: ['LEFT_ANKLE'] }), at),
      );
      at += 100;
    }
    check('the broken leg never doubles the rep', aliased.reps === 1, aliased.reps);
  });

  suite('aggregation: low visibility cannot complete a rep', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    for (const angle of REP) {
      engine.handlePoseFrame(
        frame(sideViewPose({ left: angle, right: 'aliased' }, { visibility: 0.1 }), t),
      );
      t += 100;
    }
    check('an invisible rep counts nothing', engine.reps === 0, engine.reps);
  });

  suite('aggregation: reset clears the session tally and its cooldown', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = repOn('left', engine, t).endMs;
    check('one rep before reset', engine.reps === 1, engine.reps);

    engine.reset();
    check('reps cleared', engine.reps === 0, engine.reps);
    check('ranges cleared', engine.repRanges.length === 0, engine.repRanges.length);
    check('gate back to waiting', engine.readinessPhase === 'waiting', engine.readinessPhase);

    // The very first rep of a fresh session counts even at t=0, i.e. the
    // cooldown must not be inherited from the previous session.
    t = reachReady(engine, 100_000);
    t = repOn('left', engine, t).endMs;
    check('fresh session counts from zero', engine.reps === 1, engine.reps);
  });

  suite('aggregation: end() freezes the final count', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    t = aliasedRep(engine, t, 'left').endMs;
    const finalReps = engine.reps;
    check('one rep before end', finalReps === 1, finalReps);

    engine.end();
    check('end preserves the count', engine.reps === 1, engine.reps);
    aliasedRep(engine, t + 1000, 'right');
    check('frames after end add nothing', engine.reps === 1, engine.reps);
  });

  suite('aggregation: the rule is a session cooldown, not a per-side one', () => {
    // Documented intent check: minRepIntervalMs says "ignore a new rep that
    // finishes within this window of the last one". That is a statement about the
    // SESSION, and before the fix it was only enforced per detector — which is
    // exactly how one movement got counted twice.
    const { minRepIntervalMs } = SEATED_KNEE_EXTENSION.thresholds;

    // CONTROL: the same right-leg cycle, with no preceding rep, must count. This
    // proves the cycle below is a genuine full rep, so suppressing it is the
    // session window doing its job and not a vacuous test.
    const control = new SessionEngine(SEATED_KNEE_EXTENSION);
    const ct = reachReady(control);
    timedRepOn('right', control, ct + minRepIntervalMs - 1);
    check('control: the same cycle counts on its own', control.reps === 1, control.reps);

    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    const countedAt = repOn('left', engine, t).completionAtMs as number;
    check('the first rep counted', engine.reps === 1, engine.reps);

    // The identical cycle, now landing 1ms INSIDE the window of the first rep.
    timedRepOn('right', engine, countedAt + minRepIntervalMs - 1);
    check('inside the window it is the same movement', engine.reps === 1, engine.reps);

    // Comfortably past the window it is a genuine second rep. It has to clear
    // BOTH cooldowns: the session window measured from the first counted rep, and
    // the right detector's own window measured from the cycle it just completed
    // (even though that one was collapsed). Hence the wider gap.
    timedRepOn('right', engine, countedAt + minRepIntervalMs + 800);
    check('past both windows it counts', engine.reps === 2, engine.reps);
  });

  suite('aggregation: the window is measured from the last COUNTED rep', () => {
    // A collapsed completion must not push the window forward, or a burst of
    // correlated sightings could keep suppressing the user's genuine next rep.
    const { minRepIntervalMs } = SEATED_KNEE_EXTENSION.thresholds;
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    const countedAt = repOn('left', engine, t).completionAtMs as number;

    // Collapsed right-leg completion well inside the window.
    timedRepOn('right', engine, countedAt + 100);
    check('collapsed, still one rep', engine.reps === 1, engine.reps);

    // A genuine left rep just after the window must still count.
    const genuine = timedRepOn('left', engine, countedAt + minRepIntervalMs + 50);
    check('the genuine rep raised a completion event', genuine.completions === 1, genuine.completions);
    check('total is two', engine.reps === 2, engine.reps);
  });
}
