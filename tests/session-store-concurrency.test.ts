/**
 * SESSION STORE CONCURRENCY
 * =========================
 *
 * Two bugs that no single-call test can see, because both are about what happens
 * BETWEEN operations rather than inside one.
 *
 * 1. A CLEAR THAT UN-CLEARS. `clearSessions()` and a read that was already in
 *    flight against the pre-clear history. If that read is allowed to land, it
 *    republishes the records the user just deleted, and the next save writes them
 *    back. Deleting your history silently fails, which for a privacy control is
 *    worse than a crash.
 *
 * 2. A SAVE THAT LOSES A SESSION. Saving is read-modify-write over one JSON
 *    array. Two saves that interleave both read the same list and both write a
 *    list derived from it, so the last writer erases the other's session. No
 *    error is thrown; a finished session just never appears in the history.
 *
 * WHY THESE TESTS LOOK LIKE THIS
 * ------------------------------
 * `await save(A); await save(B);` cannot reproduce either bug: it is sequential,
 * and the whole failure mode is the interleaving. So `heldStore` below hands the
 * store a backend whose reads stay pending until the test releases them, and
 * there is no `setTimeout` anywhere in this file. Every interleaving here is a
 * decision the test makes, not a race it waits for.
 *
 * The one subtlety that makes these tests honest: a held read snapshots the
 * stored value WHEN IT IS ISSUED, not when it resolves. That is what real
 * storage does - the bytes were read at some instant - and it is precisely why a
 * late answer is misleading. A backend that instead read `data[key]` at resolve
 * time would return the post-clear/post-save value and quietly make every one of
 * these bugs disappear.
 */

// Draining the microtask queue without a timer. `setImmediate` runs after the
// microtask queue is empty, so a flush is "let every already-queued continuation
// run", never "wait a bit and hope". Declared rather than imported from
// @types/node, which this project deliberately does not depend on.
declare function setImmediate(handler: () => void): void;

import { check, suite } from './harness';

import { buildSessionMetrics } from '../src/exercise/metrics';
import {
  createSessionRecord,
  createSessionStore,
  MAX_SAVED_SESSIONS,
  SESSION_HISTORY_KEY,
  type KeyValueStore,
  type SessionRecord,
} from '../src/exercise/session-store';

/** Lets every queued promise continuation run. No elapsed time is involved. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * A `KeyValueStore` whose reads - and optionally whose writes - are held open
 * until the test releases them.
 *
 * Reads are the lever for the clear race, writes for the save race, and a test
 * only ever decides WHEN AN OPERATION COMPLETES, which is the only degree of
 * freedom either bug needs. Operations are indexed in issue order and released
 * individually, so a test can hold read #1 open while read #0 lands, which is
 * what lets two saves appear to read the same list.
 */
function heldStore(seed: Record<string, string> = {}, holdWrites = false) {
  const data: Record<string, string> = { ...seed };
  const heldReads: { snapshot: string | null; release: () => void }[] = [];
  const heldWrites: { release: () => void }[] = [];
  const stats = { reads: 0, writes: 0, removes: 0 };

  const store: KeyValueStore = {
    getItem(key) {
      stats.reads += 1;
      // Snapshot NOW. A read is a photograph of the bytes as they were when the
      // store asked for them; taking it later would let a "stale" read quietly
      // return the fresh value and hide the bug.
      const snapshot = key in data ? data[key] : null;
      return new Promise<string | null>((resolve) => {
        heldReads.push({
          snapshot,
          release: () => resolve(snapshot),
        });
      });
    },
    setItem(key, value) {
      stats.writes += 1;
      if (!holdWrites) {
        data[key] = value;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        heldWrites.push({
          release: () => {
            // The bytes only change when the write is allowed to complete, which
            // is what makes two overlapping writes observable at all.
            data[key] = value;
            resolve();
          },
        });
      });
    },
    removeItem(key) {
      stats.removes += 1;
      delete data[key];
      return Promise.resolve();
    },
  };

  return {
    store,
    data,
    stats,
    /** Reads issued but not yet released. */
    held: () => heldReads.length,
    /** Writes issued but not yet released. */
    heldWrites: () => heldWrites.length,
    /** Releases one held read by issue order. False when none are held. */
    release(index = 0): boolean {
      const next = heldReads.splice(index, 1)[0];
      if (next === undefined) return false;
      next.release();
      return true;
    },
    /** Releases one held write by issue order. False when none are held. */
    releaseWrite(index = 0): boolean {
      const next = heldWrites.splice(index, 1)[0];
      if (next === undefined) return false;
      next.release();
      return true;
    },
  };
}

