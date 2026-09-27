/**
 * Parsing for the values that cross the navigation boundary into the result
 * screen. `router.push` serialises params into a query string and the receiving
 * screen reads them back as untrusted strings, so every value the result screen
 * renders from a param must survive a round trip and be re-validated on arrival.
 *
 * This lives outside the route file so it can be unit tested: a guard buried in
 * a component body cannot be exercised without a React renderer.
 */

/** Shape a route param can take: a single value, or repeats of one key. */
export type ResultParam = string | string[] | undefined;

/**
 * Validates the `reps` param and returns the rep count, or null when the screen
 * must show its "not available" fallback.
 *
 * `0` is a legitimate completed session and must NOT be treated as missing.
 * Anything that is not a plain decimal whole number is rejected, including
 * "0x10" and "1e3" which a bare `Number()` would silently coerce.
 *
 * Repeated query keys arrive as an array (this is what the `query-string` parser
 * expo-router uses produces). A single-element array is the normal shape for a
 * param that was written once, so it is unwrapped; a multi-element array means
 * the value is ambiguous and is rejected.
 */
export function parseRepCountParam(reps: ResultParam): number | null {
  if (reps === undefined || reps === null) return null;

  const raw = Array.isArray(reps) ? (reps.length === 1 ? reps[0] : undefined) : reps;
  if (raw === undefined || raw === null) return null;

  // Params are untrusted, and `useLocalSearchParams` types are a claim rather
  // than a guarantee. Without this guard a number/boolean/object param reaches
  // `.trim` below and throws, which would take the whole screen down instead of
  // falling back — `paramOrFallback` has always had this check.
  if (typeof raw !== 'string') return null;

  // An empty or whitespace-only param is missing, not zero.
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Digits only. Plain `Number()` would also accept "0x10" (16), "1e3" (1000)
  // and " 0b11 " (3), so a hand-crafted link could render a plausible looking
  // but fabricated rep count. The session screen always writes `String(int)`,
  // so requiring decimal digits cannot reject a genuine value.
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;

  // A count above Number.MAX_SAFE_INTEGER cannot be represented exactly, so the
  // digits the screen would render are already an approximation — and a 21-digit
  // string is not something any session can produce. This is a property of the
  // number type, not a chosen cap on reps.
  if (!Number.isSafeInteger(value)) return null;

  return value;
}

/**
 * Matches the JavaScript sentinels that mean "no value": NaN, Infinity (either
 * sign), and the literal words undefined / null. Any of these reaching an
 * InfoRow would be rendered verbatim on the results screen — "NaN" as a pace,
 * "undefined" as a duration — so they are treated as missing.
 *
 * Matched as whole words on purpose: a substring test would also swallow
 * legitimate text ("Nullify", "Infinity's theorem"), and it still catches a
 * partially-corrupt value such as "NaN° – 170°" where the sentinel is one token
 * among several.
 */
const NO_VALUE = /\b(?:nan|infinity|undefined|null)\b/i;

/**
 * Returns a display string for an optional text param, or the given fallback.
 *
 * The result screen is deep-linkable, so these arrive as arbitrary strings. A
 * missing, empty, or malformed value must fall back rather than render: an empty
 * `InfoRow` would otherwise be a blank line, and a hand-written `?pace=NaN`
 * would put a non-number on an elderly user's results screen.
 */
export function paramOrFallback(param: ResultParam, fallback: string): string {
  if (param === undefined || param === null) return fallback;
  const raw = Array.isArray(param) ? param[param.length - 1] : param;
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  if (NO_VALUE.test(trimmed)) return fallback;
  return trimmed;
}

// ===========================================================================
// Per-field validators
//
// `paramOrFallback` above only rejects the JavaScript "no value" sentinels. That
// is the right primitive, but on its own it is a PASS-THROUGH: a result screen
// is deep-linkable, so `?pace=1e3`, `?consistency=98%25 ROM (normal)` or
// `?range=NaN-free-but-lying` would render verbatim in an InfoRow and fabricate
// a plausible-looking clinical result for a session that never happened.
//
// `reps` has always been validated strictly; these give the other four fields
// the same treatment. Each one accepts ONLY the exact shape its formatter in
// metrics.ts can produce, plus that field's own honest "no data" sentinel, and
// falls back otherwise. The shape is derived from the formatter, so no new
// number, threshold or formula is introduced: a genuine value cannot be
// rejected, and a malformed one cannot be displayed.
// ===========================================================================

