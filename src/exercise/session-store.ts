import type { SessionMetrics } from './types';

/**
 * ============================================================================
 * Session history — a local, persistent record of completed exercise sessions.
 * ============================================================================
 *
 * WHAT THIS IS
 * A thin persistence layer over one AsyncStorage key. It stores the numbers a
 * finished session actually produced, so the user can see a session again after
 * leaving the result screen.
 *
 * WHY IT IS NOT `src/services/saved-sessions.ts`
 * That module was deleted in 0d42139 and must not be restored. It was a
 * self-declared "MOCK in-memory store — demo only" that kept its list in a
 * module-level array, so it reset on every app launch, and it persisted an
 * invented 0-100 `score` pulled from a mock analysis module rather than any
 * real measurement. This module stores the real `SessionMetrics` and survives a
 * restart. It invents nothing and scores nothing.
 *
 * WHY THE STORAGE IS INJECTED
 * `KeyValueStore` is the only thing this file needs from a device, so the whole
 * module is pure and runs under the plain-Node test harness, where AsyncStorage
 * (a native module) does not exist. The AsyncStorage adapter lives in
 * `session-storage.ts`; nothing here imports it, which is what keeps this file
 * compilable by `tsconfig.test.json`.
 *
 * WHAT IS DELIBERATELY NOT STORED
 * No camera frames, landmarks, angles-per-frame, readiness phases or detector
 * state. Only the finished summary. The full pose stream is not persisted
 * anywhere in the app, and adding it would be a privacy and storage problem for
 * no benefit to a history list.
 *
 * The stored values are the same numeric fields the Result screen shows, so no
 * display string is ever written to disk. Formatting stays a presentation
 * concern, applied on read.
 */

/**
 * One storage key for the whole history.
 *
 * A single key means a save is one atomic write: it cannot leave half of one
 * session stored and half of another, and a corrupt entry can only ever cost
 * one array read rather than a scatter of keys to reconcile.
 */
export const SESSION_HISTORY_KEY = 'noven.session-history.v1';

/**
 * Most recent sessions kept. A real user would need hundreds of sessions to hit
 * this, but the cap stops a long-lived install from growing one JSON blob
 * without bound, and it is applied on the OLDEST end so recent history — the
 * only part anyone reads — is never the thing that gets dropped.
 */
export const MAX_SAVED_SESSIONS = 200;

/**
 * What kind of activity produced a session.
 *
 * 'exercise' is the camera-tracked case and is also the default, so a record
 * written before the guided activities existed is read back as an exercise. The
 * other three are the timer-driven activities, which have no joint angles and so
 * no pace, range, or steadiness to report.
 */
export type SessionKind = 'exercise' | 'yoga' | 'meditation' | 'wellness';

const SESSION_KINDS: readonly SessionKind[] = ['exercise', 'yoga', 'meditation', 'wellness'];

/** True for a value this app would have written as a session kind. */
export function isSessionKind(value: unknown): value is SessionKind {
  return typeof value === 'string' && (SESSION_KINDS as readonly string[]).includes(value);
}

/**
 * A completed session, as persisted.
 *
 * Deliberately built by extending `SessionMetrics` rather than restating its
 * six fields: the persisted shape cannot drift away from the metrics the engine
 * produced, and a metric added to `SessionMetrics` later is a compile error
 * here rather than a silently missing field.
 *
 * `activityKind` and `stepsCompleted` are OPTIONAL and are simply absent on a
 * record written before the guided activities existed. That is what makes this
 * additive: an old history keeps loading untouched, and a camera session does
 * not gain two fields it has no honest value for. A guided session still carries
 * a real `reps` of 0 and real nulls for the camera metrics, because NOVEN did
 * not measure them and the store must not imply otherwise.
 */
export type SessionRecord = SessionMetrics & {
  id: string;
  exerciseId: string;
  exerciseName: string;
  /** ISO-8601 timestamp of when the session was completed. */
  completedAt: string;
  /** Absent means an exercise session. */
  activityKind?: SessionKind;
  /** Guided steps finished. Absent means a camera session, which has none. */
  stepsCompleted?: number;
};

/** The subset of AsyncStorage this module needs. AsyncStorage satisfies it. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * A record as it is built from a finished session.
 *
 * The id and the timestamp are required rather than defaulted so that building a
 * record stays a pure function: the caller decides both, which is what makes a
 * completed session reproducible in a test. The guided fields are optional for
 * the same reason, and are omitted entirely rather than defaulted, so a camera
 * session produces exactly the record shape it always did.
 */
