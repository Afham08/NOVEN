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
    for (const angle of [150, EXTENDED, 130, BENT, BENT]) {
      detector.process({ angle, timestampMs: 0 });
    }
    check('no count without held extension', detector.completedReps === 0);
    check('phase back at rest after false start', detector.currentPhase === 'rest');
  });

  suite('rep-detector shallow cycle rejected', () => {
    const detector = new RepDetector(THRESHOLDS);
    // Full rest->extend->rest cycle but the range (163-140 = 23) never crosses
    // minRangeDeg(25): must NOT count.
    for (const angle of [150, 163, 163, 147, 141, 140, 140]) {
      detector.process({ angle, timestampMs: 0 });
    }
    check('sub-range cycle never counts', detector.completedReps === 0);
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
}