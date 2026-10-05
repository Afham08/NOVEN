import { almostEqual, check, suite } from './harness';

import type { LandmarkEventPayload, PoseLandmarkName } from '../modules/pose-tracker';
import { angleFromTriplet, calculateAngle, getLandmark } from '../src/exercise/pose-utils';
import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import type { AngleTriplet } from '../src/exercise/types';

/**
 * Covers the landmark math that actually drives rep detection. Nothing renders
 * landmarks, so there is no landmark-to-screen projection/alignment math left in
 * the product and none is tested here. What is covered is the live path: name
 * lookup, interior angle, and the triplet gate that feeds RepDetector.
 */

function lm(
  name: PoseLandmarkName,
  x: number,
  y: number,
  visibility = 1,
  presence = 1,
): LandmarkEventPayload {
  return { name, x, y, z: 0, visibility, presence };
}

const LEFT_TRIPLET: AngleTriplet = SEATED_KNEE_EXTENSION.triplets.left;
const MIN_VIS = SEATED_KNEE_EXTENSION.thresholds.minVisibility;

/** A bent (90 deg) left leg: hip above knee, ankle forward of the knee. */
function bentLeftLeg(): LandmarkEventPayload[] {
  return [lm('LEFT_HIP', 0.5, 0.3), lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.7, 0.5)];
}

/** A straight (180 deg) left leg: hip, knee and ankle collinear. */
function straightLeftLeg(): LandmarkEventPayload[] {
  return [lm('LEFT_HIP', 0.5, 0.3), lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.5, 0.7)];
}

