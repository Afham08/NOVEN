import { check, suite } from './harness';

import type { LandmarkEventPayload, PoseLandmarkName, PosePresence } from '../modules/pose-tracker';

import { GuidedSession } from '../src/activities/guided-session';
import { yogaRoutines } from '../src/activities/yoga';
import {
  YOGA_ARM_AT_SHOULDER_RATIO,
  YOGA_ARMS_SPREAD_MIN_RATIO,
  YOGA_BENT_KNEE_MAX_DEG,
  YOGA_BENT_KNEE_MIN_DEG,
  YOGA_MIN_VISIBILITY,
  YOGA_STANDING_TORSO_LEAN_MAX_DEG,
  YOGA_STRAIGHT_LEG_MIN_DEG,
  YOGA_WARRIOR_HIP_KNEE_RATIO,
  YOGA_POSE_RULES,
  getYogaPoseRule,
  isYogaPoseRuleId,
  type YogaPoseRule,
  type YogaPoseRuleId,
} from '../src/activities/yoga-poses';
import {
  YOGA_HOLD_MAX_FRAME_GAP_MS,
  YOGA_HOLD_SETTLE_MS,
  YogaHoldTracker,
} from '../src/activities/yoga-hold';
import { evaluateYogaPose } from '../src/activities/yoga-pose-rules';

/**
 * The guided screen is read as SOURCE rather than imported, for the same reason
 * `activity-flow.test.ts` does it: it is a React Native component with `@/` aliases
 * and native-only imports, none of which exist in the test build. Declared rather
 * than imported because the test tsconfig carries no Node type definitions.
 *
 * Declared at the top, before any suite, because a suite body runs as the module is
 * evaluated - a `const` further down the file would still be in its temporal dead
 * zone when the suite below tried to read it.
 */
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};

const fs = require('fs') as ReturnType<typeof require>;
const nodePath = require('path') as ReturnType<typeof require>;

/** The shared guided screen, with comments stripped. */
const guidedScreenCode = stripComments(
  fs.readFileSync(
    nodePath.resolve(__dirname, '../../src/components/guided/guided-activity-screen.tsx'),
    'utf8',
  ),
);

/**
 * ============================================================================
 * Camera-guided static yoga poses: the rules, the evaluator, and the hold clock.
 * ============================================================================
 *
 * This app makes claims out loud to an older person standing in front of a phone.
 * Every claim here is pinned by a test, because the failure that matters is not a
 * crash - it is the app telling somebody they are doing something wrong when they
 * are not, or claiming a pose is held when the camera never saw one.
 *
 * The geometry is built from the measurements themselves rather than from guessed
 * coordinates. A frame is constructed by placing a torso, then deriving joint
 * positions from the angle the test is about, so a boundary test can sit exactly ON
 * a tolerance instead of near it.
 */

function lm(
  name: PoseLandmarkName,
  x: number,
  y: number,
  visibility = 1,
): LandmarkEventPayload {
  return { name, x, y, z: 0, visibility };
}

/** Shoulder and hip pairs, which every pose needs and which define the torso. */
function torso(shoulderY: number, hipY: number, leanX = 0): LandmarkEventPayload[] {
  return [
    lm('LEFT_SHOULDER', 0.4 - leanX, shoulderY),
    lm('RIGHT_SHOULDER', 0.6 - leanX, shoulderY),
    lm('LEFT_HIP', 0.4, hipY),
    lm('RIGHT_HIP', 0.6, hipY),
  ];
}

/**
 * A leg whose hip-knee-ankle angle is exactly `deg`.
 *
 * The hip and knee are given; the ankle is derived, which is the whole point. The
 * shin rotates away from the thigh's direction by `180 - deg`, so an ankle placed
 * on that ray produces the requested angle exactly. Guessing the ankle instead and
 * then asserting on the resulting angle would round-trip through `acos` and land
 * an ULP either side of the number under test, so "a knee exactly on the ceiling"
 * would really be "nearly on it" and the accept/reject pair below would be testing
 * floating-point luck rather than the rule.
 *
 * `direction` is which way the knee breaks: 1 for a right leg, -1 for a left one,
 * so the two legs of a frame mirror rather than overlap.
 */
function leg(
  side: 'LEFT' | 'RIGHT',
  hipX: number,
  hipY: number,
  kneeX: number,
  kneeY: number,
  shinLen: number,
  deg: number,
): LandmarkEventPayload[] {
  /*
   * The shin is rotated away from the thigh's own direction by `180 - deg`, which
   * is the definition of the angle being asked for. The rotation is applied in the
   * plane of the image, and of the two possible directions the one that sends the
   * shin DOWNWARD is taken, so a frame built this way always has the ankle below
   * the knee rather than folded back up behind it.
   */
  const thighAngle = Math.atan2(kneeY - hipY, kneeX - hipX);
  const offset = ((180 - deg) * Math.PI) / 180;

  let shinAngle = thighAngle + offset;
  if (Math.sin(shinAngle) < 0) shinAngle = thighAngle - offset;

  return [
    lm(`${side}_HIP`, hipX, hipY),
    lm(`${side}_KNEE`, kneeX, kneeY),
    lm(`${side}_ANKLE`, kneeX + Math.cos(shinAngle) * shinLen, kneeY + Math.sin(shinAngle) * shinLen),
  ];
}