export type NewSessionRecord = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  completedAt: string;
  metrics: SessionMetrics;
  activityKind?: SessionKind;
  stepsCompleted?: number;
};

/** Milliseconds in a day, used only for the "Today"/"Yesterday" labels. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A short, collision-resistant id for one completed session.
 *
 * `nowMs` and `random` are injectable purely so the output is deterministic in a
 * test; the defaults are what the app uses. The time prefix alone would repeat
 * for two sessions finished in the same millisecond, and the random suffix
 * alone would not sort, so both are used.
 */
export function createSessionId(nowMs: number = Date.now(), random: number = Math.random()): string {
  return `${nowMs.toString(36)}-${Math.floor(random * 0x100000000)
    .toString(36)
    .padStart(7, '0')}`;
}

/** Builds the record for a finished session. Pure; no clock, no randomness. */
export function createSessionRecord(input: NewSessionRecord): SessionRecord {
  const { id, exerciseId, exerciseName, completedAt, metrics } = input;
  return {
    id,
    exerciseId,
    exerciseName,
    completedAt,
    reps: metrics.reps,
    durationSeconds: metrics.durationSeconds,
    paceRpm: metrics.paceRpm,
    rangeMinDeg: metrics.rangeMinDeg,
    rangeMaxDeg: metrics.rangeMaxDeg,
    consistencyPct: metrics.consistencyPct,
    // Spread rather than assigned conditionally: a key present with the value
    // `undefined` would still be written to disk by JSON.stringify as absent, but
    // it would also make `'activityKind' in record` true, so the read side could
    // no longer tell "written before this field existed" from "explicitly an
    // exercise". Omitting the key outright is the only unambiguous form.
    ...(input.activityKind !== undefined ? { activityKind: input.activityKind } : {}),
    ...(input.stepsCompleted !== undefined ? { stepsCompleted: input.stepsCompleted } : {}),
  };
}

