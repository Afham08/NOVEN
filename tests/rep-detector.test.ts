import { check, suite } from './harness';

import { RepDetector } from '../src/exercise/rep-detector';
import type { RepFrame } from '../src/exercise/types';

/**
 * The 14 original detector guarantees, re-created as durable tests, plus the
 * `freeze()` suspension contract added for tracking re-stabilization:
 * completed reps are preserved, in-progress cycles are discarded.
 */
const THRESHOLDS = {
  bentAngleDeg: 140,
  extendedAngleDeg: 160,
  minRangeDeg: 25,
  minRepIntervalMs: 700,
  holdFrames: 2,
  minVisibility: 0.4,
  maxFrameGapMs: 1000,
} as const;

const BENT = 90;
const EXTENDED = 170;

/** Bend-straighten-bend frames of a clean rep at a 100ms cadence starting at t0. */
function cleanRep(t0: number): RepFrame[] {
  const cadence = [BENT, 120, 150, EXTENDED, EXTENDED, 130, 110, BENT, BENT];
  return cadence.map((angle, i) => ({ angle, timestampMs: t0 + i * 100 }));
}

export function run(): void {
  suite('rep-detector baseline', () => {
    const detector = new RepDetector(THRESHOLDS);
    check('starts at rest and zero reps', detector.currentPhase === 'rest' && detector.completedReps === 0);
    detector.process({ angle: BENT, timestampMs: 0 });
    detector.process({ angle: BENT, timestampMs: 10 });
    check('bent frames keep the machine at rest', detector.currentPhase === 'rest' && detector.completedReps === 0);
  });

  suite('rep-detector clean rep', () => {
    const detector = new RepDetector(THRESHOLDS);
    let completed = 0;
    for (const frame of cleanRep(0)) {
      const outcome = detector.process(frame);
      if (outcome.repCompleted) completed += 1;
    }
    check('exactly one completed rep', completed === 1);
    check('detector agrees', detector.completedReps === 1);
    check('machine returns to rest', detector.currentPhase === 'rest');
    const ranges = detector.completedRanges;
    check('completed range reported', ranges.length === 1);
    check('range value is full travel', ranges[0] === EXTENDED - 90);
  });

  suite('rep-detector requires hold', () => {
    const detector = new RepDetector(THRESHOLDS);
    // Reaches extended but never holds it for 2 frames: no rep.
    //
    // The leading BENT frame is load-bearing. Without it the machine is not yet
    // armed, every angle here is above `bentAngleDeg`, and `process` discards
    // them before the state machine is ever reached — so the old series
    // (150, 170, 130, 90, 90, all at timestamp 0) passed without ever entering
    // `extending`, proving nothing about the hold. This one really does reach
    // `extending` and really does see exactly one straight frame.
    let t = 0;
    for (const angle of [BENT, 150, EXTENDED, 130, BENT, BENT]) {
      detector.process({ angle, timestampMs: (t += 100) });
    }
    check('no count without held extension', detector.completedReps === 0);
    check('phase back at rest after false start', detector.currentPhase === 'rest');
  });

  suite('rep-detector shallow cycle rejected', () => {
    const detector = new RepDetector(THRESHOLDS);
    // Full rest->extend->rest cycle but the range (163-140 = 23) never crosses
    // minRangeDeg(25): must NOT count.
    //
    // Started at exactly `bentAngleDeg` so the machine arms AND the observed
    // minimum really is 140, making the range 23. The previous series began at
    // 150 with no arming frame, so nothing was ever observed and the range guard
    // was never reached.
    let t = 0;
    for (const angle of [140, 150, 163, 163, 147, 141, 140, 140]) {
      detector.process({ angle, timestampMs: (t += 100) });
    }
    check('a 23deg cycle is rejected', detector.completedReps === 0, detector.completedReps);
    check('but the machine did run the full cycle', detector.currentPhase === 'rest', detector.currentPhase);
  });

  suite('rep-detector cooldown', () => {
    const detector = new RepDetector(THRESHOLDS);
    for (const frame of cleanRep(0)) detector.process(frame);
    check('first rep counted', detector.completedReps === 1);
    // Second rep finishes 450ms after the first: inside the 700ms cooldown.
    for (const frame of cleanRep(450)) detector.process(frame);
    check('rep inside cooldown is dropped', detector.completedReps === 1);
    check('dropped rep recorded no range', detector.completedRanges.length === 1);
  });

  suite('rep-detector second rep after cooldown', () => {
    const detector = new RepDetector(THRESHOLDS);
    for (const frame of cleanRep(0)) detector.process(frame);
    // Second rep finishes 800ms after the first: outside the cooldown.
    for (const frame of cleanRep(800)) detector.process(frame);
    check('two reps accumulate', detector.completedReps === 2);
    check('both ranges are kept', detector.completedRanges.length === 2);
  });

  suite('rep-detector NaN immunity', () => {
    const detector = new RepDetector(THRESHOLDS);
    const outcome = detector.process({ angle: Number.NaN, timestampMs: 0 });
    check('NaN frame reports no rep', outcome.repCompleted === false);
    check('NaN frame does not change phase', detector.currentPhase === 'rest');
    check('NaN frame does not count', detector.completedReps === 0);

    // A NaN inside a real cycle must not corrupt it. The leading bent frame is
    // the starting-posture precondition, so what follows is a genuinely armed
    // cycle and the NaN lands at the peak of it, where it must be ignored.
    for (const angle of [BENT, 120, 150, EXTENDED, Number.NaN, EXTENDED]) {
      detector.process({ angle, timestampMs: 1000 });
    }
    for (const angle of [130, 110, BENT, BENT]) {
      detector.process({ angle, timestampMs: 2000 });
    }
    check('NaN between frames does not corrupt the cycle', detector.completedReps === 1);
  });

  suite('rep-detector polarity', () => {
    const detector = new RepDetector(THRESHOLDS);
    // A bent->straight->bent CAPSIZED cycle (start extended, return to bent)
    // must behave like a false start, never count.
    for (const angle of [EXTENDED, 150, 120, 100, BENT]) {
      detector.process({ angle, timestampMs: 0 });
    }
    check('reverse-polarity cycle never counts', detector.completedReps === 0);
    check('machine settles at rest', detector.currentPhase === 'rest');
  });

  suite('rep-detector reset', () => {
    const detector = new RepDetector(THRESHOLDS);
    for (const frame of cleanRep(0)) detector.process(frame);
    for (const frame of cleanRep(800)) detector.process(frame);
    check('two reps before reset', detector.completedReps === 2);
    detector.reset();
    check('reset clears reps', detector.completedReps === 0);
    check('reset clears ranges', detector.completedRanges.length === 0);
    check('reset clears phase', detector.currentPhase === 'rest');
  });

  suite('rep-detector freeze preserves counted reps', () => {
    const detector = new RepDetector(THRESHOLDS);
    for (const frame of cleanRep(0)) detector.process(frame);
    detector.freeze();
    check('freeze preserves completed reps', detector.completedReps === 1);
    check('freeze preserves completed ranges', detector.completedRanges.length === 1);
    check('freeze resets machine to rest', detector.currentPhase === 'rest');

    // A fresh, legit rep after freeze counts normally.
    for (const frame of cleanRep(800)) detector.process(frame);
    check('legit rep after freeze still counts', detector.completedReps === 2);
  });

  suite('rep-detector freeze discards partial cycle', () => {
    const detector = new RepDetector(THRESHOLDS);
    // Start a cycle and leave it stuck mid-extension. The leading bent frame is
    // the starting-posture precondition; without it the machine would (correctly)
    // refuse to act on a leg that is merely already straight.
    for (const angle of [BENT, 150, EXTENDED, EXTENDED]) {
      detector.process({ angle, timestampMs: 0 });
    }
    check('detector stuck extended before freeze', detector.currentPhase === 'extended');
    detector.freeze();
    // Only bent frames after freeze: without the cleared cycle nothing completes.
    for (const angle of [BENT, BENT, BENT]) {
      detector.process({ angle, timestampMs: 100 });
    }
    check('frozen partial cycle can never complete', detector.completedReps === 0);
    check('after freeze, state rest, not extended', detector.currentPhase === 'rest');
  });

  /* ------------------------------------------------------------------ *
   * Regression: a leg that is merely ALREADY straight must not arm the
   * machine. Its absolute angle walks rest -> extending -> extended on its
   * own, and any later lowering then supplies the `returning` half of a rep
   * the user never performed — which is how sitting down counted a rep.
   * ------------------------------------------------------------------ */

  const STRAIGHT = 176;

  suite('rep-detector refuses to act on a leg that is already straight', () => {
    const detector = new RepDetector(THRESHOLDS);
    // A motionless, motionless straight leg: 40 frames, never moving.
    for (let i = 0; i < 40; i++) {
      detector.process({ angle: STRAIGHT, timestampMs: i * 100 });
    }
    check('a straight leg does not arm the machine', detector.isArmed === false);
    check('and reports rest, not extended', detector.currentPhase === 'rest', detector.currentPhase);
    check('and counts nothing', detector.completedReps === 0, detector.completedReps);
  });

  suite('rep-detector ignores the descending half of a cycle it never saw begin', () => {
    const detector = new RepDetector(THRESHOLDS);
    // Exactly the sitting-down sweep: 176deg held, then lowered to bent.
    for (let i = 0; i < 15; i++) {
      detector.process({ angle: STRAIGHT, timestampMs: i * 100 });
    }
    let t = 1500;
    for (const angle of [165, 154, 143, 133, 122, 111, 100, BENT, BENT]) {
      detector.process({ angle, timestampMs: (t += 100) });
    }
    check('lowering a never-started cycle counts nothing', detector.completedReps === 0, detector.completedReps);
    check('the knee bending down is what arms it, not a rep', detector.isArmed === true);
    check('and the machine is back at rest', detector.currentPhase === 'rest', detector.currentPhase);
  });

  suite('rep-detector an outstretched rest posture cannot settle into a rep', () => {
    const detector = new RepDetector(THRESHOLDS);
    // Resting angle inside the "extended" band, with the ankle relaxing below the
    // bent threshold and coming back — a full descend-and-return at a posture
    // that is not a rep.
    let t = 0;
    for (let i = 0; i < 14; i++) {
      detector.process({ angle: 172, timestampMs: (t += 100) });
    }
    for (let i = 0; i < 30; i++) {
      detector.process({ angle: i % 6 < 3 ? 138 : 172, timestampMs: (t += 100) });
    }
    check('settling never completes a rep', detector.completedReps === 0, detector.completedReps);
  });

  suite('rep-detector freeze disarms, so a relocation cannot complete a rep', () => {
    const detector = new RepDetector(THRESHOLDS);
    for (const frame of cleanRep(0)) detector.process(frame);
    check('a real rep counted while armed', detector.completedReps === 1, detector.completedReps);
    detector.freeze();
    check('freeze disarms the machine', detector.isArmed === false);
    // The descending half of a cycle whose ascending half is long gone.
    for (let i = 0; i < 10; i++) {
      detector.process({ angle: STRAIGHT, timestampMs: 2000 + i * 100 });
    }
    for (const angle of [133, 122, BENT, BENT]) {
      detector.process({ angle, timestampMs: 3000 + angle });
    }
    check('no rep from the descent after a freeze', detector.completedReps === 1, detector.completedReps);
  });

  suite('rep-detector a real rep is unaffected by the precondition', () => {
    // The starting posture is bent, so the machine arms on the first frame and
    // every existing behaviour is untouched.
    const detector = new RepDetector(THRESHOLDS);
    detector.process({ angle: BENT, timestampMs: 0 });
    check('a bent frame arms immediately', detector.isArmed === true);
    for (const frame of cleanRep(100)) detector.process(frame);
    check('the rep still counts', detector.completedReps === 1, detector.completedReps);
    check('at full travel', detector.completedRanges[0] === EXTENDED - 90, detector.completedRanges);
  });

  // ==========================================================================
  // The occasional MISSED genuine rep.
  //
  // `extendedAngleDeg` is an absolute band, and the exercise deliberately does
  // not require the knee to lock. A knee that only reaches ~162-165deg sits
  // right on that boundary, so pose-model jitter produces a plateau that keeps
  // dipping just under it. The `extending` state used to reset its hold counter
  // on any frame in the dead band, so `holdFrames` STRICTLY CONSECUTIVE straight
  // frames were demanded — which that plateau can never supply. The machine then
  // never reached `extended`, and the descent tripped the false-start branch,
  // which reset the cycle and threw the observed range away. Rep lost entirely.
  // ==========================================================================

  /** Feeds an angle series and returns the completed rep count. */
  function countReps(angles: number[], startMs = 0): number {
    const detector = new RepDetector(THRESHOLDS);
    let t = startMs;
    for (const angle of angles) detector.process({ angle, timestampMs: (t += 100) });
    return detector.completedReps;
  }

  suite('rep-detector a plateau straddling extendedAngleDeg is not a missed rep', () => {
    // A genuine rep whose straight phase peaks at 163 and never locks.
    const plateau = [BENT, 120, 150, 163, 158, 159, 166, 157, 158, 164, 150, 120, BENT, BENT];
    check('irregular dips under the threshold still count', countReps(plateau) === 1, countReps(plateau));

    check(
      'a plateau alternating either side of the band counts',
      countReps([BENT, 120, 150, 162, 158, 162, 158, 162, 150, 120, BENT, BENT]) === 1,
    );
    check(
      'and one a full degree either side of the band',
      countReps([BENT, 120, 150, 161, 159, 161, 159, 161, 150, 120, BENT, BENT]) === 1,
    );
    check(
      'the same shape peaking at 168 still counts exactly once',
      countReps([BENT, 120, 150, 168, 160, 168, 162, 168, 150, 120, BENT, BENT]) === 1,
    );
  });

  suite('rep-detector the tolerant hold still refuses everything it used to', () => {
    // A single straight frame is still not a held extension.
    check(
      'one straight frame at the peak is still not enough',
      countReps([BENT, 120, 150, 168, 150, 120, BENT, BENT]) === 0,
    );
    // A peak that never reaches the band is not an extension.
    check(
      'a 155deg peak never counts',
      countReps([BENT, 120, 150, 155, 150, 120, BENT, BENT]) === 0,
    );
    // Reaching the band and then genuinely aborting back to rest is a false start.
    check(
      'reaching the band then falling back to rest is not a rep',
      countReps([BENT, 120, 150, 163, 158, 130, BENT, BENT]) === 0,
    );
    // The range guard is untouched.
    check(
      'a 23deg cycle is still rejected on range',
      countReps([140, 150, 163, 163, 147, 141, 140, 140]) === 0,
    );
    // A motionless straight leg still never arms, so it can never count.
    check('a leg held straight and motionless counts nothing', countReps(new Array(40).fill(172)) === 0);
  });

  suite('rep-detector the tolerant hold does not let one movement count twice', () => {
    // A descent that rebounds past the band and comes back down is still ONE
    // cycle: the rebound re-enters `extended` rather than opening a new one.
    const detector = new RepDetector(THRESHOLDS);
    let t = 0;
    for (const angle of [BENT, 120, 150, 163, 158, 166, 150, 145, 163, 150, 120, BENT, BENT]) {
      detector.process({ angle, timestampMs: (t += 100) });
    }
    check('a rebound inside one rep is still one rep', detector.completedReps === 1, detector.completedReps);
  });

  // ==========================================================================
  // The return/rest hold — the mirror of the extension bug.
  //
  // `restHold` used to be reset by any frame between `bentAngleDeg` and
  // `extendedAngleDeg`, so completing a rep demanded `holdFrames` STRICTLY
  // CONSECUTIVE frames at or below `bentAngleDeg`.
  //
  // The bottom of a descent is a sustained posture, so this usually worked: a
  // seated knee at 90-120deg gives a long run of qualifying frames. It failed
  // when the resting knee angle settles within a few degrees of
  // `bentAngleDeg` itself — a real seated posture, a moderately open knee with
  // the feet forward. The pose estimate then jitters across 140deg and, unless
  // two consecutive frames land on the same side of it by luck, the rep is never
  // completed even though the leg plainly travelled from ~170deg to ~139deg and
  // stayed there. Scattered qualifying frames made it luck-dependent, which is
  // why it presented as an occasional miss rather than a constant one.
  // ==========================================================================

  /** Deterministic strictly-alternating jitter: never two frames on one side. */
  const alt = (centre: number, amp: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => centre + (i % 2 === 0 ? -amp : amp));
  /** Deterministic irregular noise, which does produce runs of one sign. */
  const NOISE = [0.3, -0.8, 0.6, -0.4, 0.9, -0.7, 0.2, -0.9, 0.5, -0.3, 0.8, -0.6];
  const noisy = (centre: number, amp: number, n: number): number[] =>
    NOISE.slice(0, n).map((v) => centre + v * amp);

  /** Arms, extends, then returns through the supplied descent. */
  const descent = (tail: number[]): number[] => [BENT, 120, 150, 163, 163, 163, ...tail];

  suite('rep-detector a rest posture sitting on bentAngleDeg still completes', () => {
    check(
      'strictly alternating jitter around 139deg counts',
      countReps(descent(alt(139, 4, 12))) === 1,
      countReps(descent(alt(139, 4, 12))),
    );
    check(
      'alternating jitter around 138deg with a wider swing counts',
      countReps(descent(alt(138, 5, 14))) === 1,
    );
    check(
      'alternating jitter around 135deg with a very wide swing counts',
      countReps(descent(alt(135, 8, 14))) === 1,
    );
    check(
      'irregular jitter around 139deg counts',
      countReps(descent(noisy(139, 6, 12))) === 1,
    );
    check(
      'irregular jitter around 141deg counts',
      countReps(descent(noisy(141, 4, 12))) === 1,
    );
    // The control that proves the failure was the RESTING ANGLE and not the
    // descent: the same shape continuing past the band counts either way.
    check('a descent that continues to 90deg counts', countReps(descent([150, 90, 90, 90, 90])) === 1);
    check('a descent that continues to 120deg counts', countReps(descent([150, 120, 120, 120])) === 1);
  });

  suite('rep-detector the tolerant rest hold still refuses everything it used to', () => {
    // Exactly one frame at or below bentAngleDeg in the whole descent, and the
    // leg climbs back out afterwards. Still not a completed return.
    check(
      'a single sub-140 frame never completes a rep',
      countReps(
        descent([145, 139, 150, 147, 145, 142, 146, 143, 141, 148, 145, 142, 147, 144, 146, 143, 150, 148]),
      ) === 0,
    );
    // The leg never reaches the bent band at all, so there is no return to count
    // no matter how the dead band is treated.
    check(
      'a descent that never reaches bentAngleDeg counts nothing',
      countReps(descent([150, 145, 142, 148, 144, 141, 147, 143, 145, 142, 149, 144, 146, 143, 148, 141])) === 0,
    );
    // The extension requirement is untouched: no straight phase, no rep.
    check('a cycle that never extends counts nothing', countReps([BENT, 120, 130, 125, 120, BENT, BENT]) === 0);
    // The range guard is untouched.
    check('a 23deg cycle is still rejected on range', countReps([140, 150, 163, 163, 147, 141, 140, 140]) === 0);
  });

  suite('rep-detector a rebound still discards the rest hold', () => {
    // Two sub-140 frames are seen, but the leg springs back past the extension
    // band in between. The bounce-back branch is evaluated first, so the
    // accumulated rest evidence is thrown away and the descent has to start over.
    const detector = new RepDetector(THRESHOLDS);
    let t = 0;
    for (const angle of [BENT, 120, 150, 163, 163, 163, 145, 138, 166, 150, 138, 136, 120, BENT, BENT]) {
      detector.process({ angle, timestampMs: (t += 100) });
    }
    check(
      'a rebound past the band resets the rest hold but the rep still lands once',
      detector.completedReps === 1,
      detector.completedReps,
    );
  });
}