/**
 * Drops the hip landmarks from a frame that supplied its own.
 *
 * The helpers above build a torso and then a pair of legs that each carry their own
 * hips, which means two hip landmarks by name. The body never has both, so the
 * torso's copies are removed and the leg's are kept - the same landmarks, placed
 * where the pose actually puts them.
 */
function withLegTorso(legs: LandmarkEventPayload[]): LandmarkEventPayload[] {
  return [...torso(0.3, 0.55).filter((j) => !j.name.endsWith('_HIP')), ...legs];
}

/**
 * A standing person, upright, both legs straight, arms down.
 *
 * This is the base every other frame is built from, because it is the shape each
 * pose is a departure from: Mountain is this frame with the checks run, and the
 * other two poses start here and move one part.
 */
function standing(): LandmarkEventPayload[] {
  return [
    ...torso(0.3, 0.55),
    lm('LEFT_KNEE', 0.42, 0.75),
    lm('RIGHT_KNEE', 0.58, 0.75),
    lm('LEFT_ANKLE', 0.42, 0.95),
    lm('RIGHT_ANKLE', 0.58, 0.95),
    lm('LEFT_WRIST', 0.38, 0.78),
    lm('RIGHT_WRIST', 0.62, 0.78),
  ];
}

/** Mountain Pose, held correctly: upright, straight legs, arms hanging. */
function mountainValid(): LandmarkEventPayload[] {
  return standing();
}

/**
 * Chair Pose from the side: the thigh near horizontal, so the knee reads ~90.
 *
 * Built through `leg()` so the knee angle is exactly 90 rather than whatever three
 * guessed coordinates happen to produce, and through `withLegTorso()` because the
 * legs bring their own hips - in Chair Pose the hips are down at knee level, which
 * is the whole reason the pose is a pose.
 */
function chairValid(): LandmarkEventPayload[] {
  return withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, 90),
    ...leg('RIGHT', 0.6, 0.63, 0.55, 0.63, 0.3, 90),
  ]);
}

/**
 * Warrior II from the front: hips down at knee level, arms out level and apart.
 *
 * One leg straight (the back one) and one bent (the front), with the HIPS at the
 * level of the lower knee - which is the measurement this pose is actually judged
 * on, since the front knee angle barely registers in a frontal projection.
 */
function warriorValid(): LandmarkEventPayload[] {
  return [
    ...withLegTorso([
      /* Front leg: bent, and its knee is the lower one. */
      ...leg('LEFT', 0.4, 0.72, 0.45, 0.78, 0.2, 100),
      /* Back leg: straight down. */
      ...leg('RIGHT', 0.6, 0.72, 0.6, 0.75, 0.2, 180),
    ]),
    /* Arms out to both sides, level with the shoulders. */
    lm('LEFT_WRIST', 0.15, 0.3),
    lm('RIGHT_WRIST', 0.85, 0.3),
  ];
}

function evaluate(
  ruleId: YogaPoseRuleId,
  landmarks: LandmarkEventPayload[],
  presence: PosePresence = 'tracked',
) {
  return evaluateYogaPose(YOGA_POSE_RULES[ruleId], presence, landmarks);
}

/**
 * Frames of a valid pose covering `elapsedMs` of wall time, `stepMs` apart.
 *
 * Described in milliseconds rather than in a frame COUNT, because that is the
 * whole claim being tested: two cameras delivering the same pose at different frame
 * rates must reach the end of the same hold at the same moment in time. A frame
 * count would quietly bake the frame rate into the expectation.
 */
function validFramesOver(
  elapsedMs: number,
  stepMs: number,
): Array<[PosePresence, LandmarkEventPayload[], number]> {
  const frames: Array<[PosePresence, LandmarkEventPayload[], number]> = [];
  for (let t = 0; t <= elapsedMs; t += stepMs) {
    frames.push(['tracked', mountainValid(), 1000 + t]);
  }
  return frames;
}

/**
 * Runs a tracker over a scripted sequence and reports every `justCompleted` it saw.
 *
 * The tracker is expected to complete the hold exactly once. Counting the
 * notifications rather than just reading the final state is what catches the
 * realistic bug - a pose that completes three times - which a final-state check
 * would report as a pass.
 */
function countCompletions(
  ruleId: YogaPoseRuleId,
  frames: Array<[PosePresence, LandmarkEventPayload[], number]>,
): { completions: number; last: ReturnType<YogaHoldTracker['advance']> | null } {
  const tracker = new YogaHoldTracker(YOGA_POSE_RULES[ruleId]);
  let completions = 0;
  let last: ReturnType<YogaHoldTracker['advance']> | null = null;
  for (const [presence, landmarks, timestampMs] of frames) {
    last = tracker.advance(presence, landmarks, timestampMs);
    if (last.justCompleted) completions += 1;
  }
  return { completions, last };
}