/** "MM:SS" as formatDurationLabel produces it: >=2 digit minutes, 2 digit seconds. */
const DURATION_SHAPE = /^(\d{2,}):(\d{2})$/;

/** formatPaceLabel: `Number.toFixed(1)`, i.e. a non-negative with one decimal. */
const PACE_SHAPE = /^\d+\.\d$/;

/** formatRangeLabel: two non-negative integer degrees joined by U+00B0 U+2013. */
const RANGE_SHAPE = /^(\d+)° – (\d+)°$/;

/** formatConsistencyLabel: a whole percentage, or the insufficient-data label. */
const CONSISTENCY_SHAPE = /^(\d{1,3})%$/;

/** The exact insufficient-data string formatConsistencyLabel emits. */
const NOT_ENOUGH_DATA = 'Not enough data';

/**
 * Duration as `formatDurationLabel` wrote it, else the fallback.
 *
 * Rejects "-1", "1e3", "NaN" and "00:99": the seconds field has to be a real
 * clock position, and `formatDurationLabel` cannot produce 99.
 */
export function parseDurationParam(duration: ResultParam, fallback = '--'): string {
  const raw = paramOrFallback(duration, '');
  if (raw === '' || raw === '--') return fallback;
  const match = DURATION_SHAPE.exec(raw);
  if (match === null) return fallback;
  if (Number(match[2]) > 59) return fallback;
  return raw;
}

/**
 * Pace as `formatPaceLabel` wrote it, else the fallback.
 *
 * The single decimal place is the point: it is what `toFixed(1)` emits, so
 * "4.5" is real and "4" / "4.55" / "-4.5" / "1e3" are not. Pace cannot be
 * negative, since it is reps over a non-negative duration.
 */
export function parsePaceParam(pace: ResultParam, fallback = '--'): string {
  const raw = paramOrFallback(pace, '');
  if (raw === '' || raw === '--') return fallback;
  if (!PACE_SHAPE.test(raw)) return fallback;
  return raw;
}

/**
 * Knee range as `formatRangeLabel` wrote it, else the fallback.
 *
 * The degree symbols are part of the contract, so a value that has lost them is
 * malformed rather than merely unusual. Both ends must be non-negative whole
 * degrees, and the lower one must come first: the engine builds its range with
 * Math.min/Math.max, so "170° – 88°" can only come from outside the app.
 */
export function parseRangeParam(range: ResultParam, fallback = '--'): string {
  const raw = paramOrFallback(range, '');
  if (raw === '' || raw === '--') return fallback;
  const match = RANGE_SHAPE.exec(raw);
  if (match === null) return fallback;
  if (Number(match[1]) > Number(match[2])) return fallback;
  return raw;
}

/**
 * Consistency as `formatConsistencyLabel` wrote it, else the fallback.
 *
 * `buildSessionMetrics` rounds and clamps the percentage to a whole 0-100, so
 * "86%" is real and "100.4%", "86 %" and "-1%" are not. A bare "0%" is kept
 * because it is a real, if poor, measurement rather than missing data.
 */
export function parseConsistencyParam(consistency: ResultParam, fallback = NOT_ENOUGH_DATA): string {
  const raw = paramOrFallback(consistency, '');
  if (raw === '' || raw === NOT_ENOUGH_DATA) return fallback;
  const match = CONSISTENCY_SHAPE.exec(raw);
  if (match === null) return fallback;
  if (Number(match[1]) > 100) return fallback;
  return raw;
}

/** The absent-value fallback `parsePaceParam` returns. Mirrors its own default. */
const NO_PACE = '--';

/**
 * Pace as it should be READ on the results screen: the validated value, with the
 * unit it is measured in.
 *
 * `formatPaceLabel` writes a bare number ("2.1") because the param has to stay
 * plain data that round-trips through the query string. On its own a bare
 * number means nothing to a reader, so the unit is added here — AFTER
 * validation, and only for a real measurement.
 *
 * The absent fallback is deliberately left bare: "-- / min" would claim a pace
 * was measured when it was not.
 */
export function formatPaceParamLabel(pace: ResultParam, fallback = NO_PACE): string {
  const validated = parsePaceParam(pace, fallback);
  return validated === fallback ? validated : `${validated} / min`;
}
