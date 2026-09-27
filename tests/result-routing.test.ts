import { stringify, parse } from 'query-string';

import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import type { SessionMetrics } from '../src/exercise/types';
import {
  buildSessionMetrics,
  formatConsistencyLabel,
  formatDurationLabel,
  formatPaceLabel,
  formatRangeLabel,
} from '../src/exercise/metrics';
import { paramOrFallback, parseRepCountParam } from '../src/exercise/result-params';

/**
 * The result screen receives its numbers as route params, which means they are
 * serialised into a query string and parsed back as untrusted strings. This file
 * verifies BOTH halves of that contract against the real libraries:
 *
 *  - the encode side is what expo-router does in `resolveHref` /
 *    `createQueryParams`: `encodeURIComponent(value.toString())` per param;
 *  - the decode side is `query-string@7`, the exact major expo-router depends
 *    on, which is what parses the href back into params.
 *
 * The interesting case is the knee-range label, which contains non-ASCII
 * characters (U+00B0 degree, U+2013 en dash). This suite proves those survive
 * the round trip byte-for-byte instead of assuming it.
 */

/** Mirrors expo-router's createQueryParams(). */
function encodeParamsLikeRouter(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value.toString())}`)
    .join('&');
}

/** The exact param object the session screen pushes. */
function buildResultParams(
  reps: number,
  durationSeconds: number,
  ranges: number[],
  min: number | null,
  max: number | null,
): { metrics: SessionMetrics; params: Record<string, string> } {
  const metrics = buildSessionMetrics({
    reps,
    durationSeconds,
    repRanges: ranges,
    rangeMinDeg: min,
    rangeMaxDeg: max,
  });
  const params: Record<string, string> = {
    id: SEATED_KNEE_EXTENSION.id,
    reps: String(metrics.reps),
    duration: formatDurationLabel(metrics.durationSeconds),
    pace: formatPaceLabel(metrics.paceRpm),
    range: formatRangeLabel(metrics.rangeMinDeg, metrics.rangeMaxDeg),
    consistency: formatConsistencyLabel(metrics.consistencyPct),
  };
  return { metrics, params };
}

export function run(): void {
  suite('result routing: non-ASCII params survive the router round trip', () => {
    const { params } = buildResultParams(4, 95, [40, 42, 38, 41], 88.4, 169.7);

    // Confirm the fixture is actually exercising non-ASCII, otherwise this suite
    // would pass vacuously.
    check('range label really contains a degree sign', params.range.includes('\u00b0'));
    check('range label really contains an en dash', params.range.includes('\u2013'));

    // Router encode -> router/library decode, exactly as expo-router does it.
    const decoded = parse(encodeParamsLikeRouter(params)) as Record<string, string>;
    for (const key of Object.keys(params)) {
      check(`param "${key}" round trips exactly`, decoded[key] === params[key], {
        sent: params[key],
        received: decoded[key],
      });
    }

    // And the same thing through the query-string encoder expo-router uses when
    // it serialises navigation state (getPathFromState).
    const decoded2 = parse(stringify(params, { sort: false })) as Record<string, string>;
    check('range survives query-string stringify/parse', decoded2.range === params.range);
    check('duration survives query-string stringify/parse', decoded2.duration === params.duration);
  });

  suite('result routing: a zero-rep session is valid and honest', () => {
    const { params } = buildResultParams(0, 40, [], 90, 95);

    check('reps param is "0"', params.reps === '0');
    check('zero reps parses to 0, not null', parseRepCountParam(params.reps) === 0);

    const decoded = parse(encodeParamsLikeRouter(params)) as Record<string, string>;
    check('zero reps survives the round trip as a valid result', parseRepCountParam(decoded.reps) === 0);

    // No reps means no pace and no consistency, but the range was still observed.
    check('pace is honestly absent', params.pace === '--');
    check('consistency is honestly absent', params.consistency === 'Not enough data');
    check('duration is still real', params.duration === '00:40');
  });

  suite('result routing: reps param validation', () => {
    check('"0" is valid', parseRepCountParam('0') === 0);
    check('"1" is valid', parseRepCountParam('1') === 1);
    check('"42" is valid', parseRepCountParam('42') === 42);
    check('surrounding whitespace is tolerated', parseRepCountParam(' 7 ') === 7);

    // Malformed / hostile input must fall back, never render NaN.
    check('undefined is rejected', parseRepCountParam(undefined) === null);
    check('empty string is rejected', parseRepCountParam('') === null);
    check('whitespace only is rejected', parseRepCountParam('   ') === null);
    check('"abc" is rejected', parseRepCountParam('abc') === null);
    check('"NaN" is rejected', parseRepCountParam('NaN') === null);
    check('"Infinity" is rejected', parseRepCountParam('Infinity') === null);
    check('"-1" is rejected', parseRepCountParam('-1') === null);
    check('"-0.5" is rejected', parseRepCountParam('-0.5') === null);
    check('fractional reps are rejected', parseRepCountParam('3.7') === null);
    check('hex is rejected', parseRepCountParam('0x10') === null);
    check('binary is rejected', parseRepCountParam('0b11') === null);
    check('exponent notation is rejected', parseRepCountParam('1e3') === null);
    check('signed plus is rejected', parseRepCountParam('+4') === null);
    check('an array of one is unwrapped', parseRepCountParam(['5']) === 5);
    check('a repeated hex key is rejected', parseRepCountParam(['0x10']) === null);
    check('an ambiguous repeated key is rejected', parseRepCountParam(['5', '6']) === null);
    check('an empty array is rejected', parseRepCountParam([]) === null);

    // Whatever the input, the result is always renderable.
    for (const bad of ['', ' ', 'abc', '-1', '3.7', 'NaN', 'Infinity', undefined, ['5', '6']]) {
      const v = parseRepCountParam(bad as string);
      check(`no NaN/Infinity leaks for ${JSON.stringify(bad)}`, v === null || (Number.isFinite(v) && v >= 0));
    }
  });

  suite('result routing: display params fall back instead of rendering blank', () => {
    check('missing duration falls back', paramOrFallback(undefined, '--') === '--');
    check('empty duration falls back', paramOrFallback('', '--') === '--');
    check('whitespace duration falls back', paramOrFallback('  ', '--') === '--');
    check('real duration is preserved', paramOrFallback('01:35', '--') === '01:35');
    check('real range is preserved', paramOrFallback('88° – 170°', '--') === '88° – 170°');
    check('real consistency is preserved', paramOrFallback('86%', 'Not enough data') === '86%');
    check('honest consistency default is used', paramOrFallback(undefined, 'Not enough data') === 'Not enough data');
    check('repeated key uses the last value', paramOrFallback(['--', '4.5'], '--') === '4.5');
  });

  suite('result routing: a crafted deep link cannot put NaN or Infinity on screen', () => {
    // The result screen is deep-linkable, so these params are attacker-controlled
    // strings. Anything non-finite must be replaced by the honest fallback.
    const hostile = [
      'NaN',
      'nan',
      'NAN',
      'Infinity',
      '-Infinity',
      'infinity',
      'NaN%',
      'NaN rpm',
      'NaN° – 170°',
      '12 – NaN',
      'undefined',
      'null',
    ];
    for (const value of hostile) {
      check(`pace "${value}" falls back`, paramOrFallback(value, '--') === '--');
      check(`duration "${value}" falls back`, paramOrFallback(value, '--') === '--');
      check(`range "${value}" falls back`, paramOrFallback(value, '--') === '--');
      check(`consistency "${value}" falls back`, paramOrFallback(value, 'Not enough data') === 'Not enough data');
    }

    // Genuine values must survive the same filter untouched.
    check('"4.6" survives', paramOrFallback('4.6', '--') === '4.6');
    check('"0.0" survives', paramOrFallback('0.0', '--') === '0.0');
    check('"01:35" survives', paramOrFallback('01:35', '--') === '01:35');
    check('"86%" survives', paramOrFallback('86%', '--') === '86%');
    check('"88° – 170°" survives', paramOrFallback('88° – 170°', '--') === '88° – 170°');
    check('"Not enough data" survives', paramOrFallback('Not enough data', '--') === 'Not enough data');

    // Nothing that reaches an InfoRow may contain a non-finite token.
    for (const value of [...hostile, '4.6', '01:35', '86%', '88° – 170°']) {
      const shown = paramOrFallback(value, '--');
      check(`rendered "${value}" has no NaN/Infinity`, !/\b(?:nan|infinity|undefined|null)\b/i.test(shown), shown);
    }

    // The sentinel filter must match whole words only, never inside a real word.
    check('"Nullify your range" is not filtered', paramOrFallback('Nullify your range', '--') === 'Nullify your range');
    check('"Infinitys rest" is not filtered', paramOrFallback('Infinitys rest', '--') === 'Infinitys rest');
    check('"nullable" is not filtered', paramOrFallback('nullable', '--') === 'nullable');
    check('"Not enough data" is not filtered', paramOrFallback('Not enough data', '--') === 'Not enough data');
    // ...but a partially corrupt value is still caught.
    check('"NaN° – 170°" is filtered', paramOrFallback('NaN° – 170°', '--') === '--');
  });

  suite('result routing: no metric can serialise to NaN or Infinity', () => {
    const cases = [
      buildResultParams(0, 0, [], null, null),
      buildResultParams(1, 1, [40], null, null),
      buildResultParams(0, 3599, [], 0, 0),
      buildResultParams(99, 15, [25, 100, 26], 89.999, 170.001),
    ];

    for (const { params, metrics } of cases) {
      for (const [key, value] of Object.entries(params)) {
        check(`param "${key}" is not NaN`, !value.includes('NaN'), value);
        check(`param "${key}" is not Infinity`, !value.includes('Infinity'), value);
      }
      check('duration metric is finite', Number.isFinite(metrics.durationSeconds));
      check('pace metric is null or finite', metrics.paceRpm === null || Number.isFinite(metrics.paceRpm));
      check('range metrics are null or finite', (metrics.rangeMinDeg === null || Number.isFinite(metrics.rangeMinDeg)) && (metrics.rangeMaxDeg === null || Number.isFinite(metrics.rangeMaxDeg)));
      check('consistency is null or finite', metrics.consistencyPct === null || Number.isFinite(metrics.consistencyPct));
    }
  });
}