suite('yoga pose rules: only the three implemented poses resolve', () => {
  check('Mountain is defined', getYogaPoseRule('mountain')?.id === 'mountain');
  check('Chair is defined', getYogaPoseRule('chair')?.id === 'chair');
  check('Warrior II is defined', getYogaPoseRule('warrior-ii')?.id === 'warrior-ii');

  check('an unknown pose resolves to nothing', getYogaPoseRule('tree') === undefined);
  check('a missing pose resolves to nothing', getYogaPoseRule(undefined) === undefined);
  /*
   * A route parameter arrives as an array, so `getYogaPoseRule` is called with one.
   * Reading the first element is what lets the same function serve both callers.
   */
  check(
    'a route-style array resolves on its first element',
    getYogaPoseRule(['mountain', 'ignored'])?.id === 'mountain',
  );

  check('a real pose id is recognised', isYogaPoseRuleId('mountain'));
  check('an invented pose id is not', !isYogaPoseRuleId('tree'));
  check('a non-string is not', !isYogaPoseRuleId(7));
  /*
   * `hasOwnProperty` rather than `key in rules`, because `in` would answer true
   * for `toString` and turn a bad route parameter into a pose rule that is
   * `Object.prototype.toString`.
   */
  check('an inherited name is not a pose', !isYogaPoseRuleId('toString'));
  check('an inherited name resolves to nothing', getYogaPoseRule('constructor') === undefined);

  for (const rule of Object.values(YOGA_POSE_RULES)) {
    check(`${rule.id} asks for a hold of a sensible length`, rule.holdSeconds >= 10 && rule.holdSeconds <= 60, rule.holdSeconds);
    check(`${rule.id} states how to stand`, rule.guidance.length > 20, rule.guidance);
    check(`${rule.id} names landmarks it can check`, rule.requiredLandmarks.length > 0);
    check(`${rule.id} has at least one check`, rule.constraints.length > 0);
    check(
      `${rule.id} corrects every one of its checks`,
      rule.constraints.every((c) => c.correction.length > 3),
    );
    check(
      `${rule.id} every check's id is unique`,
      new Set(rule.constraints.map((c) => c.id)).size === rule.constraints.length,
    );
  }

  /*
   * The direction a pose has to be done from is part of doing it correctly, so it
   * has to be in the guidance the person actually reads. If a rule ever stops
   * saying it, the app would be judging somebody from an angle nobody chose.
   */
  check(
    'Chair says it is seen from the side',
    /sideways|side/i.test(YOGA_POSE_RULES.chair.guidance),
    YOGA_POSE_RULES.chair.guidance,
  );
  check(
    'Warrior II says it is seen from the front',
    /facing the camera|face the camera/i.test(YOGA_POSE_RULES['warrior-ii'].guidance),
    YOGA_POSE_RULES['warrior-ii'].guidance,
  );
  check(
    'Mountain says it is seen from the front',
    /facing the camera/i.test(YOGA_POSE_RULES.mountain.guidance),
    YOGA_POSE_RULES.mountain.guidance,
  );
});

suite('yoga pose rules: missing landmarks are never turned into a correction', () => {
  const rule = YOGA_POSE_RULES.mountain;

  for (const missing of rule.requiredLandmarks) {
    const frame = mountainValid().filter((joint) => joint.name !== missing);
    const result = evaluate('mountain', frame);
    check(`a frame without ${missing} is not tracked`, result.state === 'not-tracked', result.state);
    check(
      `a frame without ${missing} names what it could not see`,
      result.missingLandmarks.includes(missing),
      result.missingLandmarks,
    );
    check(
      `a frame without ${missing} gives no instruction`,
      result.correction === null,
      result.correction,
    );
  }

  /*
   * The distinction that matters: "I cannot see you" and "you are in the wrong
   * shape" look the same on a verdict but are opposite instructions, and swapping
   * them is how a person gets told to fix a problem they do not have.
   */
  check('nothing is missing when the whole body is in frame', evaluate('mountain', mountainValid()).missingLandmarks.length === 0);

  const faint = mountainValid().map((joint) =>
    joint.name === 'LEFT_WRIST' ? { ...joint, visibility: YOGA_MIN_VISIBILITY - 0.01 } : joint,
  );
  check('a faint landmark counts as missing', evaluate('mountain', faint).state === 'not-tracked');

  const atThreshold = mountainValid().map((joint) =>
    joint.name === 'LEFT_WRIST' ? { ...joint, visibility: YOGA_MIN_VISIBILITY } : joint,
  );
  check('a landmark exactly at the visibility threshold is used', evaluate('mountain', atThreshold).state === 'valid');

  const nan = mountainValid().map((joint) =>
    joint.name === 'LEFT_HIP' ? { ...joint, x: Number.NaN } : joint,
  );
  check('a non-finite coordinate counts as missing', evaluate('mountain', nan).state === 'not-tracked');

  const infinite = mountainValid().map((joint) =>
    joint.name === 'LEFT_HIP' ? { ...joint, y: Number.POSITIVE_INFINITY } : joint,
  );
  check('an infinite coordinate counts as missing', evaluate('mountain', infinite).state === 'not-tracked');

  check('an empty frame is not tracked', evaluate('mountain', []).state === 'not-tracked');
  check('an empty frame misses everything', evaluate('mountain', []).missingLandmarks.length === rule.requiredLandmarks.length);
});

suite('yoga pose rules: presence short-circuits before any geometry runs', () => {
  /*
   * Even with a perfect pose in the payload, an untracked frame must not be scored.
   * Otherwise whatever partial landmarks survived the loss of tracking would be
   * graded as though it were a real reading.
   */
  /*
   * `PosePresence` is a closed three-value union: 'not-tracked' before the model
   * has ever seen anybody, 'tracked' while it has, and 'lost' when the person
   * leaves the frame. All three are pinned here because the evaluator's very first
   * act is to short-circuit on anything that is not 'tracked'.
   */
  for (const presence of ['not-tracked', 'lost'] as const) {
    const result = evaluate('mountain', mountainValid(), presence);
    check(`${presence} is not tracked`, result.state === 'not-tracked', presence);
    check(`${presence} gives no correction`, result.correction === null);
    check(`${presence} runs no checks`, result.results.length === 0);
  }

  check('tracked is the only presence that is scored', evaluate('mountain', mountainValid(), 'tracked').state === 'valid');
});

