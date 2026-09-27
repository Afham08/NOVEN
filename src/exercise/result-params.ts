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