/** A backend with no timing to control, for checks that are not about timing. */
function immediateStore(seed: Record<string, string> = {}) {
  const data: Record<string, string> = { ...seed };
  const store: KeyValueStore = {
    getItem: (key) => Promise.resolve(key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
      return Promise.resolve();
    },
    removeItem: (key) => {
      delete data[key];
      return Promise.resolve();
    },
  };
  return { store, data };
}

type Backing = ReturnType<typeof heldStore>;

/** Releases reads as they are issued until `work` has settled. */
async function drain(backing: Backing, ...work: Promise<unknown>[]): Promise<void> {
  for (const item of work) {
    await flush();
    while (backing.release()) await flush();
    await item;
  }
}

function metrics() {
  return buildSessionMetrics({
    reps: 5,
    durationSeconds: 154,
    repRanges: [82, 80, 79],
    rangeMinDeg: 88,
    rangeMaxDeg: 170,
  });
}

function record(id: string, completedAt: string): SessionRecord {
  return createSessionRecord({
    id,
    exerciseId: 'seated-knee-extension',
    exerciseName: 'Seated Knee Extension',
    completedAt,
    metrics: metrics(),
  });
}

/** Ids in the stored blob, newest first, read without going through the store. */
function storedIds(data: Record<string, string>): string[] {
  const raw = data[SESSION_HISTORY_KEY];
  if (raw === undefined) return [];
  return (JSON.parse(raw) as SessionRecord[]).map((entry) => entry.id);
}