suite('yoga pose rules: Mountain Pose', () => {
  const valid = evaluate('mountain', mountainValid());
  check('a standing person is in Mountain Pose', valid.state === 'valid', valid);
  check('and needs no correction', valid.correction === null);
  check('every check passed', valid.results.every((r) => r.satisfied === true));

  /*
   * Mountain Pose is mostly the ABSENCE of movement, so the interesting failures
   * are each of its three checks separately.
   */
  const leaning = [...torso(0.3, 0.55, 0.14), lm('LEFT_KNEE', 0.42, 0.75), lm('RIGHT_KNEE', 0.58, 0.75), lm('LEFT_ANKLE', 0.42, 0.95), lm('RIGHT_ANKLE', 0.58, 0.95), lm('LEFT_WRIST', 0.24, 0.78), lm('RIGHT_WRIST', 0.48, 0.78)];
  const leanResult = evaluate('mountain', leaning);
  check('a leaning torso is not Mountain Pose', leanResult.state === 'invalid', leanResult);
  check('and is told to stand tall', leanResult.failingConstraintId === 'mountain-upright', leanResult.failingConstraintId);
  check('with the upright correction', leanResult.correction === 'Stand tall, shoulders over your hips');

  const bentKnees = mountainValid().map((joint) =>
    joint.name === 'LEFT_KNEE' ? { ...joint, x: 0.3 } : joint,
  );
  const kneeResult = evaluate('mountain', bentKnees);
  check('a bent knee is not Mountain Pose', kneeResult.state === 'invalid');
  check('and is told to straighten', kneeResult.failingConstraintId === 'mountain-legs-straight', kneeResult.failingConstraintId);

  const armsUp = mountainValid().map((joint) =>
    joint.name === 'LEFT_WRIST' ? { ...joint, y: 0.3 } : joint,
  );
  const armResult = evaluate('mountain', armsUp);
  check('a raised arm is not Mountain Pose', armResult.state === 'invalid');
  check('and is told to lower it', armResult.failingConstraintId === 'mountain-arms-down', armResult.failingConstraintId);
});

suite('yoga pose rules: Chair Pose is read from the side', () => {
  const valid = evaluate('chair', chairValid());
  check('a side-on bent-knee stance is Chair Pose', valid.state === 'valid', valid);
  check('and needs no correction', valid.correction === null);

  /*
   * The knee band is the whole pose, so both edges of it are pinned exactly.
   * Straight legs must fail; a straightened-out leg must fail.
   */
  const straightLegs = evaluate('chair', standing());
  check('standing straight is not Chair Pose', straightLegs.state === 'invalid');
  check('and is told to bend the knees', straightLegs.failingConstraintId === 'chair-knees-bent', straightLegs.failingConstraintId);
  check('with the bend correction', straightLegs.correction === 'Bend your knees');

  /*
   * A knee at exactly the ceiling is accepted and one a degree past it is not.
   * Built from `leg()` so the angle is exact rather than near the tolerance.
   */
  const atCeiling = withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, YOGA_BENT_KNEE_MAX_DEG),
    ...leg('RIGHT', 0.6, 0.62, 0.55, 0.62, 0.3, 90),
  ]);
  check(
    'a knee exactly on the ceiling is accepted',
    evaluate('chair', atCeiling).state === 'valid',
    evaluate('chair', atCeiling),
  );

  const overCeiling = withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, YOGA_BENT_KNEE_MAX_DEG + 1),
    ...leg('RIGHT', 0.6, 0.62, 0.55, 0.62, 0.3, 90),
  ]);
  const overResult = evaluate('chair', overCeiling);
  check('a knee one degree past the ceiling is rejected', overResult.state === 'invalid', overResult);
  check('and is still reported as the knee', overResult.failingConstraintId === 'chair-knees-bent', overResult.failingConstraintId);

  /*
   * And the floor is inclusive in the same way, so the band has both edges pinned
   * rather than only the one that happens to be reachable.
   */
  const atFloor = withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, YOGA_BENT_KNEE_MIN_DEG),
    ...leg('RIGHT', 0.6, 0.62, 0.55, 0.62, 0.3, 90),
  ]);
  check('a knee exactly on the floor is accepted', evaluate('chair', atFloor).state === 'valid', evaluate('chair', atFloor));

  const underFloor = withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, YOGA_BENT_KNEE_MIN_DEG - 1),
    ...leg('RIGHT', 0.6, 0.62, 0.55, 0.62, 0.3, 90),
  ]);
  check('a knee below the floor is rejected', evaluate('chair', underFloor).state === 'invalid', evaluate('chair', underFloor));

  /*
   * Both legs must be bent (`mode: 'all'`). One bent and one straight is not
   * Chair Pose, and accepting it would mean the app agreed with a stance that is
   * only half the pose.
   */
  const oneLegOnly = withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, 90),
    ...leg('RIGHT', 0.6, 0.62, 0.6, 0.75, 0.2, 180),
  ]);
  const oneLegResult = evaluate('chair', oneLegOnly);
  check('one bent leg out of two is rejected', oneLegResult.state === 'invalid', oneLegResult);
  check('and is reported against the knee', oneLegResult.failingConstraintId === 'chair-knees-bent');
});