/** A finite, non-negative number, or null. Rejects NaN, Infinity and -1. */
function nonNegativeOrNull(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A finite integer >= 0, or null. `reps` must be a whole count, not 5.7. */
function countOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/** `consistencyPct` is a rounded 0..100 percentage, or null when unavailable. */
function consistencyOrNull(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return value >= 0 && value <= 100 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** A parseable timestamp, re-emitted canonically as ISO-8601. */
function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Rebuilds one record from whatever was on disk, or returns null if it is not
 * a record this app wrote.
 *
 * The storage boundary is as untrusted as the navigation boundary the Result
 * screen already defends against: a record can be truncated by a crash mid
 * write, hand-edited, or left behind by a future version with a different shape.
 * Anything that does not validate cleanly is dropped whole rather than repaired
 * or partially filled in, because a half-understood rep count is worse than a
 * missing session.
 *
 * The one thing it is careful about is `null`. A metric the engine genuinely
 * could not compute — no pace for a 4-second session, no consistency for a
 * single rep — is stored as null and stays null here. It is never turned into a
 * zero or a placeholder, so the history list can tell "we did not measure this"
 * apart from "we measured zero".
 */
export function parseSessionRecord(value: unknown): SessionRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const id = nonEmptyString(raw.id);
  const exerciseId = nonEmptyString(raw.exerciseId);
  const exerciseName = nonEmptyString(raw.exerciseName);
  const completedAt = isoTimestamp(raw.completedAt);
  const reps = countOrNull(raw.reps);
  const durationSeconds = nonNegativeOrNull(raw.durationSeconds);
  if (id === null || exerciseId === null || exerciseName === null) return null;
  if (completedAt === null || reps === null || durationSeconds === null) return null;

  const paceRpm = nonNegativeOrNull(raw.paceRpm);
  const rangeMinDeg = nonNegativeOrNull(raw.rangeMinDeg);
  const rangeMaxDeg = nonNegativeOrNull(raw.rangeMaxDeg);
  const consistencyPct = consistencyOrNull(raw.consistencyPct);

  // A nullable metric that arrived as a non-null but invalid value (NaN, a
  // string, a negative angle) means the record is not trustworthy, so the whole
  // record is rejected rather than the field quietly reset to null.
  const optionals: [unknown, number | null][] = [
    [raw.paceRpm, paceRpm],
    [raw.rangeMinDeg, rangeMinDeg],
    [raw.rangeMaxDeg, rangeMaxDeg],
    [raw.consistencyPct, consistencyPct],
  ];
  for (const [input, parsed] of optionals) {
    if (input !== null && parsed === null) return null;
  }

  /*
   * The guided fields are validated to the same standard as everything else: a
   * kind this app never writes, or a step count that is not a whole number, means
   * the blob was written by something other than this app, so the record is
   * dropped rather than read with a guessed value. Both are OPTIONAL, and an
   * absent one is not an error - that is the shape of every record stored before
   * the guided activities existed, and dropping those would erase a real
   * user's history on upgrade.
   */
  let activityKind: SessionKind | undefined;
  if (raw.activityKind !== undefined) {
    if (!isSessionKind(raw.activityKind)) return null;
    activityKind = raw.activityKind;
  }

  let stepsCompleted: number | undefined;
  if (raw.stepsCompleted !== undefined) {
    const parsedSteps = countOrNull(raw.stepsCompleted);
    if (parsedSteps === null) return null;
    stepsCompleted = parsedSteps;
  }

  return {
    id,
    exerciseId,
    exerciseName,
    completedAt,
    reps,
    durationSeconds,
    paceRpm,
    rangeMinDeg,
    rangeMaxDeg,
    consistencyPct,
    ...(activityKind !== undefined ? { activityKind } : {}),
    ...(stepsCompleted !== undefined ? { stepsCompleted } : {}),
  };
}

/** Newest first. Ties keep a stable order, so equal timestamps do not shuffle. */
export function sortNewestFirst(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

/**
 * Parses the whole stored blob. A single unreadable byte anywhere yields the
 * sessions that did survive, never an exception — a corrupt history is a
 * missing feature, not a crash on the home screen.
 */
export function parseSessionHistory(raw: string | null | undefined): SessionRecord[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];

  const records: SessionRecord[] = [];
  for (const entry of decoded) {
    const record = parseSessionRecord(entry);
    if (record !== null) records.push(record);
  }
  return sortNewestFirst(records);
}

/**
 * Plain-language day label for a history row: "Today", "Yesterday", or a short
 * date. Local-time based, because "did I do this today" is a local question.
 *
 * Records that cannot be dated return null rather than a guessed label; they are
 * filtered out of the UI rather than shown under a wrong day.
 */
export function dayLabel(completedAt: string, nowMs: number = Date.now()): string | null {
  const ms = Date.parse(completedAt);
  if (!Number.isFinite(ms)) return null;

  const day = new Date(nowMs);
  const record = new Date(ms);
  const startOfToday = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const startOfRecord = new Date(
    record.getFullYear(),
    record.getMonth(),
    record.getDate(),
  ).getTime();
  const daysApart = Math.round((startOfToday - startOfRecord) / MS_PER_DAY);

  if (daysApart === 0) return 'Today';
  if (daysApart === 1) return 'Yesterday';
  return record.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The history repository. Async, and the only place that touches storage. */
export type SessionStore = {
  /**
   * Stores a completed session and returns the stored record.
   *
   * Idempotent per id: re-saving a record that is already present replaces it in
   * place instead of appending a duplicate. That is what makes saving the same
   * completed session twice harmless, so a re-entrant call cannot inflate the
   * history.
   */
  saveSession(record: SessionRecord): Promise<SessionRecord>;
  /** Every stored session, newest first. */
  getSessions(): Promise<SessionRecord[]>;
  /** One session by id, or null. */
  getSessionById(id: string): Promise<SessionRecord | null>;
  /** Removes one session. Resolves false when the id was not stored. */
  deleteSession(id: string): Promise<boolean>;
  /** Removes every session. */
  clearSessions(): Promise<void>;
};

/**
 * Builds a store over any key/value backend.
 *
 * A read is cached after the first success so the home screen does not re-parse
 * the whole history on every render, and a write refreshes that cache only once
 * the write has actually landed, so a failed write cannot make the in-memory
 * view disagree with the device.
 *
 * WHAT "COULD NOT READ" IS NOT
 * `cache` is `null` for "not loaded yet" and an array for "loaded", so assigning
 * `[]` to it after a failed read would be a claim the store cannot support: it
 * would mean "the history was read, and it was empty", when in fact nothing was
 * read at all. That claim is dangerous because a save is built by merging into
 * the cached list, so a history believed to be empty would be written back over
 * the key as a single new session and every stored session would be destroyed.
 *
 * So a failed read is not cached. `readFailed` records that the last attempt got
 * no answer, which gives `read()` two jobs to stay honest about:
 *
 *   - it leaves `cache` at `null`, so the next read retries the storage instead of
 *     reporting an empty history for the rest of the process, and
 *   - it makes `write()` refuse, so an unread history is never overwritten.
 *
 * A caller still gets `[]` back from a read that failed, because a list it could
 * not load must still render and the empty state is the honest answer for it.
 * That is unchanged. What changes is that the store no longer mistakes "could not
 * read" for "read it, and there was nothing there".
 */
export function createSessionStore(store: KeyValueStore): SessionStore {
  let cache: SessionRecord[] | null = null;
  let readFailed = false;

  /*
   * ==========================================================================
   * WHY THIS STORE NEEDS TWO PIECES OF CONCURRENCY STATE
   * ==========================================================================
   *
   * `cache` and `readFailed` are shared by every caller, and reaching storage
   * means awaiting. Two things can therefore go wrong that no amount of care
   * inside a single operation can prevent, because the damage happens BETWEEN
   * operations.
   *
   * A SAVE THAT LOSES A SESSION
   * Saving is a read-modify-write: read the stored list, drop any entry with the
   * same id, add the new record, write the whole thing back. Two saves that
   * interleave both read the same old list and both write a list derived from it,
   * so whichever lands last erases the other's session. Nothing threw. A user
   * simply finds a session they had just finished missing from their history.
   *
   * A CLEAR THAT UN-CLEARS
   * A read that is already in flight when `clearSessions()` runs was issued
   * against the history that existed BEFORE the clear. If it is allowed to land
   * afterwards, it repopulates the cache with the very records the user just
   * deleted, and the next save merges into them and writes them back to the key.
   * Deleting your history would silently fail, which for a privacy control is
   * worse than a crash.
   *
   * THE TWO MECHANISMS, AND WHY TWO
   * `tail` serializes every MUTATION, so a save's read-modify-write is never
   * interleaved with another save's, delete's, or clear's. Order is the order the
   * app called the methods in, so a save made before a clear is deleted by that
   * clear, and a save made after it survives. That is the intuitive rule and the
   * one callers already assume.
   *
   * `storedEpoch` guards READS. Reads are deliberately NOT queued, so a slow or
   * hung `getItem` cannot stall the recording of a finished session; a read is
   * only a snapshot for the caller, and a slightly stale snapshot is harmless.
   * What is not harmless is a stale read PUBLISHING its answer. So a read notes
   * the epoch it was issued under and refuses to touch the cache if a mutation
   * has landed since. Queueing the mutations also means a mutation's own read
   * always sees a current epoch, so the guard costs those reads nothing.
   */
  let storedEpoch = 0;

  /** Resolves only after every mutation queued so far has settled. */
  let tail: Promise<void> = Promise.resolve();

  /**
   * Runs `task` once every previously queued mutation has settled.
   *
   * The chain is reassigned to a promise that swallows its own outcome, so one
   * rejected operation cannot wedge the queue for the rest of the process; the
   * caller still receives the rejection from the promise returned here.
   */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function read(): Promise<SessionRecord[]> {
    if (cache !== null) return cache;
    const issuedAt = storedEpoch;
    let raw: string | null = null;
    try {
      raw = await store.getItem(SESSION_HISTORY_KEY);
    } catch {
      // A storage read that throws is treated as "nothing stored yet" rather
      // than propagated: the history list degrades to empty instead of the app
      // failing to render.
      //
      // `cache` is deliberately left alone rather than set to `[]`. It stays
      // `null` so the next call retries the storage instead of serving this empty
      // list for the rest of the process, and `readFailed` records that nothing
      // has actually been read yet so `write()` knows it must not overwrite it.
      //
      // Unless a mutation has landed since, in which case this answer is about a
      // history that no longer exists and must be discarded rather than recorded
      // as a failure: a clear that already removed the key is exactly the case
      // where the next save is entitled to write.
      if (issuedAt !== storedEpoch) return cache ?? [];
      readFailed = true;
      return [];
    }
    /*
     * The epoch is re-checked before the result is published, which is the whole
     * point. A read that was in flight across a clear must not repopulate the
     * cache with the deleted records, and a read that was in flight across a save
     * must not overwrite the cache with the pre-save list, because the next save
     * would merge into that stale list and drop the session just written.
     *
     * Falling back to the cache is safe precisely because the mutation that moved
     * the epoch is what populated it: a clear sets it to `[]`, and a write sets it
     * to what it just stored. If neither happened, the cache is still `null` and
     * the honest answer is the empty list.
     */
    if (issuedAt !== storedEpoch) return cache ?? [];
    cache = parseSessionHistory(raw);
    readFailed = false;
    return cache;
  }

  async function write(records: SessionRecord[]): Promise<void> {
    // `records` is always "what was already stored, plus the new one", so if its
    // starting point came from a read that failed it is not the stored history at
    // all - it is an empty list, and writing it would delete every session
    // currently on the device. Refusing is the only way to keep them. The caller
    // already has to handle a save that does not land, and a session that went
    // unrecorded costs far less than a history that cannot be recovered.
    //
    // This is unreachable from `deleteSession`: with no successful read its list
    // is empty, so nothing matches and it reports false before writing. Deletion
    // therefore keeps its existing behaviour either way.
    if (readFailed) {
      throw new Error('session history could not be read; refusing to overwrite it');
    }
    const sorted = sortNewestFirst(records).slice(0, MAX_SAVED_SESSIONS);
    // Bumped before the write reaches storage, not after, so a read that settles
    // while `setItem` is still pending is already known to be describing the
    // pre-write history. That also covers the case where this write fails: the
    // cache is then still the last known-good list, and a read landing now would
    // be free to clobber it with something older.
    storedEpoch += 1;
    await store.setItem(SESSION_HISTORY_KEY, JSON.stringify(sorted));
    cache = sorted;
  }

  return {
    /*
     * Inside the queue, so this save's read-modify-write cannot interleave with
     * another one's. Without it, two sessions finished at once could each read the
     * same list and each write a list that knew nothing of the other.
     */
    saveSession(record) {
      return enqueue(async () => {
        const existing = await read();
        const without = existing.filter((entry) => entry.id !== record.id);
        const next = sortNewestFirst([...without, record]);
        await write(next);
        return record;
      });
    },

    async getSessions() {
      return [...(await read())];
    },

    async getSessionById(id) {
      return (await read()).find((entry) => entry.id === id) ?? null;
    },

    deleteSession(id) {
      return enqueue(async () => {
        const existing = await read();
        const next = existing.filter((entry) => entry.id !== id);
        if (next.length === existing.length) return false;
        await write(next);
        return true;
      });
    },

    /*
     * WHY `readFailed` IS RESET HERE
     * -------------------------------
     * `readFailed` means "the stored history is unknown, so a write could destroy
     * it". A successful `removeItem` retires exactly that condition: the key no
     * longer exists, so there is no unread history left for a write to overwrite.
     * The refusal is therefore no longer protecting anything, and the store is
     * back in the same state a successful read would have left it in.
     *
     * WHY IT USED TO STICK — the permanently-unrecordable store
     * ---------------------------------------------------------
     * The flag was left set, and because `cache` is `[]` rather than `null` here,
     * every later `read()` takes the cache-first early return and so never
     * reaches the line that clears `readFailed` on a good read. The store was
     * therefore stuck for the rest of the process: every `saveSession` rejected
     * with "session history could not be read; refusing to overwrite it" even
     * though the user had just deleted that history themselves.
     *
     * Reaching it needs a read to have failed first (a transient storage error),
     * which is exactly the situation a user is most likely to clear their history
     * in. The exercise session screen absorbs a save rejection, so the next
     * session the user finished showed a result screen and then silently left no
     * trace in their history, with nothing to tell them why.
     *
     * QUEUED, AND THE ORDERING RULE FOR save + clear
     * ----------------------------------------------
     * A clear is queued like any other mutation, so the two of them take effect in
     * the order the app called them: a `saveSession` awaited (or merely issued)
     * before `clearSessions` is erased by that clear, and one issued after it
     * survives. Interleaving them would leave the outcome up to whichever storage
     * write happened to land last, which is not a rule a caller could reason about.
     *
     * The epoch is bumped BEFORE the key is removed rather than after. A read that
     * settles while `removeItem` is still pending is already describing a history
     * the user has asked to delete, and must not be able to publish it - and
     * because a clear sets the cache to `[]` itself, nothing legitimate is lost by
     * invalidating that early: every later save still reads and writes normally.
     */
    clearSessions() {
      return enqueue(async () => {
        storedEpoch += 1;
        await store.removeItem(SESSION_HISTORY_KEY);
        cache = [];
        readFailed = false;
      });
    },
  };
}
