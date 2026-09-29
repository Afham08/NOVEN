import { almostEqual, check, suite } from './harness';

import type { LandmarkEventPayload, PoseLandmarkName } from '../modules/pose-tracker';
import {
  MEDITATION_SETTLE_MS,
  MEDITATION_UPRIGHT_TOLERANCE_DEG,
  MeditationPostureTracker,
  torsoLeanFromVerticalDeg,
} from '../src/activities/meditation-guidance';
import { meditationSessions } from '../src/activities/meditation';
import { getGuidedPoseConfig } from '../src/exercise/pose-configs';

/**
 * Covers the posture guidance a meditation camera step shows.
 *
 * These are the claims the app makes out loud to an older person sitting in
 * front of a camera, so each one is pinned here: who is allowed to be told
 * they are in frame, who is allowed to be told their back is upright, and what
 * happens to every message when the person is not there to see it.
 */

function lm(
  name: PoseLandmarkName,
  x: number,
  y: number,
  visibility = 1,
): LandmarkEventPayload {
  return { name, x, y, z: 0, visibility };
}

/**
 * A torso whose shoulder midpoint sits `leanX` to one side of its hip midpoint.
 *
 * The image's y axis grows downward, so the hips are placed below the shoulders
 * for an upright torso. The two sides are offset symmetrically so the midpoint
 * lands exactly on `x`, which keeps the expected angle exact rather than
 * approximate.
 */
function torso(leanX: number, visibility = 1): LandmarkEventPayload[] {
  return [
    lm('LEFT_SHOULDER', 0.5 - 0.15 - leanX, 0.3, visibility),
    lm('RIGHT_SHOULDER', 0.5 + 0.15 - leanX, 0.3, visibility),
    lm('LEFT_HIP', 0.5 - 0.15, 0.7, visibility),
    lm('RIGHT_HIP', 0.5 + 0.15, 0.7, visibility),
  ];
}

/** A person lying down: torso horizontal, so nowhere near upright by measure. */
function lyingDown(): LandmarkEventPayload[] {
  return [
    lm('LEFT_SHOULDER', 0.35, 0.5),
    lm('RIGHT_SHOULDER', 0.45, 0.5),
    lm('LEFT_HIP', 0.55, 0.5),
    lm('RIGHT_HIP', 0.65, 0.5),
  ];
}

/**
 * A torso tipped to exactly `leanDeg` from vertical.
 *
 * Built from the angle rather than from a guessed x offset, so a boundary test
 * can sit exactly on the tolerance instead of near it: the shoulder midpoint is
 * placed one unit of `length` away from the hip midpoint along the direction
 * (sin, cos) of the requested lean, which is the inverse of the measurement.
 * Deriving the x offset with Math.tan instead would round-trip through atan2
 * and land an ULP either side of the number under test.
 */
function torsoAtLeanDeg(leanDeg: number, length = 1): LandmarkEventPayload[] {
  const rad = (leanDeg * Math.PI) / 180;
  const hipMidX = 0.5;
  const hipMidY = 0.7;
  const shoulderMidX = hipMidX - length * Math.sin(rad);
  const shoulderMidY = hipMidY - length * Math.cos(rad);
  const shoulderHalf = 0.05;
  const hipHalf = 0.05;
  return [
    lm('LEFT_SHOULDER', shoulderMidX - shoulderHalf, shoulderMidY),
    lm('RIGHT_SHOULDER', shoulderMidX + shoulderHalf, shoulderMidY),
    lm('LEFT_HIP', hipMidX - hipHalf, hipMidY),
    lm('RIGHT_HIP', hipMidX + hipHalf, hipMidY),
  ];
}

/** Feeds one frame and returns the resulting guidance. */
function observe(
  tracker: MeditationPostureTracker,
  landmarks: LandmarkEventPayload[],
  timestampMs: number,
  expectation: 'seated-upright' | 'in-frame' = 'seated-upright',
) {
  return tracker.observe('tracked', landmarks, timestampMs, expectation);
}