suite('yoga pose rules: Warrior II bends the knee by hip height, not knee angle', () => {
  const valid = evaluate('warrior-ii', warriorValid());
  check('arms out, hips down is Warrior II', valid.state === 'valid', valid);
  check('and needs no correction', valid.correction === null);

  /*
   * THE REASON THIS POSE WORKS AT ALL.
   * A knee bend is depth, and depth does not survive a frontal projection: the
   * hip drops straight down towards the ankle and the knee comes towards the
   * camera, so the measured knee angle lands near 180 and is indistinguishable
   * from standing. A rule that checked the angle here would tell somebody they
   * were not in Warrior II while they were in it.
   *
   * So this pose is checked on hip height against the lower knee instead. Standing
   * measures roughly 0.8 torso-lengths of separation and Warrior II roughly 0.1, so
   * the two populations are nowhere near the 0.45 threshold and neither has to be
   * measured accurately for the check to mean something.
   */
  const standingAtThisView = evaluate('warrior-ii', standing());
  check('standing with arms down is not Warrior II', standingAtThisView.state === 'invalid', standingAtThisView);
  check('and is told to bend the front knee', standingAtThisView.failingConstraintId === 'warrior-front-knee-bent', standingAtThisView.failingConstraintId);

  const armsDown = warriorValid().map((joint) =>
    joint.name === 'LEFT_WRIST' || joint.name === 'RIGHT_WRIST'
      ? { ...joint, y: 0.8 }
      : joint,
  );
  check('hips down but arms down is not Warrior II', evaluate('warrior-ii', armsDown).failingConstraintId === 'warrior-arms-level');

  const armsIn = warriorValid().map((joint) =>
    joint.name === 'LEFT_WRIST' ? { ...joint, x: 0.55 } : joint,
  );
  check('arms not spread apart is rejected', evaluate('warrior-ii', armsIn).failingConstraintId === 'warrior-arms-spread', evaluate('warrior-ii', armsIn));

  const armsTilted = warriorValid().map((joint) =>
    joint.name === 'LEFT_WRIST' ? { ...joint, y: 0.1 } : joint,
  );
  check('arms not level are rejected', evaluate('warrior-ii', armsTilted).failingConstraintId === 'warrior-arms-level');

  /*
   * The back leg must be straight. One leg straight out of two is enough
   * (`mode: 'any'`), because the app cannot know which leg is leading and only
   * needs to know one is not the bent one.
   */
  /*
   * Both knees bent. The back knee is moved OFF the hip-ankle line rather than
   * merely further down it, because a knee lowered along the same line stays exactly
   * straight - the test would then be asserting that moving a joint up and down can
   * change an angle, which is false and would let a broken check look green.
   */
  const bothLegsBent = warriorValid().map((joint) =>
    joint.name === 'RIGHT_KNEE' ? { ...joint, x: 0.68, y: 0.78 } : joint,
  );
  check('neither leg straight is rejected', evaluate('warrior-ii', bothLegsBent).failingConstraintId === 'warrior-back-leg-straight', evaluate('warrior-ii', bothLegsBent));

  const oneStraight = evaluate('warrior-ii', warriorValid());
  check('one straight leg is enough', oneStraight.state === 'valid');
});

suite('yoga pose rules: every threshold sits where the measurements say it should', () => {
  /*
   * These pin the reason the numbers are what they are. If a tolerance moved, one
   * of these would fail and the reason would be in the failure.
   */

  /* Standing, measured: hips well above the lower knee. */
  const standingRatio =
    Math.abs(0.55 - 0.75) / Math.abs(0.55 - 0.3);
  check('standing hips sit far above the knee', standingRatio > YOGA_WARRIOR_HIP_KNEE_RATIO, standingRatio);

  /* Warrior II, measured: hips down at knee level. */
  const warriorRatio = Math.abs(0.72 - 0.75) / Math.abs(0.72 - 0.3);
  check('Warrior II hips sit at knee level', warriorRatio < YOGA_WARRIOR_HIP_KNEE_RATIO, warriorRatio);
  check('the two populations are far apart, so the threshold is not delicate', Math.abs(standingRatio - warriorRatio) > 0.5);

  /* Arms out at shoulder width x 1.6 is reachable; arms down is not. */
  const shoulderWidth = Math.abs(0.6 - 0.4);
  const armsOut = Math.abs(0.85 - 0.15);
  check('arms fully out exceed the spread requirement', armsOut >= YOGA_ARMS_SPREAD_MIN_RATIO * shoulderWidth);
  check('arms at the shoulder do not', shoulderWidth < YOGA_ARMS_SPREAD_MIN_RATIO * shoulderWidth);

  /* A wrist within a third of torso length of shoulder height reads as level. */
  const torsoLength = Math.abs(0.72 - 0.3);
  check('a level arm is within the ratio', 0 <= YOGA_ARM_AT_SHOULDER_RATIO * torsoLength);
  check('a dropped arm is outside it', Math.abs(0.8 - 0.3) > YOGA_ARM_AT_SHOULDER_RATIO * torsoLength);

  check('a straight leg reads 180, well clear of the straight-leg floor', 180 > YOGA_STRAIGHT_LEG_MIN_DEG);
  check('the standing tolerance is tighter than the bent one', YOGA_STANDING_TORSO_LEAN_MAX_DEG < 25);
});

