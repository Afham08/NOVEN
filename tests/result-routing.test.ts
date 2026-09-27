import { stringify, parse } from 'query-string';

// The test harness is deliberately zero-dependency and tsconfig.test.json has no
// `node` types, so the two module reads used by the wiring suite below are
// declared here rather than pulling in @types/node for the whole suite.
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

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
import {
  formatPaceParamLabel,
  paramOrFallback,
  parseConsistencyParam,
  parseDurationParam,
  parsePaceParam,
  parseRangeParam,
  parseRepCountParam,
} from '../src/exercise/result-params';

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

  // ==========================================================================
  // The result screen is DEEP-LINKABLE, so `duration` / `pace` / `range` /
  // `consistency` are as much attacker-controlled as `reps` is. `reps` has
  // always been validated strictly; before these tests the other four went
  // through `paramOrFallback`, which only blacklists the NaN / Infinity /
  // undefined / null sentinels and otherwise passes the string straight into an
  // InfoRow. A crafted link could therefore render a complete, plausible-looking,
  // clinically-flavoured result for a session that never happened.
  // ==========================================================================

  suite('result routing: the reps param rejects non-strings instead of throwing', () => {
    // `useLocalSearchParams` is typed as returning strings, but that is a claim
    // about the route, not a guarantee: a number, boolean or object reaching
    // `.trim` took the whole screen down, so the "Result not available" fallback
    // could never render. `paramOrFallback` always had this guard; `reps` did not.
    const notStrings: unknown[] = [
      0,
      42,
      -1,
      3.7,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e21,
      true,
      false,
      {},
      { reps: 5 },
      [5],
      [],
      () => 5,
      Symbol.iterator === undefined ? 0 : new String('5'),
    ];
    for (const value of notStrings) {
      let result: unknown;
      let threw: unknown = null;
      try {
        result = parseRepCountParam(value as string);
      } catch (error) {
        threw = error;
      }
      check(`${String(typeof value)} param does not throw`, threw === null, String(threw));
      check(`${String(typeof value)} param is rejected`, result === null, result);
    }

    // A rep count beyond exact integer representation is not displayable as
    // written, and no session can produce one.
    check('an unsafe integer is rejected', parseRepCountParam('9007199254740993') === null);
    check('21 digits is rejected', parseRepCountParam('100000000000000000000') === null);
    // ...but everything up to MAX_SAFE_INTEGER still works.
    check('MAX_SAFE_INTEGER is accepted', parseRepCountParam('9007199254740991') === 9007199254740991);
  });

  suite('result routing: every value the real formatters produce is accepted', () => {
    // The strongest possible statement of "no genuine value is ever lost": sweep
    // the whole output space of each formatter in metrics.ts and require the
    // matching validator to return it byte-for-byte.
    let mismatches = 0;
    for (let s = 0; s <= 7200; s++) {
      const label = formatDurationLabel(s);
      if (parseDurationParam(label) !== label) mismatches++;
    }
    check('every duration label from 00:00 to 120:00 is accepted', mismatches === 0, mismatches);

    let paceMisses = 0;
    for (let r = 0; r <= 400; r += 0.01) {
      const label = formatPaceLabel(r);
      if (parsePaceParam(label) !== label) paceMisses++;
    }
    check('every pace label from 0.00 to 400.00 is accepted', paceMisses === 0, paceMisses);
    for (const value of [null, 0, 1, 50, 86, 99, 100]) {
      const label = formatPaceLabel(value);
      if (parsePaceParam(label) !== label) paceMisses++;
    }
    check('the absent-pace label is accepted', paceMisses === 0, paceMisses);

    let rangeMisses = 0;
    for (let lo = 0; lo <= 180; lo += 0.5) {
      for (let hi = lo; hi <= 180; hi += 7) {
        const label = formatRangeLabel(lo, hi);
        if (parseRangeParam(label) !== label) rangeMisses++;
      }
    }
    check('every range label from 0deg to 180deg is accepted', rangeMisses === 0, rangeMisses);
    for (const [a, b] of [[null, null], [null, 170], [90, null]] as const) {
      const label = formatRangeLabel(a, b);
      if (parseRangeParam(label) !== label) rangeMisses++;
    }
    check('the absent-range label is accepted', rangeMisses === 0, rangeMisses);

    let consistencyMisses = 0;
    for (const value of [null, 0, 1, 50, 86, 99, 100]) {
      const label = formatConsistencyLabel(value);
      if (parseConsistencyParam(label) !== label) consistencyMisses++;
    }
    check('every consistency label is accepted', consistencyMisses === 0, consistencyMisses);

    // And the whole pipeline: build metrics, format them, parse them back.
    for (const [reps, seconds, ranges, min, max] of [
      [0, 0, [], null, null],
      [1, 15, [40], 88.4, 169.7],
      [0, 40, [], 90, 95],
      [12, 600, [25, 100, 26, 26, 99], 89.999, 170.001],
      [5, 14, [40, 40, 40, 40, 40], null, null],
    ] as [number, number, number[], number | null, number | null][]) {
      const { params } = buildResultParams(reps, seconds, ranges, min, max);
      check('duration survives the pipeline', parseDurationParam(params.duration) === params.duration, params.duration);
      check('pace survives the pipeline', parsePaceParam(params.pace) === params.pace, params.pace);
      check('range survives the pipeline', parseRangeParam(params.range) === params.range, params.range);
      check('consistency survives the pipeline', parseConsistencyParam(params.consistency) === params.consistency, params.consistency);
    }
  });

  suite('result routing: malformed display params cannot reach an InfoRow', () => {
    // Each entry is [field, value, honestFallback].
    const cases: [string, unknown, string][] = [
      ['duration', '-1', '--'],
      ['duration', '3.7', '--'],
      ['duration', '1e3', '--'],
      ['duration', '0x10', '--'],
      ['duration', '0b11', '--'],
      ['duration', '0o17', '--'],
      ['duration', '00:99', '--'],
      ['duration', '00:60', '--'],
      ['duration', '0:00', '--'],
      ['duration', '1:2:3', '--'],
      ['duration', '99', '--'],
      ['duration', 'abc', '--'],
      ['duration', '00:35.7', '--'],
      ['duration', '00:35;DROP', '--'],
      ['duration', '1'.repeat(300), '--'],
      ['duration', {}, '--'],
      ['duration', 0, '--'],

      ['pace', '-1', '--'],
      ['pace', '4', '--'],
      ['pace', '4.55', '--'],
      ['pace', '1e3', '--'],
      ['pace', '0x10', '--'],
      ['pace', '4.5 rpm', '--'],
      ['pace', 'NaN%', '--'],
      ['pace', '4,5', '--'],
      ['pace', '1'.repeat(300), '--'],
      ['pace', null, '--'],

      ['range', '170° – 88°', '--'],
      ['range', '-1° – 5°', '--'],
      ['range', '1e3° – 2°', '--'],
      ['range', 'NaN° – 170°', '--'],
      ['range', '88-170', '--'],
      ['range', '88° 88°', '--'],
      ['range', '88° – 170° – 5°', '--'],
      ['range', '1'.repeat(300) + '° – 2°', '--'],
      ['range', [], '--'],

      ['consistency', '-1%', '--'.replace('--', 'Not enough data')],
      ['consistency', '1e3%', 'Not enough data'],
      ['consistency', '100.4%', 'Not enough data'],
      ['consistency', '86 %', 'Not enough data'],
      ['consistency', 'NaN%', 'Not enough data'],
      ['consistency', '86%%', 'Not enough data'],
      ['consistency', '9'.repeat(300) + '%', 'Not enough data'],
      ['consistency', 0, 'Not enough data'],
    ];

    const parse = (field: string, value: unknown): string => {
      if (field === 'duration') return parseDurationParam(value as string);
      if (field === 'pace') return parsePaceParam(value as string);
      if (field === 'range') return parseRangeParam(value as string);
      return parseConsistencyParam(value as string);
    };

    for (const [field, value, honest] of cases) {
      check(`${field} ${JSON.stringify(value)} falls back to "${honest}"`, parse(field, value) === honest, parse(field, value));
    }

    // The specific fabrication this closes: a deep link that dresses up a
    // clinical claim, markup or injected line as one of the four metrics.
    const fabrications = [
      '98% ROM (normal)',
      'Diagnosed osteoarthritis',
      '<b>99%</b>',
      '99%\nDANGER',
      '[object Object]',
      'within normal limits',
      '0x10',
    ];
    for (const value of fabrications) {
      check(`pace rejects ${JSON.stringify(value)}`, parsePaceParam(value) === '--', parsePaceParam(value));
      check(`range rejects ${JSON.stringify(value)}`, parseRangeParam(value) === '--', parseRangeParam(value));
      check(`duration rejects ${JSON.stringify(value)}`, parseDurationParam(value) === '--', parseDurationParam(value));
      check(`consistency rejects ${JSON.stringify(value)}`, parseConsistencyParam(value) === 'Not enough data', parseConsistencyParam(value));
    }

    // The genuine shapes, and only those, still render.
    check('a real duration renders', parseDurationParam('09:49') === '09:49');
    check('a real pace renders', parsePaceParam('4.5') === '4.5');
    check('a zero pace renders', parsePaceParam('0.0') === '0.0');
    check('a real range renders', parseRangeParam('88° – 170°') === '88° – 170°');
    check('a zero consistency renders', parseConsistencyParam('0%') === '0%');
    check('a hundred percent consistency renders', parseConsistencyParam('100%') === '100%');
    check('insufficient consistency renders', parseConsistencyParam('Not enough data') === 'Not enough data');

    // Surrounding whitespace is normalised rather than rejected, so a value
    // that is genuine apart from padding still shows its real content.
    check('padded duration is trimmed, not dropped', parseDurationParam(' 01:35 ') === '01:35');
    check('padded range is trimmed, not dropped', parseRangeParam(' 88° – 170° ') === '88° – 170°');
  });

  suite('result routing: the knee range keeps its degree symbols and its order', () => {
    // STEP 5: the expected display is "88deg - 170deg" with the degree symbol on
    // both ends. The engine builds its range with Math.min/Math.max, so a
    // descending pair can only come from outside the app.
    const expected = '88° – 170°';
    check('the formatter produces the expected format', formatRangeLabel(88, 170) === expected, formatRangeLabel(88, 170));
    check('the validator passes the expected format', parseRangeParam(expected) === expected);
    check('the expected format survives the router round trip', parseRangeParam(String(parse(encodeParamsLikeRouter({ range: expected })).range)) === expected);

    check('the degree symbol is on both ends', (expected.match(/°/g) ?? []).length === 2);
    check('the separator is an en dash, not a hyphen', expected.includes('–') && !expected.includes('-'));
    check('an ASCII hyphen range is rejected', parseRangeParam('88° - 170°') === '--');
    check('a reversed range is rejected', parseRangeParam('170° – 88°') === '--');
    check('a negative angle is rejected', parseRangeParam('-8° – 170°') === '--');
    check('a missing degree symbol is rejected', parseRangeParam('88 – 170') === '--');
    check('a fractional angle is rejected', parseRangeParam('88.4° – 170°') === '--');
    check('an equal pair is valid', parseRangeParam('90° – 90°') === '90° – 90°');
  });

  suite('result routing: the result screen routes every metric through a validator', () => {
    // The suites above prove the validators work. Nothing else proves the screen
    // still USES them: result.tsx is a React component, and this project has no
    // renderer, so a future refactor could quietly put paramOrFallback back and
    // every other test would stay green while the screen went back to accepting
    // any string. Asserting on the source is the only check available here, and
    // it fails loudly the moment a metric loses its guard.
    const source = readFileSync(resolve(__dirname, '../../src/app/exercise/result.tsx'), 'utf8');

    // Confirm the fixture is the real screen, not an empty or stub read.
    check('the result screen source was actually read', source.includes('export default function ResultScreen'));
    check('the screen does render InfoRows', source.includes('<InfoRow'));

    // Keyed on the VALIDATOR, not the label, so rewording a label (which is
    // expected to happen) can never silently disarm this check.
    for (const validator of [
      'parseDurationParam',
      'formatPaceParamLabel',
      'parseRangeParam',
      'parseConsistencyParam',
    ]) {
      check(
        `an InfoRow value comes from ${validator}`,
        new RegExp(`<InfoRow[\\s\\S]{0,200}?value=\\{${validator}\\(`).test(source),
        `no ${validator}( call feeding an InfoRow`,
      );
    }

    // The bare pass-through must not reach ANY metric row again.
    const infoRows = source.match(/<InfoRow[\s\S]*?\/>/g) ?? [];
    check('the screen still has four metric rows', infoRows.length === 4, infoRows.length);
    for (const row of infoRows) {
      check(
        'no metric row reads its value through paramOrFallback',
        !row.includes('paramOrFallback('),
        row,
      );
      check('every metric row still reads one of the params', /value=\{[a-zA-Z]+\(/.test(row), row);
    }

    // The rep hero number stays on the strict count parser, and is still what
    // gates the whole screen.
    check('the rep count still uses parseRepCountParam', source.includes('parseRepCountParam(reps)'));
    check('the rep count is still the gate for the whole screen', source.includes('!exercise || repCount === null'));
  });

  suite('result screen: the wording stays plain and non-clinical', () => {
    // The brief for this screen is that an older adult can read it immediately.
    // That is only true while the labels stay in everyday language, and NOVEN
    // reports what the camera observed during an exercise — it never assesses
    // the person. Banned wording is checked here because it can creep back in
    // with any label edit, and nothing else in the suite would notice.
    const source = readFileSync(resolve(__dirname, '../../src/app/exercise/result.tsx'), 'utf8');

    // Every piece of copy the reader actually sees: the header titles, the four
    // metric labels, the two button titles, the hero label and the one
    // explanation sentence. Comments are excluded on purpose — this file
    // discusses several of these terms precisely in order to rule them out.
    const strings = [
      ...[...source.matchAll(/(?:label|title)="([^"]*)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/\{exerciseWord\} completed/g)].map((m) => m[0]),
      ...[...source.matchAll(/These results[^<]*/g)].map((m) => m[0].trim()),
    ].filter((s) => s.length > 0);

    check('the screen really has user-facing strings to check', strings.length >= 8, strings);

    const banned = [
      'accuracy',
      'score',
      'diagnos',
      'medical',
      'clinical',
      'assess',
      'knee health',
      'healthy',
      'unhealthy',
      'condition',
      'injur',
      'rehab',
      'pain',
      'grade',
      'perform',
      'norm',
    ];
    for (const word of banned) {
      const offenders = strings.filter((s) => s.toLowerCase().includes(word));
      check(`no user-facing string says "${word}"`, offenders.length === 0, offenders);
    }

    // The specific labels this screen is supposed to use.
    check('the hero reads as a completed count', strings.includes('{exerciseWord} completed'), strings);
    check('the time row is labelled "Time"', strings.includes('Time'));
    check('the pace row is labelled in plain language', strings.includes('Movement pace'));
    check('the range row is labelled in plain language', strings.includes('Movement range'));
    check('the consistency row is labelled in plain language', strings.includes('Movement consistency'));
    check('the screen leads with a session-complete heading', strings.includes('Session Complete'));
    check('the primary action is still "Done"', strings.includes('Done'));
    // The exercise-specific anatomical label is gone from the visible rows.
    check('no visible row says "Knee"', !strings.some((s) => s.includes('Knee')), strings);

    // Exactly one short explanation, and it is a sentence rather than a
    // paragraph describing every metric.
    const sentences = strings.filter((s) => s.startsWith('These results'));
    check('there is exactly one explanation sentence', sentences.length === 1, sentences);
    if (sentences.length === 1) {
      check('the explanation is short', sentences[0].length <= 90, sentences[0].length);
      check('the explanation is one sentence', (sentences[0].match(/\./g) ?? []).length === 1, sentences[0]);
    }
  });

  suite('result screen: the completed count is the main result', () => {
    const source = readFileSync(resolve(__dirname, '../../src/app/exercise/result.tsx'), 'utf8');

    // The count must be the largest number on the screen. Compared against the
    // biggest figure in the theme's type scale, so this keeps holding if the
    // scale is retuned.
    const heroSize = Number(source.match(/heroNumber:[\s\S]*?fontSize: (\d+)/)?.[1] ?? '0');
    check('the hero number is set explicitly', heroSize > 0, heroSize);
    check('the hero number is at least 64px', heroSize >= 64, heroSize);
    check('the hero number uses tabular figures so it does not jitter', source.includes('fontVariant: [\'tabular-nums\']'));

    // It comes from the session result, never from a literal.
    check('the hero renders the validated count', /\{repCount\}/.test(source));
    check('the hero contains no hardcoded count', !/\{?\d+\}?\s*\n\s*exercises completed/.test(source));

    // Singular/plural is decided from the real value, so a 1-rep session does
    // not read "1 exercises completed" and a 0-rep session is still honest.
    check('singular and plural are both handled', source.includes("repCount === 1 ? 'exercise' : 'exercises'"));

    // A screen reader should hear the whole phrase, not a bare digit.
    check('the hero is one accessible element', /accessible\b/.test(source));
    check('the hero carries a spoken label', source.includes('${repCount} ${exerciseWord} completed'));
    check('the hero is announced as a header', source.includes("accessibilityRole=\"header\""));

    // The count still gates the screen, so a malformed param cannot reach a
    // half-rendered result.
    check('a malformed count still falls back to the notice screen', source.includes('Result not available'));
  });

  suite('result screen: the pace unit is added only to a real measurement', () => {
    // formatPaceLabel writes a bare number, which means nothing on its own, so
    // the unit is added after validation. "-- / min" would claim a pace exists
    // when it does not, so the absent case must stay bare.
    check('a real pace gets its unit', formatPaceParamLabel('2.1') === '2.1 / min');
    check('a zero pace is still a real pace', formatPaceParamLabel('0.0') === '0.0 / min');
    check('a fast pace gets its unit', formatPaceParamLabel('12.0') === '12.0 / min');

    check('the absent pace stays bare', formatPaceParamLabel('--') === '--');
    check('a missing pace stays bare', formatPaceParamLabel(undefined) === '--');
    check('a whitespace pace stays bare', formatPaceParamLabel('   ') === '--');

    // Every rejected shape must also stay bare, never acquire a unit.
    for (const bad of ['NaN', 'Infinity', '-Infinity', '-1.0', '4', '1e3', '0x10', '4.5 rpm', 'NaN%', 'null', 'undefined', '3'.repeat(200)]) {
      check(`"${bad}" stays bare`, formatPaceParamLabel(bad) === '--', formatPaceParamLabel(bad));
    }
    for (const bad of [undefined, null, [], {}, 0, 4.5, true]) {
      check(`non-string ${String(bad)} stays bare`, formatPaceParamLabel(bad as string) === '--', formatPaceParamLabel(bad as string));
    }

    // The unit is a display concern only: the param itself is unchanged, so the
    // value still round-trips through the router and still parses.
    const label = formatPaceParamLabel('4.5');
    check('the raw param behind the decorated label is unchanged', label.startsWith('4.5'));
    check('the raw param still validates', parsePaceParam('4.5') === '4.5');
    check('the raw param still survives the router', parsePaceParam(String(parse(encodeParamsLikeRouter({ pace: '4.5' })).pace)) === '4.5');
  });
}