export function run(): void {
  suite('session store: a clear cannot be undone by a read already in flight', async () => {
    /*
     * The interleaving, forced step by step:
     *
     *   read() is issued and photographs [r1, r2]
     *   clearSessions() removes the key
     *   the held read is released and hands back [r1, r2]
     *
     * The last step is what a real device produces whenever the user clears their
     * history while a screen is still loading it. Settings -> Privacy calls
     * exactly `clearSessions()`, and four different screens call `getSessions()`
     * on focus.
     */
    const older = record('r1', '2026-09-26T08:00:00.000Z');
    const newer = record('r2', '2026-09-27T08:00:00.000Z');
    const backing = heldStore({ [SESSION_HISTORY_KEY]: JSON.stringify([newer, older]) });
    const store = createSessionStore(backing.store);

    const staleRead = store.getSessions();
    check('a read is in flight against the pre-clear history', backing.held() === 1, backing.held());

    await store.clearSessions();
    check('the clear really removed the key', backing.data[SESSION_HISTORY_KEY] === undefined);

    // Now the in-flight read answers, with the history the user just deleted.
    backing.release();
    const stale = await staleRead;
    await flush();

    check(
      'the history is empty once the clear has happened',
      (await store.getSessions()).length === 0,
      (await store.getSessions()).map((r) => r.id),
    );
    check('the deleted sessions do not come back', stale.length === 0, stale.map((r) => r.id));

    // The real privacy question is what ends up on the DEVICE, not just in memory.
    await store.saveSession(record('after-clear', '2026-09-28T08:00:00.000Z'));

    const afterSave = await store.getSessions();
    check('a session finished after clearing is recorded', afterSave.length === 1, afterSave.map((r) => r.id));
    check('it is the new one', afterSave[0]?.id === 'after-clear', afterSave.map((r) => r.id));
    check(
      'the cleared sessions were not written back to the key',
      storedIds(backing.data).join(',') === 'after-clear',
      storedIds(backing.data),
    );

    // And it survives a restart, which is the only way to be sure the answer was
    // never just a cached lie.
    const afterRestart = createSessionStore(immediateStore(backing.data).store);
    const persisted = await afterRestart.getSessions();
    check(
      'a fresh store agrees',
      persisted.map((r) => r.id).join(',') === 'after-clear',
      persisted.map((r) => r.id),
    );
  });

  suite('session store: a stale read cannot overwrite the cache after a save', async () => {
    /*
     * The same hazard as the clear, but aimed at data rather than privacy, and it
     * is the reason the guard covers every mutation rather than clearing alone.
     *
     *   read() is issued and photographs [r1]
     *   saveSession(B) completes and stores [B, r1]
     *   the held read lands and publishes [r1]
     *   saveSession(C) merges into [r1] and writes [C, r1]
     *
     * B is gone. It was saved, it reported success, and it vanished - because a
     * read that started before the save overwrote the cache the save had just
     * refreshed. Guarding only `clearSessions` would leave this completely intact.
     */
    const first = record('r1', '2026-09-26T08:00:00.000Z');
    const backing = heldStore({ [SESSION_HISTORY_KEY]: JSON.stringify([first]) });
    const store = createSessionStore(backing.store);

    const staleRead = store.getSessions();
    check('a read is in flight against the pre-save history', backing.held() === 1, backing.held());

    const saveB = store.saveSession(record('b', '2026-09-27T08:00:00.000Z'));
    await flush();
    check('the save issued its own read', backing.held() === 2, backing.held());

    // Let the save finish first. Its read resolves, it writes, it reports success.
    backing.release(1);
    await saveB;
    await flush();
    check('the save landed', storedIds(backing.data).join(',') === 'b,r1', storedIds(backing.data));

    // Only now does the older read answer, with what it saw before that save.
    backing.release(0);
    const stale = await staleRead;
    await flush();

    check(
      'the stale read did not report the older history as current',
      stale.map((r) => r.id).join(',') === 'b,r1',
      stale.map((r) => r.id),
    );

    // The record that would be lost if the stale read had been allowed to publish.
    await store.saveSession(record('c', '2026-09-28T08:00:00.000Z'));
    check(
      'the earlier save survived, so no finished session was dropped',
      storedIds(backing.data).join(',') === 'c,b,r1',
      storedIds(backing.data),
    );
  });

  suite('session store: two sessions finished at once both survive', async () => {
    /*
     * The canonical data-loss interleaving from the bug report:
     *
     *   save(A) reads []        save(B) reads []
     *   save(A) writes [A]      save(B) writes [B]
     *
     * with both reads issued before either write, so neither save can know about
     * the other. The store must not let their read-modify-write overlap.
     */
    const backing = heldStore();
    const store = createSessionStore(backing.store);

    // Issued back to back with nothing awaited between them, which is what two
    // finished sessions arriving in the same tick actually looks like.
    const saveA = store.saveSession(record('a', '2026-09-27T08:00:00.000Z'));
    const saveB = store.saveSession(record('b', '2026-09-28T08:00:00.000Z'));
    await flush();

    check(
      'the second save did not start reading while the first was still reading',
      backing.held() === 1,
      backing.held(),
    );

    backing.release();
    await saveA;
    await flush();

    backing.release();
    await saveB;
    await flush();

    check('both sessions are stored', storedIds(backing.data).join(',') === 'b,a', storedIds(backing.data));

    const all = await store.getSessions();
    check('and the store agrees', all.map((r) => r.id).join(',') === 'b,a', all.map((r) => r.id));
    check('newest first', all[0].id === 'b', all.map((r) => r.id));
    check('their real metrics are intact, not merged away', all[0].reps === 5 && all[0].durationSeconds === 154, all[0]);
  });

  suite('session store: two sessions finished at once both survive a loaded history', async () => {
    /*
     * The same bug with the history ALREADY LOADED, which is the ordinary case:
     * four screens call `getSessions()` on focus, so the cache is warm long
     * before anyone finishes a session.
     *
     * A warm cache means neither save touches storage, so neither save issues a
     * read that could be invalidated. The only thing that can stop them merging
     * into the same list is the write-modify-write actually being serialized:
     *
     *   save(A) merges into [x]      save(B) merges into [x]
     *   save(A) writes [a, x]        save(B) writes [b, x]
     *
     * and B is the last writer, so A is gone. This is the case a cold-cache test
     * cannot catch, because there the invalidation guard happens to hide it.
     */
    const existing = record('x', '2026-09-20T08:00:00.000Z');
    const backing = heldStore({ [SESSION_HISTORY_KEY]: JSON.stringify([existing]) }, true);
    const store = createSessionStore(backing.store);

    // Warm the cache the way any focused screen does, and confirm it took.
    const warming = store.getSessions();
    backing.release();
    check('the history is loaded before the saves', (await warming).length === 1, 'warmup');

    const saveA = store.saveSession(record('a', '2026-09-27T08:00:00.000Z'));
    const saveB = store.saveSession(record('b', '2026-09-28T08:00:00.000Z'));
    await flush();

    check(
      'the second save is not writing while the first write is still in flight',
      backing.heldWrites() === 1,
      backing.heldWrites(),
    );

    backing.releaseWrite();
    await saveA;
    await flush();

    backing.releaseWrite();
    await saveB;
    await flush();

    check(
      'the session that finished first was not erased by the one that finished second',
      storedIds(backing.data).join(',') === 'b,a,x',
      storedIds(backing.data),
    );
    check('all three are present', storedIds(backing.data).length === 3, storedIds(backing.data));
    check('and nothing reached storage twice', backing.stats.writes === 2, backing.stats.writes);
  });

  suite('session store: concurrent saves of the same session stay idempotent', async () => {
    const backing = heldStore();
    const store = createSessionStore(backing.store);

    const same = record('same', '2026-09-27T08:00:00.000Z');
    const first = store.saveSession(same);
    const second = store.saveSession(same);
    await flush();

    await drain(backing, first, second);

    check('the record appears exactly once', storedIds(backing.data).join(',') === 'same', storedIds(backing.data));
    check(
      'and so does the in-memory view',
      (await store.getSessions()).length === 1,
      (await store.getSessions()).map((r) => r.id),
    );
  });

  suite('session store: a save and a clear take effect in the order they were called', async () => {
    // Both orderings, because the rule has to be call order rather than whichever
    // write happened to land last. A caller cannot reason about the store if the
    // answer depends on storage timing.
    const backing = heldStore();
    const store = createSessionStore(backing.store);

    const beforeClear = store.saveSession(record('before', '2026-09-27T08:00:00.000Z'));
    const clearing = store.clearSessions();
    await flush();
    await drain(backing, beforeClear, clearing);

    check(
      'a save issued before a clear is erased by that clear',
      storedIds(backing.data).length === 0,
      storedIds(backing.data),
    );
    check(
      'and the store reports an empty history',
      (await store.getSessions()).length === 0,
      (await store.getSessions()).map((r) => r.id),
    );

    // The other order, on the same store, so the second clear is not the only
    // thing being relied on.
    const afterClear = store.saveSession(record('after', '2026-09-28T08:00:00.000Z'));
    await flush();
    await drain(backing, afterClear);

    check('a save issued after a clear survives it', storedIds(backing.data).join(',') === 'after', storedIds(backing.data));
    check(
      'and it is reported',
      (await store.getSessions()).map((r) => r.id).join(',') === 'after',
      (await store.getSessions()).map((r) => r.id),
    );
  });

  suite('session store: clearing repeatedly stays safe', async () => {
    const kept = record('kept', '2026-09-27T08:00:00.000Z');
    const backing = heldStore({ [SESSION_HISTORY_KEY]: JSON.stringify([kept]) });
    const store = createSessionStore(backing.store);

    const stale = store.getSessions();
    await store.clearSessions();
    await store.clearSessions();
    backing.release();
    await stale;
    await flush();

    check('the key stays gone', backing.data[SESSION_HISTORY_KEY] === undefined);
    check(
      'the history stays empty',
      (await store.getSessions()).length === 0,
      (await store.getSessions()).map((r) => r.id),
    );

    await drain(backing, store.saveSession(record('new', '2026-09-28T08:00:00.000Z')));
    check('recording still works afterwards', storedIds(backing.data).join(',') === 'new', storedIds(backing.data));
  });

  suite('session store: the guarantees that existed before still hold', async () => {
    // Everything the store promised before it became concurrency-safe, checked
    // again through the queue, because a lock that quietly changes observable
    // behaviour would be a worse bug than the one it fixes.

    // Malformed entries are still dropped whole, and the valid ones survive.
    const newest = record('new', '2026-09-27T08:00:00.000Z');
    const middle = record('mid', '2026-09-24T08:00:00.000Z');
    const oldest = record('old', '2026-09-20T08:00:00.000Z');
    const hostile = immediateStore({
      [SESSION_HISTORY_KEY]: JSON.stringify([newest, { id: 'broken' }, middle, oldest]),
    });
    const filtering = createSessionStore(hostile.store);
    const survivors = await filtering.getSessions();
    check(
      'a corrupt entry is still dropped and the valid ones survive',
      survivors.map((r) => r.id).join(',') === 'new,mid,old',
      survivors.map((r) => r.id),
    );

    // Idempotency, through the queued write path rather than the plain one.
    const backing = heldStore();
    const store = createSessionStore(backing.store);
    await drain(backing, store.saveSession(newest));
    await drain(backing, store.saveSession(middle));
    await drain(backing, store.saveSession(newest));
    check(
      're-saving an existing id replaces it instead of duplicating',
      storedIds(backing.data).join(',') === 'new,mid',
      storedIds(backing.data),
    );

    // Deletion still reports honestly and still refuses to invent a match.
    check('deleting a stored id reports success', (await store.deleteSession('mid')) === true);
    check('deleting an unknown id reports false', (await store.deleteSession('nope')) === false);
    check('only the requested session went', storedIds(backing.data).join(',') === 'new', storedIds(backing.data));

    // The cap is still applied, on the oldest end, and the newest survives it.
    const crowded = immediateStore({
      [SESSION_HISTORY_KEY]: JSON.stringify(
        Array.from({ length: MAX_SAVED_SESSIONS + 20 }, (_, index) =>
          record(
            `r${String(index).padStart(3, '0')}`,
            new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString(),
          ),
        ),
      ),
    });
    const capped = createSessionStore(crowded.store);
    await capped.saveSession(record('overflow', '2027-06-01T00:00:00.000Z'));

    const kept = storedIds(crowded.data);
    check('an over-cap history is trimmed to the cap', kept.length === MAX_SAVED_SESSIONS, kept.length);
    check('and the newest session is the one that is there', kept[0] === 'overflow', kept.slice(0, 3));
    check('the oldest end is what got dropped', !kept.includes('r000'), kept.slice(-3));
  });
}