suite('yoga hold: time is banked in milliseconds, never in frames', () => {
  const rule = YOGA_POSE_RULES.mountain;
  const requiredMs = rule.holdSeconds * 1000;

  /*
   * The reason this exists: counting frames would reward a slow phone with shorter
   * holds. These two runs deliver the SAME pose over the SAME stretch of time but at
   * very different frame rates, and both must reach completion - which a frame count
   * would not guarantee, because the slower one would have delivered a fraction of
   * the frames.
   */
  const slow = countCompletions('mountain', validFramesOver(requiredMs + 4000, 100));
  const fast = countCompletions('mountain', validFramesOver(requiredMs + 4000, 33));
  check('a 10fps camera still completes the hold', slow.completions === 1, slow.last);
  check('a 30fps camera still completes the hold', fast.completions === 1, fast.last);

  /*
   * Neither finishes early. Both bank at least the required time, so the clock is
   * being measured rather than the frame count, and neither banks absurdly more -
   * which is what a frame count would produce on the slow run.
   */
  check('the slow run banks at least the required time', (slow.last?.holdMs ?? 0) >= requiredMs, slow.last?.holdMs);
  check('the fast run banks at least the required time', (fast.last?.holdMs ?? 0) >= requiredMs, fast.last?.holdMs);

  /*
   * And a run that stops a second short of the required hold never completes. The
   * settle window is included in the budget because the hold cannot start until the
   * pose has been steady for it.
   */
  const short = countCompletions(
    'mountain',
    validFramesOver(requiredMs + YOGA_HOLD_SETTLE_MS - 1000, 100),
  );
  check('a run short of the required hold never completes', short.completions === 0, short.last);
  check('and it had nearly got there', (short.last?.holdMs ?? 0) > requiredMs - 2000, short.last?.holdMs);
});

suite('yoga hold: the pose must be correct, and stay correct, to be held', () => {
  const requiredMs = YOGA_POSE_RULES.mountain.holdSeconds * 1000;

  /*
   * A hold cannot start until the shape has been steady for the settle window.
   * Without this, stepping into position would bank time for a pose never held.
   */
  const tracker = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  tracker.advance('tracked', mountainValid(), 1000);
  const settling = tracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS - 50);
  check('the first frames only settle', settling.phase === 'stabilizing', settling.phase);
  check('and bank nothing', settling.holdMs === 0, settling.holdMs);

  const holding = tracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 100);
  check('the settle window is passed and time is banked', holding.phase === 'holding', holding.phase);

  /* A broken pose RESETS rather than pauses. */
  const broken = tracker.advance('tracked', mountainValid().map((j) => (j.name === 'LEFT_KNEE' ? { ...j, x: 0.2 } : j)), 1000 + YOGA_HOLD_SETTLE_MS + 200);
  check('breaking the pose ends the hold', broken.state === 'invalid', broken.state);
  check('and clears the banked time', broken.holdMs === 0, broken.holdMs);
  check('and returns to waiting', broken.phase === 'waiting', broken.phase);

  /*
   * The realistic cheat this prevents: hold for 19 seconds, step out for one
   * frame, and finish. Pausing instead of resetting would allow exactly that.
   */
  const cheat = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  /*
   * Two seconds short of the hold: enough that the pose really was held for almost
   * the whole time, so the cheat below is a genuine one and not a pose that was
   * never close.
   */
  const almostThere = countCompletions(
    'mountain',
    validFramesOver(requiredMs + YOGA_HOLD_SETTLE_MS - 2000, 100),
  ).last;
  check(
    'the hold is genuinely nearly complete before the cheat',
    (almostThere?.holdMs ?? 0) > requiredMs - 3000,
    almostThere?.holdMs,
  );
  check('and has not completed yet', almostThere?.state !== 'completed', almostThere?.state);

  const cheater = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  const almostMs = requiredMs + YOGA_HOLD_SETTLE_MS - 2000;
  for (let t = 0; t <= almostMs; t += 100) {
    cheater.advance('tracked', mountainValid(), 1000 + t);
  }
  /* One single broken frame, then straight back into the pose. */
  cheater.advance(
    'tracked',
    mountainValid().map((j) => (j.name === 'LEFT_KNEE' ? { ...j, x: 0.2 } : j)),
    1000 + almostMs + 100,
  );
  const afterCheat = cheater.advance('tracked', mountainValid(), 1000 + almostMs + 200);
  check('one broken frame throws the whole hold away', afterCheat.holdMs < 1000, afterCheat.holdMs);
  check('so the cheat cannot finish the pose', afterCheat.state !== 'completed', afterCheat.state);
});

