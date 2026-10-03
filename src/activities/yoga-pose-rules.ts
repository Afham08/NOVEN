// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping.
import type { LandmarkEventPayload, PoseLandmarkName, PosePresence } from '../../modules/pose-tracker';

import { calculateAngle, getLandmark } from '../exercise/pose-utils';
import { torsoLeanFromVerticalDeg } from './meditation-guidance';
import {
  YOGA_MIN_VISIBILITY,
  yogaLandmark,
  type YogaConstraint,
  type YogaPoseRule,
  type YogaSide,
  type YogaTriplet,
} from './yoga-poses';

/**
 * ============================================================================
 * The pure pose evaluator: landmarks in, a verdict out.
 * ============================================================================
 *
 * Every function here is deterministic and takes its inputs as arguments. No
 * camera, no React, no clock, no timers, no module state. That is what lets it be
 * tested frame by frame in Node with hand-built landmark sets, and it is also what
 * stops the evaluator quietly acquiring an opinion of its own: it cannot remember
 * what it saw last time, so the verdict for a frame depends on that frame and
 * nothing else.
 *
 * WHY THREE OUTCOMES AND NOT FOUR
 * `not-tracked` | `invalid` | `valid`. Time is not this module's business - it
 * appears in `yoga-hold.ts`, where a pose that is valid has to STAY valid before
 * it counts. Keeping the separation means the geometry here can be reasoned about
 * (and tested) without mentioning a single millisecond.
 *
 * THE FIRST FAILING CHECK IS THE ONE REPORTED
 * Constraints are applied in order and evaluation stops at the first failure,
 * returning that check's own correction. Two reasons. It gives one instruction
 * instead of a list nobody can act on, and it makes the output deterministic in a
 * way that matters for the voice: as the person moves towards the pose, the
 * reported instruction changes in a fixed order rather than flickering between
 * whichever check happened to fail marginally.
 */

/** What the camera can say about a single frame. */
export type YogaPoseState = 'not-tracked' | 'invalid' | 'valid';

export type YogaPoseEvaluation = {
  state: YogaPoseState;
  /** The rule this was measured against, echoed so callers need not carry it. */
  ruleId: string;
  /** Id of the first failing constraint, or null when the pose is valid. */
  failingConstraintId: string | null;
  /** The correction sentence to show or speak, or null when there is nothing to fix. */
  correction: string | null;
  /**
   * Required landmarks that were missing, too faint, or not finite in this frame.
   *
   * Reported so the caller can tell "you are not in the pose" apart from "the
   * camera cannot see enough of you to say" - two situations that look identical
   * in the verdict, and that call for completely different words.
   */
  missingLandmarks: readonly PoseLandmarkName[];
  /** Every check, in order, with the measurement behind it. For tests and the HUD. */
  results: readonly YogaConstraintResult[];
};

export type YogaConstraintResult = {
  id: string;
  /** null when the check could not be measured at all. */
  satisfied: boolean | null;
  /** Degrees, for angle checks. null for the positional checks. */
  angleDeg: number | null;
};

/** A landmark that is present, visible enough, and finite in both axes. */
function usable(
  landmarks: readonly LandmarkEventPayload[],
  name: PoseLandmarkName,
  minVisibility: number,
): LandmarkEventPayload | undefined {
  const joint = getLandmark(landmarks, name);
  if (!joint) return undefined;
  if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y)) return undefined;
  if (joint.visibility < minVisibility) return undefined;
  return joint;
}