/** Runs past the settling window so the tracker is willing to judge posture. */
const SETTLED_AT_MS = MEDITATION_SETTLE_MS + 500;

export function run(): void {
  suite('meditation-guidance torso lean', () => {
    almostEqual(torsoLeanFromVerticalDeg(torso(0)), 0, 1e-9);

    // 45 degrees forward: dx = 0.5, dy = 0.4 -> atan2(0.5, 0.4) = 51.34 deg.
    const leaned = torsoLeanFromVerticalDeg(torso(0.5));
    almostEqual(leaned, (Math.atan2(0.5, 0.4) * 180) / Math.PI, 1e-9);
    check('a forward lean reads above the upright tolerance', leaned > MEDITATION_UPRIGHT_TOLERANCE_DEG);

    // Mirrored: leaning the other way must measure the same magnitude, so a
    // person seen from the other side of the room is judged identically.
    almostEqual(torsoLeanFromVerticalDeg(torso(-0.5)), leaned, 1e-9);

    // The angle is measured, not assumed: ask for a lean and get it back.
    for (const angle of [0, 5, 22, 45, 90]) {
      almostEqual(
        torsoLeanFromVerticalDeg(torsoAtLeanDeg(angle)),
        angle,
        1e-9,
      );
    }

    // A person lying down is horizontal, and therefore nowhere near upright by
    // this measure. That is exactly why the body scan must not ask for an
    // uprightness verdict - see the catalogue suite below.
    const lying = lyingDown();
    almostEqual(torsoLeanFromVerticalDeg(lying), 90, 1e-6);
    check('a horizontal torso is far from upright', torsoLeanFromVerticalDeg(lying) > 80);

    check('missing landmarks give NaN', Number.isNaN(torsoLeanFromVerticalDeg([lm('NOSE', 0.5, 0.2)])));
    check('an empty frame gives NaN', Number.isNaN(torsoLeanFromVerticalDeg([])));

    // One faint shoulder is enough to make the whole measurement unusable, and
    // a half-measured torso must not fall back to "upright".
    const faint = torso(0.5);
    faint[0] = lm('LEFT_SHOULDER', 0.35, 0.3, 0.1);
    check('a low-visibility joint gives NaN', Number.isNaN(torsoLeanFromVerticalDeg(faint)));

    const atThreshold = torso(0.5, MEDITATION_VISIBILITY_BOUNDARY);
    check('a joint exactly at minVisibility is still measured', Number.isFinite(torsoLeanFromVerticalDeg(atThreshold)));

    const corrupt = torso(0.5);
    corrupt[0] = lm('LEFT_SHOULDER', Number.POSITIVE_INFINITY, 0.3);
    check('a non-finite coordinate gives NaN', Number.isNaN(torsoLeanFromVerticalDeg(corrupt)));

    // A collapsed torso has no direction; atan2(0, 0) would otherwise be free
    // to return 0 and read as a perfect upright posture.
    const collapsed = [
      lm('LEFT_SHOULDER', 0.5, 0.5),
      lm('RIGHT_SHOULDER', 0.5, 0.5),
      lm('LEFT_HIP', 0.5, 0.5),
      lm('RIGHT_HIP', 0.5, 0.5),
    ];
    check('a collapsed torso gives NaN rather than 0', Number.isNaN(torsoLeanFromVerticalDeg(collapsed)));
  });

  suite('meditation-guidance presence', () => {
    const tracker = new MeditationPostureTracker();

    for (const presence of ['not-tracked', 'lost'] as const) {
      const result = tracker.observe(presence, torso(0), SETTLED_AT_MS, 'seated-upright');
      check(`${presence} reports not-in-frame`, result.state === 'not-in-frame');
      check(`${presence} asks the person to get in frame`, result.text === 'Position yourself in the frame');
      check(`${presence} makes no uprightness claim`, result.upright === false);
      check(`${presence} reports no measurement`, result.leanDeg === null);
    }

    // A person who leaves the frame after being told they are sitting well must
    // lose that message on the very next frame, not be carried along by the last
    // good posture.
    observe(tracker, torso(0), 0, 'seated-upright');
    const settledUpright = observe(tracker, torso(0), SETTLED_AT_MS, 'seated-upright');
    check('upright before leaving', settledUpright.state === 'upright');

    const afterLeaving = tracker.observe('lost', torso(0), SETTLED_AT_MS + 100, 'seated-upright');
    check('leaving the frame clears the upright verdict', afterLeaving.state === 'not-in-frame');
    check('leaving the frame drops the upright flag', afterLeaving.upright === false);

    // Coming back restarts the settling window, so a fresh arrival is not
    // immediately told its posture is good on one lucky frame.
    const onReturn = observe(tracker, torso(0), SETTLED_AT_MS + 200, 'seated-upright');
    check('re-entering restarts settling', onReturn.state === 'settling');
  });

  suite('meditation-guidance settling window', () => {
    const tracker = new MeditationPostureTracker();

    const first = observe(tracker, torso(0), 1000, 'seated-upright');
    check('the first measurable frame is settling', first.state === 'settling');
    check('settling says to sit comfortably', first.text === 'Sit comfortably, keep your back upright');

    const justBefore = observe(tracker, torso(0), 1000 + MEDITATION_SETTLE_MS - 1, 'seated-upright');
    check('one millisecond short of the window is still settling', justBefore.state === 'settling');

    const exactly = observe(tracker, torso(0), 1000 + MEDITATION_SETTLE_MS, 'seated-upright');
    check('the window is inclusive at its edge', exactly.state === 'upright');

    // The window is measured in milliseconds, so a slow 10fps device and a fast
    // 30fps one reach the same verdict on the same schedule.
    const slow = new MeditationPostureTracker();
    observe(slow, torso(0), 0, 'seated-upright');
    observe(slow, torso(0), 100, 'seated-upright');
    check(
      'a 10fps stream still settles on the millisecond window',
      observe(slow, torso(0), MEDITATION_SETTLE_MS, 'seated-upright').state === 'upright',
    );

    // Timestamps that jump backwards must not be able to fabricate elapsed time.
    const backwards = new MeditationPostureTracker();
    observe(backwards, torso(0), 5000, 'seated-upright');
    const rewound = observe(backwards, torso(0), 0, 'seated-upright');
    check('a rewound timestamp restarts settling', rewound.state === 'settling');

    // An unusable frame during the window restarts it, so a hand passing in
    // front of the lens cannot be read as a posture change.
    const interrupted = new MeditationPostureTracker();
    observe(interrupted, torso(0), 0, 'seated-upright');
    const occluded = observe(interrupted, [lm('NOSE', 0.5, 0.2)], 400, 'seated-upright');
    check('an unusable frame is reported as not-in-frame', occluded.state === 'not-in-frame');
    check('an unusable frame restarts the window', observe(interrupted, torso(0), 500, 'seated-upright').state === 'settling');
  });

  suite('meditation-guidance posture verdict', () => {
    const uprightTracker = new MeditationPostureTracker();
    const straight = torsoAtLeanDeg(0, 0.4);
    observe(uprightTracker, straight, 0, 'seated-upright');
    const upright = observe(uprightTracker, straight, SETTLED_AT_MS, 'seated-upright');
    check('a straight back reads upright', upright.state === 'upright');
    check('upright says Good posture', upright.text === 'Good posture');
    check('upright is the only state that sets upright', upright.upright === true);
    check('upright reports the measured angle', typeof upright.leanDeg === 'number');

    const slouchedTracker = new MeditationPostureTracker();
    const slouchedFrame = torsoAtLeanDeg(40, 0.4);
    observe(slouchedTracker, slouchedFrame, 0, 'seated-upright');
    const slouched = observe(slouchedTracker, slouchedFrame, SETTLED_AT_MS, 'seated-upright');
    check('a forward lean reads slouched', slouched.state === 'slouched');
    check('slouched says Straighten your back', slouched.text === 'Straighten your back');
    check('slouched never claims upright', slouched.upright === false);

    // Exactly on the tolerance is not past it, so a borderline body is not
    // nagged. One degree past it is.
    const atLimit = torsoAtLeanDeg(MEDITATION_UPRIGHT_TOLERANCE_DEG);
    const atTracker = new MeditationPostureTracker();
    observe(atTracker, atLimit, 0, 'seated-upright');
    const atVerdict = observe(atTracker, atLimit, SETTLED_AT_MS, 'seated-upright');
    check('exactly at the tolerance is still upright', atVerdict.state === 'upright');
    check(
      'the measurement at the tolerance is the tolerance itself',
      Math.abs((atVerdict.leanDeg ?? -1) - MEDITATION_UPRIGHT_TOLERANCE_DEG) < 1e-9,
    );

    const justPast = torsoAtLeanDeg(MEDITATION_UPRIGHT_TOLERANCE_DEG + 0.5);
    const pastTracker = new MeditationPostureTracker();
    observe(pastTracker, justPast, 0, 'seated-upright');
    check(
      'just past the tolerance is slouched',
      observe(pastTracker, justPast, SETTLED_AT_MS, 'seated-upright').state === 'slouched',
    );

    // A person who corrects themselves should be told so on the next frame,
    // with no need to leave and re-enter the frame.
    const recovering = new MeditationPostureTracker();
    observe(recovering, slouchedFrame, 0, 'seated-upright');
    observe(recovering, slouchedFrame, SETTLED_AT_MS, 'seated-upright');
    check(
      'corrects to upright without re-entering frame',
      observe(recovering, straight, SETTLED_AT_MS + 100, 'seated-upright').state === 'upright',
    );
  });

  suite('meditation-guidance in-frame expectation', () => {
    // The body scan invites the person to lie down. A lying torso measures far
    // from upright, so this expectation must never produce an uprightness
    // verdict for it - only confirmation that they are there.
    const lying = lyingDown();
    const tracker = new MeditationPostureTracker();
    observe(tracker, lying, 0, 'in-frame');
    const settled = observe(tracker, lying, SETTLED_AT_MS, 'in-frame');
    check('a lying-down torso is not called slouched', settled.state === 'settled');
    check('a lying-down torso is not called upright', settled.upright === false);
    check('a lying-down torso is not nagged to straighten', settled.text !== 'Straighten your back');
    check('a lying-down torso is not nagged to sit up', settled.text !== 'Sit comfortably, keep your back upright');
    check('a lying-down torso is not given a posture verdict', settled.text !== 'Good posture');
    check('a lying-down torso only confirms the view', settled.text === 'In frame, all set to begin');

    // The settling window is shared, so it is the other half of the same bug: a
    // body scan user was told to keep their back upright for the first 1.2s of
    // every step, before the settled branch had a chance to stay neutral.
    const settlingTracker = new MeditationPostureTracker();
    const settling = observe(settlingTracker, lying, 0, 'in-frame');
    check('in-frame settling does not ask them to sit upright', settling.text !== 'Sit comfortably, keep your back upright');
    check('in-frame settling does not judge posture', settling.text !== 'Good posture');
    check('in-frame settling only asks them to hold still', settling.text === 'Stay comfortable, keep still for a moment');

    // Seated steps keep their upright wording unchanged.
    const seatedTracker = new MeditationPostureTracker();
    const seatedSettling = observe(seatedTracker, torso(0), 0, 'seated-upright');
    check('seated settling still says to sit comfortably', seatedSettling.text === 'Sit comfortably, keep your back upright');
    const seatedSettled = observe(seatedTracker, torso(0), SETTLED_AT_MS, 'seated-upright');
    check('seated settling still reports Good posture', seatedSettled.text === 'Good posture');

    // Presence still works in this mode - that is the whole point of it.
    const absent = tracker.observe('lost', lying, SETTLED_AT_MS + 100, 'in-frame');
    check('in-frame mode still reports leaving the frame', absent.state === 'not-in-frame');
    check('in-frame mode still asks them to get in frame', absent.text === 'Position yourself in the frame');
  });

  suite('meditation-guidance wording', () => {
    // The exact strings are the product, so they are pinned here. A later edit
    // that changes one has to change these on purpose.
    const tracker = new MeditationPostureTracker();
    const seen = new Set<string>();
    for (const landmarks of [torso(0), torso(0.6)]) {
      for (const timestampMs of [0, SETTLED_AT_MS]) {
        seen.add(observe(tracker, landmarks, timestampMs, 'seated-upright').text);
      }
    }
    seen.add(observe(tracker, lyingDown(), SETTLED_AT_MS, 'in-frame').text);
    seen.add(observe(new MeditationPostureTracker(), lyingDown(), 0, 'in-frame').text);
    seen.add(tracker.observe('lost', [], 0, 'seated-upright').text);

    const approved = new Set([
      'Position yourself in the frame',
      'Sit comfortably, keep your back upright',
      'Straighten your back',
      'Good posture',
      'Stay comfortable, keep still for a moment',
      'In frame, all set to begin',
    ]);
    check('every state produces one of the approved phrases', [...seen].every((t) => approved.has(t)));
    check('every approved phrase is reachable', seen.size === 6);

    // The strongest guarantee this module makes: nothing it can ever display
    // describes a mental state. Every word below is something NOVEN cannot
    // observe from a torso, so none of them may appear in any output.
    const forbidden = [
      'meditat', 'calm', 'relax', 'peaceful', 'concentrat', 'focus',
      'breath', 'stress', 'anxiet', 'mood', 'happi', 'mindful', 'score',
      'repetition', 'rep ', 'count',
    ];
    for (const text of seen) {
      const lower = text.toLowerCase();
      for (const word of forbidden) {
        check(`"${text}" does not claim "${word.trim()}"`, !lower.includes(word));
      }
    }
  });

  suite('meditation catalogue posture expectations', () => {
    // Every camera step must name what it will claim, and a step that tells the
    // person to lie down must not be paired with an uprightness check.
    for (const activity of meditationSessions) {
      for (const step of activity.steps) {
        if (step.cameraConfigId === undefined) continue;

        check(
          `${activity.id} / ${step.title} resolves its camera config`,
          getGuidedPoseConfig(step.cameraConfigId) !== undefined,
        );
        check(
          `${activity.id} / ${step.title} declares a posture expectation`,
          step.postureExpectation !== undefined,
        );

        const invitesLyingDown = /lie down|lying down/i.test(step.guidance);
        if (invitesLyingDown) {
          check(
            `${activity.id} / ${step.title} does not demand uprightness while lying down is allowed`,
            step.postureExpectation === 'in-frame',
          );
        }
      }
    }

    // And the seated sessions do get the upright check they can honestly use.
    const seated = meditationSessions.filter((a) => a.id !== 'ten-minute-body-scan');
    check('the two seated meditations exist', seated.length === 2);
    for (const activity of seated) {
      const cameraSteps = activity.steps.filter((s) => s.cameraConfigId !== undefined);
      check(`${activity.id} has a camera step`, cameraSteps.length > 0);
      for (const step of cameraSteps) {
        check(`${activity.id} checks upright posture while seated`, step.postureExpectation === 'seated-upright');
      }
    }
  });

  suite('meditation stays completable without a camera', () => {
    // No camera state may leak into the session's own progress: a meditation
    // advances on its clock, so denying permission cannot change its duration
    // or its step count.
    for (const activity of meditationSessions) {
      const cameraSteps = activity.steps.filter((s) => s.cameraConfigId !== undefined).length;
      const totalSeconds = activity.steps.reduce((sum, s) => sum + s.seconds, 0);
      check(`${activity.id} duration is the sum of its steps`, activity.durationSeconds === totalSeconds);
      check(
        `${activity.id} is not mostly camera steps (${cameraSteps}/${activity.steps.length})`,
        cameraSteps < activity.steps.length,
      );
    }
  });
}

/** Visibility exactly at MEDITATION_MIN_VISIBILITY, for the boundary check. */
const MEDITATION_VISIBILITY_BOUNDARY = 0.5;