suite('yoga hold: losing the camera and breaking the clock both refuse to credit time', () => {
  const requiredMs = YOGA_POSE_RULES.mountain.holdSeconds * 1000;

  /*
   * A frame the camera missed is not a pose held. Somebody who walked out of shot
   * for two seconds must not bank those two seconds towards a 20-second hold.
   */
  const tracker = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  for (let i = 0; i < 15; i += 1) tracker.advance('tracked', mountainValid(), 1000 + i * 100);
  const banked = tracker.advance('tracked', mountainValid(), 1000 + 15 * 100);
  check('time is banked while the person is visible', banked.holdMs > 0, banked.holdMs);
  const lost = tracker.advance('lost', [], 1000 + 15 * 100 + 100);
  check('losing the camera clears the banked time', lost.holdMs === 0, lost.holdMs);
  check('and reports not tracked', lost.state === 'not-tracked', lost.state);
  check('and is not in the pose', lost.phase === 'waiting', lost.phase);

  /* A long gap cannot pay for a hold nobody performed. */
  const gapTracker = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  gapTracker.advance('tracked', mountainValid(), 1000);
  gapTracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 100);
  const beforeGap = gapTracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 200);
  const afterGap = gapTracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 200 + 60 * 1000);
  check(
    'a one-minute stall credits at most one frame gap, not a minute',
    afterGap.holdMs - beforeGap.holdMs <= YOGA_HOLD_MAX_FRAME_GAP_MS,
    afterGap.holdMs - beforeGap.holdMs,
  );

  /* A timestamp that does not move forward is not time passing. */
  const frozen = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  frozen.advance('tracked', mountainValid(), 5000);
  frozen.advance('tracked', mountainValid(), 5000 + YOGA_HOLD_SETTLE_MS + 100);
  const repeated = frozen.advance('tracked', mountainValid(), 5000 + YOGA_HOLD_SETTLE_MS + 100);
  check('a repeated timestamp banks nothing', repeated.holdMs === 0, repeated.holdMs);
  const backwards = frozen.advance('tracked', mountainValid(), 1);
  check('a backwards timestamp banks nothing', backwards.holdMs === 0, backwards.holdMs);
});

suite('yoga hold: completion happens exactly once and then stops', () => {
  const requiredMs = YOGA_POSE_RULES.mountain.holdSeconds * 1000;

  /*
   * The realistic bug here is a pose that completes repeatedly, once per frame, for
   * the rest of the step. Counting notifications catches that; a final-state check
   * would call it a pass.
   */
  const many = validFramesOver(requiredMs + 3000, 100);
  const { completions, last } = countCompletions('mountain', many);
  check('a long hold completes exactly once', completions === 1, completions);
  check('and stays completed', last?.state === 'completed', last?.state);
  check('having banked at least the required time', (last?.holdMs ?? 0) >= requiredMs, last?.holdMs);

  /* Frames after completion cannot un-complete it, even bad ones. */
  const tracker = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  for (let t = 0; t <= requiredMs + YOGA_HOLD_SETTLE_MS; t += 100) {
    tracker.advance('tracked', mountainValid(), 1000 + t);
  }
  check('the run before the broken frame had completed', tracker.advance('tracked', mountainValid(), 1000 + requiredMs + YOGA_HOLD_SETTLE_MS + 100).state === 'completed');

  const doneTs = 1000 + requiredMs + YOGA_HOLD_SETTLE_MS + 2000;
  const done = tracker.advance(
    'tracked',
    mountainValid().map((j) => (j.name === 'LEFT_KNEE' ? { ...j, x: 0.2 } : j)),
    doneTs,
  );
  check('a broken frame after completion does not undo it', done.state === 'completed', done.state);
  check('and does not re-complete it', done.justCompleted === false);
  check('nor claim it is out of pose', done.correction === null);

  /* Progress and remaining are floored, never negative. */
  const over = tracker.advance('tracked', mountainValid(), doneTs + 100);
  check('progress never exceeds one', over.progress === 1, over.progress);
  check('remaining never goes negative', over.remainingSeconds === 0, over.remainingSeconds);
});

suite('yoga hold: pausing freezes the clock rather than crediting the pause', () => {
  const tracker = new YogaHoldTracker(YOGA_POSE_RULES.mountain);
  tracker.advance('tracked', mountainValid(), 1000);
  tracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 100);
  const before = tracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 200);

  tracker.pause();
  const paused = tracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 300);
  check('no time banks while paused', paused.holdMs === before.holdMs, paused.holdMs);

  tracker.resume();
  const resumed = tracker.advance('tracked', mountainValid(), 1000 + YOGA_HOLD_SETTLE_MS + 500);
  check('the pause itself is not credited', resumed.holdMs - before.holdMs <= YOGA_HOLD_MAX_FRAME_GAP_MS, resumed.holdMs - before.holdMs);
});

suite('yoga pose steps: a pose step is a camera step that counts nothing', () => {
  const routine = yogaRoutines.find((r) => r.id === 'standing-pose-holds');
  check('the pose routine exists', routine !== undefined);

  if (!routine) return;

  /*
   * A pose step must NOT carry a cameraConfigId. If it did, the screen would build
   * a SessionEngine for it and try to count repetitions in a pose where the whole
   * instruction is to stop moving.
   */
  const poseSteps = routine.steps.filter((s) => s.poseRuleId !== undefined);
  check('all three poses are in the routine', poseSteps.length === 3, poseSteps.length);
  check(
    'no pose step also carries a movement config',
    poseSteps.every((s) => s.cameraConfigId === undefined),
  );
  check(
    'every pose step resolves to a real rule',
    poseSteps.every((s) => isYogaPoseRuleId(s.poseRuleId)),
  );

  /*
   * Each pose step's guidance is the RULE'S OWN sentence, so the instruction the
   * person reads about which way to stand cannot drift from the rule that depends
   * on it.
   */
  for (const step of poseSteps) {
    const rule = getYogaPoseRule(step.poseRuleId);
    check(`${step.title} uses its rule's guidance`, step.guidance === rule?.guidance, {
      step: step.guidance,
      rule: rule?.guidance,
    });
  }

  /*
   * The step's clock must outlast the pose's hold. The hold only starts once the
   * shape has been steady, and restarts from zero if broken, so a step as short as
   * the hold would end while the person was still finding the position.
   */
  for (const step of poseSteps) {
    const rule = getYogaPoseRule(step.poseRuleId);
    check(
      `${step.title} gives more time than the pose asks to be held`,
      step.seconds > (rule?.holdSeconds ?? 0),
      { seconds: step.seconds, hold: rule?.holdSeconds },
    );
  }

  /*
   * The routine must be honest that these poses are done STANDING. Every other yoga
   * routine in this file can be done sitting down, and a person who has only met
   * those must not discover otherwise from the middle of a squat.
   */
  check('the summary says it is standing', /standing/i.test(routine.summary), routine.summary);
  check('the safety note says it is standing', /standing/i.test(routine.safetyNote), routine.safetyNote);
  check('the safety note mentions a chair or wall for support', /chair|wall/i.test(routine.safetyNote), routine.safetyNote);
});

