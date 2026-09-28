/**
 * Parsing for the values that cross the navigation boundary into the guided
 * result screen.
 *
 * `router.push` serialises params into a query string and the receiving screen
 * reads them back as untrusted strings, so anything the result screen would show
 * as a number is re-validated on arrival. The wording itself is NOT passed: the
 * result screen looks the activity up in the catalogue by id and phrases it from
 * there, so a hand-edited `?steps=9999` can change a number but cannot invent an
 * activity, a total, or a sentence.
 */

/** Shape a route param can take: a single value, or repeats of one key. */
export type ResultParam = string | string[] | undefined;

/**
 * A whole, non-negative, safely representable number, or null.
 *
 * Digits only. A bare `Number()` would accept "0x10", "1e3" and " 0b11 ", any of
 * which would put a fabricated figure on somebody's results screen. Zero is a
 * real value here and must not be treated as missing: ending a session after two
 * seconds is a thing that happens.
 */
export function wholeNumberParam(value: ResultParam): number | null {
  if (value === undefined || value === null) return null;

  // A repeated query key arrives as an array. One element is the normal shape
  // for a param written once; more than one is ambiguous, so it is rejected
  // rather than silently taking the last or the first.
  const raw = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Steps finished, as the guided session wrote it, or null. */
export function parseStepCountParam(steps: ResultParam): number | null {
  return wholeNumberParam(steps);
}

/** Seconds actually run, as the guided session wrote it, or null. */
export function parseSecondsParam(seconds: ResultParam): number | null {
  return wholeNumberParam(seconds);
}