function midpoint(
  a: LandmarkEventPayload,
  b: LandmarkEventPayload,
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Euclidean distance between two 2D points. */
function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

function angleAt(
  landmarks: readonly LandmarkEventPayload[],
  triplet: YogaTriplet,
  side: YogaSide,
  minVisibility: number,
): number {
  const a = usable(landmarks, yogaLandmark(side, triplet.a), minVisibility);
  const b = usable(landmarks, yogaLandmark(side, triplet.b), minVisibility);
  const c = usable(landmarks, yogaLandmark(side, triplet.c), minVisibility);
  if (!a || !b || !c) return Number.NaN;
  return calculateAngle(a, b, c);
}

/**
 * Measured shoulder width, used as the yardstick for how far the arms are apart.
 *
 * A shoulder width is the natural unit here: it is a dimension of the person,
 * present in every frame that got this far, and it is the same for them at any
 * distance from the phone. Returns NaN when it cannot be read, so a collapsed or
 * unseen torso cannot be divided by.
 */
function shoulderWidth(
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number,
): number {
  const left = usable(landmarks, 'LEFT_SHOULDER', minVisibility);
  const right = usable(landmarks, 'RIGHT_SHOULDER', minVisibility);
  if (!left || !right) return Number.NaN;
  return distance(left.x, left.y, right.x, right.y);
}

/**
 * Measured torso length, the yardstick for the arm-height check.
 *
 * Same reasoning as the shoulder width: it is the person's own size in the frame,
 * so a fraction of it means the same thing whether they are near the phone or far.
 */
function torsoLength(
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number,
): number {
  const leftShoulder = usable(landmarks, 'LEFT_SHOULDER', minVisibility);
  const rightShoulder = usable(landmarks, 'RIGHT_SHOULDER', minVisibility);
  const leftHip = usable(landmarks, 'LEFT_HIP', minVisibility);
  const rightHip = usable(landmarks, 'RIGHT_HIP', minVisibility);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return Number.NaN;

  const shoulders = midpoint(leftShoulder, rightShoulder);
  const hips = midpoint(leftHip, rightHip);
  return distance(shoulders.x, shoulders.y, hips.x, hips.y);
}

function hipMidY(
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number,
): number {
  const left = usable(landmarks, 'LEFT_HIP', minVisibility);
  const right = usable(landmarks, 'RIGHT_HIP', minVisibility);
  if (!left || !right) return Number.NaN;
  return midpoint(left, right).y;
}

function shoulderMidY(
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number,
): number {
  const left = usable(landmarks, 'LEFT_SHOULDER', minVisibility);
  const right = usable(landmarks, 'RIGHT_SHOULDER', minVisibility);
  if (!left || !right) return Number.NaN;
  return midpoint(left, right).y;
}

function withinAngleBand(deg: number, minDeg: number | undefined, maxDeg: number | undefined) {
  if (!Number.isFinite(deg)) return false;
  if (minDeg !== undefined && deg < minDeg) return false;
  if (maxDeg !== undefined && deg > maxDeg) return false;
  return true;
}



/**
 * Evaluates one constraint.
 *
 * A check that cannot be measured returns `satisfied: null` rather than false.
 * That distinction matters: `false` would tell the person to change something the
 * camera never actually saw.
 */
function evaluateConstraint(
  constraint: YogaConstraint,
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number,
): YogaConstraintResult {
  switch (constraint.kind) {
    case 'torso-lean': {
      /*
       * Reused from the seated-posture guidance rather than reimplemented. It is
       * literally the same measurement - shoulder midpoint against hip midpoint -
       * and two copies of that formula could only ever drift apart over time.
       * What stays here is the threshold, which is this file's business.
       */
      const lean = torsoLeanFromVerticalDeg(landmarks, minVisibility);
      const satisfied = Number.isFinite(lean) && lean <= constraint.maxDeg;
      return { id: constraint.id, satisfied: Number.isFinite(lean) ? satisfied : null, angleDeg: lean };
    }

    case 'angle': {
      const angles: number[] = [];
      for (const side of constraint.sides) {
        angles.push(angleAt(landmarks, constraint.triplet, side, minVisibility));
      }
      /*
       * If any side is unmeasurable the check is unmeasurable. Reporting the
       * other leg as fine would mean a pose could be declared valid while the
       * camera had lost half the body it needs to judge.
       */
      if (angles.some((deg) => !Number.isFinite(deg))) {
        return { id: constraint.id, satisfied: null, angleDeg: Number.NaN };
      }
      const met = angles.map((deg) => withinAngleBand(deg, constraint.minDeg, constraint.maxDeg));
      const satisfied = constraint.mode === 'all' ? met.every(Boolean) : met.some(Boolean);
      /*
       * For `any`, the reported angle is the one that passed - the bent knee in
       * Warrior II - because that is the number a reader is asking about. The
       * single value cannot be the failing leg for the same check, so `any` mode
       * reports the closest passing measurement.
       */
      const reported =
        constraint.mode === 'any'
          ? angles[met.findIndex(Boolean)] ?? angles[0]
          : Math.min(...angles);
      return { id: constraint.id, satisfied, angleDeg: reported };
    }

    case 'below': {
      const hips = hipMidY(landmarks, minVisibility);
      if (!Number.isFinite(hips)) return { id: constraint.id, satisfied: null, angleDeg: null };
      const offsets: number[] = [];
      for (const side of constraint.sides) {
        const joint = usable(landmarks, yogaLandmark(side, constraint.point), minVisibility);
        if (!joint) return { id: constraint.id, satisfied: null, angleDeg: null };
        offsets.push(joint.y - hips);
      }
      /*
       * The image's y axis grows DOWNWARD, so a larger y is lower in the frame.
       * "Arms resting by your sides" therefore means the wrist sits BELOW the hip
       * line, which is a strictly greater y. No epsilon is applied: the hip line
       * is a real measurement and a wrist level with it is not below it.
       *
       * Checked against the hip MIDPOINT rather than the wrist's own hip, because
       * the two wrists and the two hips are all measured separately and comparing
       * each wrist to its own hip would let a person who is leaning pass by
       * matching their own lean on both sides. The midpoint is the one horizontal
       * that does not move when the person does.
       */
      const satisfied = offsets.every((offset) => offset > 0);
      return { id: constraint.id, satisfied, angleDeg: null };
    }

    case 'shoulder-height': {
      const shoulders = shoulderMidY(landmarks, minVisibility);
      const length = torsoLength(landmarks, minVisibility);
      if (!Number.isFinite(shoulders) || !Number.isFinite(length) || length === 0) {
        return { id: constraint.id, satisfied: null, angleDeg: null };
      }
      let satisfied = true;
      for (const side of constraint.sides) {
        const joint = usable(landmarks, yogaLandmark(side, constraint.point), minVisibility);
        if (!joint) return { id: constraint.id, satisfied: null, angleDeg: null };
        const offset = Math.abs(joint.y - shoulders);
        if (offset > constraint.maxOffsetRatio * length) satisfied = false;
      }
      return { id: constraint.id, satisfied, angleDeg: null };
    }

    case 'horizontal-separation': {
      const width = shoulderWidth(landmarks, minVisibility);
      if (!Number.isFinite(width) || width === 0) {
        return { id: constraint.id, satisfied: null, angleDeg: null };
      }
      const left = usable(landmarks, yogaLandmark('left', constraint.left), minVisibility);
      const right = usable(landmarks, yogaLandmark('right', constraint.right), minVisibility);
      if (!left || !right) return { id: constraint.id, satisfied: null, angleDeg: null };
      const gap = distance(left.x, left.y, right.x, right.y);
      return {
        id: constraint.id,
        satisfied: gap >= constraint.minRatio * width,
        angleDeg: null,
      };
    }

    case 'hip-to-knee-height': {
      /*
       * The frontal-view stand-in for a bent knee. See the note at the top of
       * `yoga-poses.ts`: a knee bend is mostly depth, so from the front the knee
       * ANGLE reads near-straight even when the leg is properly bent, while the
       * height of the hips does not - standing measures about 0.8 torso-lengths of
       * separation from the lower knee, and Warrior II about 0.1.
       *
       * The LOWER knee, not a named side: the app cannot know which leg the person
       * is leading with, and does not need to. One knee coming down to hip level is
       * the whole of what it is checking.
       */
      const hips = hipMidY(landmarks, minVisibility);
      const length = torsoLength(landmarks, minVisibility);
      if (!Number.isFinite(hips) || !Number.isFinite(length) || length === 0) {
        return { id: constraint.id, satisfied: null, angleDeg: null };
      }
      const knees: number[] = [];
      for (const side of ['left', 'right'] as const) {
        const knee = usable(landmarks, yogaLandmark(side, 'KNEE'), minVisibility);
        if (!knee) return { id: constraint.id, satisfied: null, angleDeg: null };
        knees.push(knee.y);
      }
      const lowerKneeY = Math.max(...knees);
      const offset = Math.abs(hips - lowerKneeY);
      return {
        id: constraint.id,
        satisfied: offset <= constraint.maxOffsetRatio * length,
        angleDeg: null,
      };
    }

    default: {
      /*
       * Exhaustiveness guard. A new constraint kind added to `yoga-poses.ts`
       * without a branch here is a compile error rather than a pose that quietly
       * never passes.
       */
      const never: never = constraint;
      void never;
      return { id: 'unknown', satisfied: null, angleDeg: null };
    }
  }
}

/**
 * Evaluates a pose rule against a single frame.
 *
 * `presence` is checked first and short-circuits everything. A pose reported over
 * a frame the model could not track would otherwise be scored from whatever
 * partial landmarks happened to be in the payload, which is the exact failure the
 * meditation guidance refuses: inventing an instruction from a frame that saw
 * nothing.
 */
export function evaluateYogaPose(
  rule: YogaPoseRule,
  presence: PosePresence,
  landmarks: readonly LandmarkEventPayload[],
  minVisibility: number = YOGA_MIN_VISIBILITY,
): YogaPoseEvaluation {
  const base = {
    ruleId: rule.id,
    failingConstraintId: null,
    correction: null,
    missingLandmarks: [],
    results: [],
  } as const;

  if (presence !== 'tracked') return { ...base, state: 'not-tracked', results: [] };

  /*
   * Every required landmark is checked up front, before any geometry runs. A pose
   * missing one of them has no verdict to give, and saying so is different from
   * saying the person is in the wrong shape.
   */
  const missing = rule.requiredLandmarks.filter(
    (name) => !usable(landmarks, name, minVisibility),
  );
  if (missing.length > 0) {
    return { ...base, state: 'not-tracked', missingLandmarks: missing, results: [] };
  }

  const results: YogaConstraintResult[] = [];
  for (const constraint of rule.constraints) {
    const result = evaluateConstraint(constraint, landmarks, minVisibility);
    results.push(result);
    if (result.satisfied === false) {
      return {
        state: 'invalid',
        ruleId: rule.id,
        failingConstraintId: constraint.id,
        correction: constraint.correction,
        missingLandmarks: [],
        results,
      };
    }
  }

  /*
   * A check that could not be measured does not pass. Anyone reaching here has
   * every required landmark, so this is only reachable if a constraint measures
   * something the required list does not cover - and answering "valid" to a
   * question the camera never managed to answer would be the wrong way to find
   * out that it can happen.
   */
  if (results.some((result) => result.satisfied !== true)) {
    const unmeasured = results.find((result) => result.satisfied === null);
    return {
      state: 'not-tracked',
      ruleId: rule.id,
      failingConstraintId: unmeasured?.id ?? null,
      correction: null,
      missingLandmarks: [],
      results,
    };
  }

  return {
    state: 'valid',
    ruleId: rule.id,
    failingConstraintId: null,
    correction: null,
    missingLandmarks: [],
    results,
  };
}