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

/**
 * Whether the guided session's history write was confirmed to have landed.
 *
 * This is the one result value that cannot be derived from the catalogue, because
 * it is an observation about the device's storage rather than a property of the
 * activity. It crosses as a status token rather than a sentence so this module
 * keeps owning the wording, which keeps a hand-edited `?saved=` from being able
 * to invent a claim of its own.
 */
export type SaveStatus = 'saved' | 'failed';

/**
 * The save outcome the session screen reported, or null when there is none.
 *
 * Null is deliberately not folded into either answer. A missing or malformed
 * param means nothing confirmed the write, which is not the same as knowing that
 * it failed, so the two stay distinct and the caller can say so.
 */
export function parseSaveStatusParam(saved: ResultParam): SaveStatus | null {
  const raw = Array.isArray(saved) ? (saved.length === 1 ? saved[0] : undefined) : saved;
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toLowerCase();
  if (token === 'saved' || token === 'yes') return 'saved';
  if (token === 'failed' || token === 'no') return 'failed';
  return null;
}

/**
 * What the result screen is allowed to claim about history.
 *
 * The sentence is derived from the confirmed outcome, never from how the session
 * happened to end. A session that ran to the end and one that was stopped early
 * are both only SAVED if storage says the write landed, so an unconfirmed or
 * failed write cannot be reported as a save by any route through this function.
 */
export function describeSaveStatus(
  status: SaveStatus | null,
  ranToTheEnd: boolean,
  stopped: boolean,
): string {
  if (status === 'failed') return 'Not saved';
  if (status === null) return 'Not confirmed';
  return ranToTheEnd ? 'Yes' : stopped ? 'Yes, part finished' : 'Yes';
}