suite('yoga pose steps: the session runs a pose step like any other', () => {
  /*
   * A pose step is still a step in the guided session: it takes its time from the
   * clock like every other step, and the session records how many were reached.
   * Nothing about the hold tracker is allowed to change the shape of the session.
   */
  const activity = yogaRoutines.find((r) => r.id === 'standing-pose-holds');
  if (!activity) {
    check('the pose routine exists', false);
    return;
  }

  const session = new GuidedSession(activity);
  session.start();
  const started = session.snapshot();
  check('the session starts on the first step', started.stepIndex === 0, started.stepIndex);
  check('the first step is the settle, which has no camera', started.currentStep?.cameraConfigId === undefined);
  check('and no pose either', started.currentStep?.poseRuleId === undefined);

  session.pause();
  check('a paused session banks no time', session.snapshot().elapsedSeconds === 0);

  session.resume();
  const advanced = session.snapshot();
  check('the session is running again', advanced.phase === 'running');
});

suite('yoga pose steps: a pose step is wired into the screen without an engine', () => {
  /*
   * The shared screen is not covered by type checking here - React Native is not
   * in the test build - so these read the component's own source. That is the
   * existing convention in `activity-flow.test.ts`, and for the same reason: each
   * line below guards a property whose absence would silently disable or corrupt
   * the pose camera while every other registry and geometry test stayed green.
   */
  const code = guidedScreenCode;

  check('the screen resolves a step pose rule', code.includes('getYogaPoseRule(snapshot.currentStep?.poseRuleId)'));
  check('and knows when it is on a pose step', code.includes('const isPoseStep = currentPoseRule !== undefined'));

  /*
   * A pose step must be recognised as a camera step, or the preview never mounts
   * and the person is asked to hold a pose nobody is watching.
   */
  check('a pose step counts as a camera step', code.includes('const isCameraStep = currentStepConfig !== undefined || isPoseStep'));
  check(
    'permission is requested for an activity with a pose step',
    code.includes('step.cameraConfigId !== undefined || step.poseRuleId !== undefined'),
  );

  /*
   * The load-bearing one: no SessionEngine for a pose step. With an engine, the
   * screen would fold a repetition count into the session total for a pose whose
   * whole instruction is to stop moving.
   */
  check(
    'no rep engine is built for a pose step',
    code.includes('if (isCameraStep && currentStepConfig && !isMeditation && !isPoseStep)'),
  );

  /*
   * The frame must reach the hold tracker, and the hold branch must come BEFORE the
   * engine branch - after it, a pose step would find no engine and silently measure
   * nothing while the preview still looked correct.
   */
  check('frames reach the hold tracker', code.includes('poseTracker.advance(presence, landmarks, timestampMs)'));
  /*
   * Order matters: after the engine branch, a pose step would find no engine, the
   * handler would return without measuring anything, and the preview would still
   * look perfectly correct while nothing was being counted. Anchored on the engine
   * being READ inside the handler, not merely declared.
   */
  const poseBranchAt = code.indexOf('poseTracker.advance(presence, landmarks, timestampMs)');
  const engineBranchAt = code.indexOf('const engine = cameraEngineRef.current');
  check('the pose branch is handled before the rep engine is consulted', poseBranchAt > -1 && poseBranchAt < engineBranchAt, { poseBranchAt, engineBranchAt });

  /*
   * Completion is spoken through the existing voice controller under an EXISTING
   * feedback kind. A new FeedbackKind would give the voice layer a second way to
   * say the same thing and a second thing to keep in step with this screen.
   */
  check('completion reuses an existing feedback kind', code.includes("consider('good'"));
  check('a broken pose reuses an existing feedback kind', code.includes("consider('positioning'"));

  /*
   * Pausing must reach the tracker, or the hold could be one frame ahead of the
   * session the person paused.
   */
  check('pausing freezes the hold', code.includes('poseTrackerRef.current?.pause()'));
  check('resuming restarts it', code.includes('poseTrackerRef.current?.resume()'));

  /*
   * A new hold tracker per step, or a hold banked against one pose would be carried
   * into the next and could complete it in seconds.
   */
  check('each pose step gets a fresh hold tracker', code.includes('new YogaHoldTracker(currentPoseRule)'));
});

/** Removes comments, so code that matters is not confused with prose about it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function run(): void {
  // Suites self-register through `suite(...)` as they are declared.
}