export function run(): void {
  suite('pose-utils getLandmark', () => {
    const landmarks = bentLeftLeg();

    check('finds a present landmark', getLandmark(landmarks, 'LEFT_KNEE')?.x === 0.5);
    check('returns undefined for an absent name', getLandmark(landmarks, 'RIGHT_KNEE') === undefined);
    check('returns undefined on an empty array', getLandmark([], 'LEFT_HIP') === undefined);

    // Landmarks arrive from MediaPipe in index order; lookup must be by NAME so
    // an upstream re-order cannot silently swap hip/knee/ankle.
    const shuffled = [landmarks[2], landmarks[0], landmarks[1]];
    check('lookup is name-based, not index-based', getLandmark(shuffled, 'LEFT_ANKLE')?.x === 0.7);
    check('shuffle does not return the wrong joint', getLandmark(shuffled, 'LEFT_HIP')?.y === 0.3);
  });

  suite('pose-utils calculateAngle', () => {
    // Collinear points read as a straight 180 deg joint.
    almostEqual(calculateAngle({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.7 }), 180);

    // Perpendicular arms read as 90 deg.
    almostEqual(calculateAngle({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }), 90);

    // The angle is symmetric in its two arms: swapping a and c must not change it.
    const a = { x: 0.5, y: 0.3 };
    const b = { x: 0.5, y: 0.5 };
    const c = { x: 0.7, y: 0.5 };
    almostEqual(calculateAngle(c, b, a), calculateAngle(a, b, c));

    // A fully folded joint reads as 0 deg: both arms point the SAME way from
    // the vertex. (Reversing one arm instead makes the limb straight, not folded.)
    const folded = calculateAngle({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.6 });
    almostEqual(folded, 0);
    check('never exceeds 180', folded <= 180 && calculateAngle(a, b, c) <= 180);
  });

  suite('pose-utils calculateAngle rejects non-finite coordinates', () => {
    const b = { x: 0.5, y: 0.5 };
    const good = { x: 0.7, y: 0.5 };
    const INF = Number.POSITIVE_INFINITY;

    // Without the finite guard atan2 clamps Infinity to +/-90 deg and returns a
    // plausible-looking finite angle, which RepDetector would happily consume.
    check('Infinity in a', Number.isNaN(calculateAngle({ x: INF, y: 0.3 }, b, good)));
    check('Infinity in b', Number.isNaN(calculateAngle(good, { x: INF, y: b.y }, good)));
    check('Infinity in c', Number.isNaN(calculateAngle(good, b, { x: INF, y: 0.5 })));
    check('negative Infinity in a', Number.isNaN(calculateAngle({ x: -INF, y: 0.3 }, b, good)));
    check('Infinity in y', Number.isNaN(calculateAngle({ x: 0.5, y: INF }, b, good)));
    check('NaN in a', Number.isNaN(calculateAngle({ x: Number.NaN, y: 0.3 }, b, good)));
  });

  suite('pose-utils angleFromTriplet happy path', () => {
    almostEqual(angleFromTriplet(bentLeftLeg(), LEFT_TRIPLET, MIN_VIS), 90);
    almostEqual(angleFromTriplet(straightLeftLeg(), LEFT_TRIPLET, MIN_VIS), 180);

    // Only the requested side is read, so an absent opposite leg is irrelevant.
    const leftOnly = [...bentLeftLeg(), lm('RIGHT_HIP', 0.6, 0.3), lm('RIGHT_KNEE', 0.6, 0.5)];
    check(
      'missing opposite ankle does not block the left angle',
      Number.isFinite(angleFromTriplet(leftOnly, LEFT_TRIPLET, MIN_VIS)),
    );
  });

  suite('pose-utils angleFromTriplet rejects unusable frames', () => {
    const NaN_ = Number.NaN;

    check(
      'missing hip is NaN',
      Number.isNaN(angleFromTriplet([lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.5, 0.7)], LEFT_TRIPLET, MIN_VIS)),
    );
    check(
      'missing knee is NaN',
      Number.isNaN(angleFromTriplet([lm('LEFT_HIP', 0.5, 0.3), lm('LEFT_ANKLE', 0.5, 0.7)], LEFT_TRIPLET, MIN_VIS)),
    );
    check(
      'missing ankle is NaN',
      Number.isNaN(angleFromTriplet([lm('LEFT_HIP', 0.5, 0.3), lm('LEFT_KNEE', 0.5, 0.5)], LEFT_TRIPLET, MIN_VIS)),
    );
    check('empty array is NaN', Number.isNaN(angleFromTriplet([], LEFT_TRIPLET, MIN_VIS)));

    // Visibility gate: each joint below the threshold independently rejects.
    check(
      'low-visibility hip is NaN',
      Number.isNaN(
        angleFromTriplet(
          [lm('LEFT_HIP', 0.5, 0.3, 0.1), lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.5, 0.7)],
          LEFT_TRIPLET,
          MIN_VIS,
        ),
      ),
    );
    check(
      'low-visibility knee is NaN',
      Number.isNaN(
        angleFromTriplet(
          [lm('LEFT_HIP', 0.5, 0.3), lm('LEFT_KNEE', 0.5, 0.5, 0.39), lm('LEFT_ANKLE', 0.5, 0.7)],
          LEFT_TRIPLET,
          MIN_VIS,
        ),
      ),
    );
    check(
      'low-visibility ankle is NaN',
      Number.isNaN(
        angleFromTriplet(
          [lm('LEFT_HIP', 0.5, 0.3), lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.5, 0.7, 0)],
          LEFT_TRIPLET,
          MIN_VIS,
        ),
      ),
    );

    // Visibility exactly AT the threshold must be accepted (boundary is inclusive).
    check(
      'visibility exactly at the threshold is accepted',
      Number.isFinite(
        angleFromTriplet(
          [lm('LEFT_HIP', 0.5, 0.3, MIN_VIS), lm('LEFT_KNEE', 0.5, 0.5, MIN_VIS), lm('LEFT_ANKLE', 0.5, 0.7, MIN_VIS)],
          LEFT_TRIPLET,
          MIN_VIS,
        ),
      ),
    );

    // Non-finite coordinates must not leak through as a bogus angle.
    check(
      'NaN coordinate yields NaN, not a number',
      Number.isNaN(
        angleFromTriplet(
          [lm('LEFT_HIP', NaN_, 0.3), lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.5, 0.7)],
          LEFT_TRIPLET,
          MIN_VIS,
        ),
      ),
    );
    check(
      'Infinity coordinate never yields a finite angle',
      !Number.isFinite(
        angleFromTriplet(
          [lm('LEFT_HIP', Number.POSITIVE_INFINITY, 0.3), lm('LEFT_KNEE', 0.5, 0.5), lm('LEFT_ANKLE', 0.5, 0.7)],
          LEFT_TRIPLET,
          MIN_VIS,
        ),
      ),
    );
  });

  suite('pose-utils bent leg sits inside the rep detector rest band', () => {
    // Locks the config to the geometry: a seated 90 deg knee must be BELOW
    // bentAngleDeg (so the machine rests) and a straight leg ABOVE
    // extendedAngleDeg (so it extends). If someone retunes the thresholds, this
    // fails instead of silently making every real rep uncountable.
    const bent = angleFromTriplet(bentLeftLeg(), LEFT_TRIPLET, MIN_VIS);
    const straight = angleFromTriplet(straightLeftLeg(), LEFT_TRIPLET, MIN_VIS);
    const { bentAngleDeg, extendedAngleDeg, minRangeDeg } = SEATED_KNEE_EXTENSION.thresholds;

    check('seated 90 deg knee reads as bent', bent < bentAngleDeg);
    check('straight leg reads as extended', straight >= extendedAngleDeg);
    check('a full rep clears minRangeDeg', straight - bent >= minRangeDeg);
  });
}
