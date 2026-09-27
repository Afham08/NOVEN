import { almostEqual, check, suite } from './harness';

import {
  buildSessionMetrics,
  formatConsistencyLabel,
  formatDurationLabel,
  formatPaceLabel,
  formatRangeLabel,
} from '../src/exercise/metrics';

/**
 * Metrics are pure and fully deterministic, so every edge case the result screen
 * can hit is verifiable here without a device. The contract under test is the
 * HONEST one: when there is not enough data the result screen must show "--" or
 * "Not enough data", never a fabricated number and never NaN/Infinity.
 */

const NONE = null;

export function run(): void {
  suite('metrics: pace needs reps AND enough time', () => {
    // Zero reps -> no pace, regardless of duration.
    check(
      'zero reps never reports pace',
      buildSessionMetrics({
        reps: 0,
        durationSeconds: 120,
        repRanges: [],
        rangeMinDeg: 90,
        rangeMaxDeg: 170,
      }).paceRpm === NONE,
    );

    // Reps but too short a session -> no pace (below the 15s floor).
    check(
      'short session with reps reports no pace',
      buildSessionMetrics({
        reps: 3,
        durationSeconds: 14,
        repRanges: [40, 40, 40],
        rangeMinDeg: 90,
        rangeMaxDeg: 170,
      }).paceRpm === NONE,
    );

    // One rep in 30s == 2 reps/min.
    almostEqual(
      buildSessionMetrics({
        reps: 1,
        durationSeconds: 30,
        repRanges: [40],
        rangeMinDeg: 90,
        rangeMaxDeg: 170,
      }).paceRpm as number,
      2,
    );

    // Six reps in 60s == 6 rpm.
    almostEqual(
      buildSessionMetrics({
        reps: 6,
        durationSeconds: 60,
        repRanges: [40, 40, 40, 40, 40, 40],
        rangeMinDeg: 90,
        rangeMaxDeg: 170,
      }).paceRpm as number,
      6,
    );

    // Duration exactly at the 15s floor is enough.
    check(
      'exactly 15s is enough for pace',
      buildSessionMetrics({
        reps: 1,
        durationSeconds: 15,
        repRanges: [40],
        rangeMinDeg: NONE,
        rangeMaxDeg: NONE,
      }).paceRpm !== NONE,
    );

    // Zero duration must never divide by zero.
    const zeroDuration = buildSessionMetrics({
      reps: 5,
      durationSeconds: 0,
      repRanges: [40, 40, 40, 40, 40],
      rangeMinDeg: NONE,
      rangeMaxDeg: NONE,
    });
    check('zero duration yields no pace', zeroDuration.paceRpm === NONE);
    check('zero duration never yields NaN', !Number.isNaN(zeroDuration.paceRpm as number));
  });

  suite('metrics: consistency needs at least two reps', () => {
    check(
      'one rep is not enough for consistency',
      buildSessionMetrics({
        reps: 1,
        durationSeconds: 60,
        repRanges: [42],
        rangeMinDeg: NONE,
        rangeMaxDeg: NONE,
      }).consistencyPct === NONE,
    );

    check(
      'zero reps is not enough for consistency',
      buildSessionMetrics({
        reps: 0,
        durationSeconds: 60,
        repRanges: [],
        rangeMinDeg: NONE,
        rangeMaxDeg: NONE,
      }).consistencyPct === NONE,
    );

    // Two identical ranges == perfectly consistent == 100%.
    check(
      'identical ranges give 100%',
      buildSessionMetrics({
        reps: 2,
        durationSeconds: 60,
        repRanges: [50, 50],
        rangeMinDeg: NONE,
        rangeMaxDeg: NONE,
      }).consistencyPct === 100,
    );

    // stddev >= mean makes the spread ratio 1, which clamps to 0 (never negative).
    const wild = buildSessionMetrics({
      reps: 2,
      durationSeconds: 60,
      repRanges: [0, 100],
      rangeMinDeg: NONE,
      rangeMaxDeg: NONE,
    }).consistencyPct as number;
    check('maximal spread clamps to 0', wild === 0);
    check('consistency is never negative', wild >= 0);
    check('consistency never exceeds 100', wild <= 100);

    // A large-but-not-maximal spread is low without bottoming out at 0.
    const lowSpread = buildSessionMetrics({
      reps: 2,
      durationSeconds: 60,
      repRanges: [10, 90],
      rangeMinDeg: NONE,
      rangeMaxDeg: NONE,
    }).consistencyPct as number;
    check('large spread is low but positive', lowSpread > 0 && lowSpread < 50);

    // Partial spread lands strictly between the bounds and is an integer.
    const partial = buildSessionMetrics({
      reps: 3,
      durationSeconds: 60,
      repRanges: [40, 50, 60],
      rangeMinDeg: NONE,
      rangeMaxDeg: NONE,
    }).consistencyPct as number;
    check('partial spread is between 0 and 100', partial > 0 && partial < 100);
    check('consistency is a whole number', Number.isInteger(partial));

    // All-zero ranges (mean 0) must not divide by zero.
    const zeroMean = buildSessionMetrics({
      reps: 2,
      durationSeconds: 60,
      repRanges: [0, 0],
      rangeMinDeg: NONE,
      rangeMaxDeg: NONE,
    }).consistencyPct as number;
    check('zero-mean ranges give 0, not NaN', zeroMean === 0);
  });

  suite('metrics: knee range passes through untouched', () => {
    const noData = buildSessionMetrics({
      reps: 0,
      durationSeconds: 30,
      repRanges: [],
      rangeMinDeg: NONE,
      rangeMaxDeg: NONE,
    });
    check('absent min stays null', noData.rangeMinDeg === NONE);
    check('absent max stays null', noData.rangeMaxDeg === NONE);

    const withData = buildSessionMetrics({
      reps: 1,
      durationSeconds: 30,
      repRanges: [80],
      rangeMinDeg: 88.4,
      rangeMaxDeg: 169.7,
    });
    almostEqual(withData.rangeMinDeg as number, 88.4);
    almostEqual(withData.rangeMaxDeg as number, 169.7);
  });

  suite('metrics: reps and duration are reported verbatim', () => {
    const m = buildSessionMetrics({
      reps: 4,
      durationSeconds: 95,
      repRanges: [40, 42, 38, 41],
      rangeMinDeg: 90,
      rangeMaxDeg: 170,
    });
    check('reps pass through', m.reps === 4);
    // Paused time is excluded upstream, so the timer value is used as-is.
    check('duration passes through', m.durationSeconds === 95);
  });

  suite('metrics: formatDurationLabel', () => {
    check('zero is 00:00', formatDurationLabel(0) === '00:00');
    check('single digit seconds is padded', formatDurationLabel(5) === '00:05');
    check('one minute', formatDurationLabel(60) === '01:00');
    check('mixed', formatDurationLabel(95) === '01:35');
    check('long session', formatDurationLabel(3600) === '60:00');
  });

  suite('metrics: formatPaceLabel', () => {
    check('null pace is --', formatPaceLabel(NONE) === '--');
    check('one decimal place', formatPaceLabel(4.5) === '4.5');
    check('rounds up at the boundary', formatPaceLabel(4.46) === '4.5');
    check('rounds down below the boundary', formatPaceLabel(4.44) === '4.4');
    check('rounds to one decimal', formatPaceLabel(6) === '6.0');
    check('never prints NaN for null', !formatPaceLabel(NONE).includes('NaN'));
  });

  suite('metrics: formatRangeLabel', () => {
    check('both null is --', formatRangeLabel(NONE, NONE) === '--');
    check('missing min is --', formatRangeLabel(NONE, 170) === '--');
    check('missing max is --', formatRangeLabel(90, NONE) === '--');
    check('both present is rounded degrees', formatRangeLabel(88.4, 169.7) === '88° – 170°');
  });

  suite('metrics: formatConsistencyLabel', () => {
    check('null is the honest insufficient-data label', formatConsistencyLabel(NONE) === 'Not enough data');
    check('a value renders as a percentage', formatConsistencyLabel(86) === '86%');
    check('zero renders as 0%', formatConsistencyLabel(0) === '0%');
  });
}
