import type { LandmarkEventPayload, PoseLandmarkName } from '../../modules/pose-tracker';

import type { AngleTriplet } from './types';

export type Point2D = { x: number; y: number };

/**
 * Returns the landmark that matches `name`, or undefined when absent.
 * Landmarks arrive as an array with globally unique `name` fields, so name is
 * the lookup key (not array index) to stay resilient to upstream ordering.
 */
export function getLandmark(
  landmarks: LandmarkEventPayload[],
  name: PoseLandmarkName,
): LandmarkEventPayload | undefined {
  return landmarks.find((landmark) => landmark.name === name);
}

/**
 * Interior angle (degrees, 0..180) at vertex `b` formed by points a–b–c,
 * computed in 2D using normalized x/y coordinates.
 *
 * Returns NaN when a vertex is missing OR when any coordinate is not finite.
 * The finite check is load-bearing: IEEE propagation already turns a NaN
 * coordinate into NaN, but an Infinity coordinate collapses to a plausible
 * looking finite angle (atan2 clamps it to ±90 deg), which would let a corrupt
 * model frame pose as a real knee angle and drive the rep machine. NaN is
 * rejected downstream by RepDetector and the readiness gate, so failing here
 * keeps garbage out of the rep cycle and out of the knee-range metric.
 */
export function calculateAngle(a: Point2D, b: Point2D, c: Point2D): number {
  if (!a || !b || !c) return Number.NaN;
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return Number.NaN;
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return Number.NaN;
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return Number.NaN;

  const radAnglePq =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let degrees = Math.abs((radAnglePq * 180) / Math.PI);
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

/**
 * Computes the single joint angle for one angle triplet, or NaN when any of
 * the three required landmarks is missing or below the minimum visibility.
 */
export function angleFromTriplet(
  landmarks: LandmarkEventPayload[],
  triplet: AngleTriplet,
  minVisibility: number,
): number {
  const hip = getLandmark(landmarks, triplet.hip);
  const knee = getLandmark(landmarks, triplet.knee);
  const ankle = getLandmark(landmarks, triplet.ankle);

  if (!hip || !knee || !ankle) return Number.NaN;
  if (hip.visibility < minVisibility || knee.visibility < minVisibility || ankle.visibility < minVisibility) {
    return Number.NaN;
  }

  return calculateAngle(hip, knee, ankle);
}