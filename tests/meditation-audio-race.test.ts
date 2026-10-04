/**
 * MEDITATION AUDIO — VOLUME / LOAD RACE
 * ======================================
 *
 * The controller reads its volume to build the player:
 *
 *     handle = await driver.create(source, { volume: this.volume, loop: true })
 *
 * so the player is CONFIGURED WITH WHATEVER THE VOLUME WAS AT THAT MOMENT. But
 * `setVolume` can only reach a player that already exists, and during a load
 * there is no handle yet:
 *
 *     setVolume(v) { this.volume = v; if (this.handle) ... }
 *
 * So a volume change made while the sound is loading could only record itself and
 * hope, and the player being built kept the older volume. `snapshot().volume`
 * then reported the new value while the real player sat at the old one.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * The load-versus-lifecycle races in meditation-audio.test.ts are about intent,
 * and this file is about the one piece of state that was not reconciled. Keeping
 * them separate means the whole regression surface here can be run on its own,
 * which is what makes "does this catch the old code?" a question with a quick
 * answer.
 *
 * NOTHING HERE WAITS ON TIME. `manualDriver` holds `create` open until the test
 * resolves it, so "the load takes a while" is modelled by not resolving yet, and
 * every interleaving below finishes in microseconds in a fixed order. There is no
 * `setTimeout` in this file.
 */

import { check, suite } from './harness';

import {
  MeditationAudioController,
  type MeditationAudioDriver,
  type MeditationAudioHandle,
  type MeditationAudioSource,
} from '../src/activities/meditation-audio';

/**
 * Lets the load continuation run.
 *
 * The test's own await is queued after the one the load just released, so the
 * controller has resumed by the time this returns; the second tick is
 * belt-and-braces for a controller that chains.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * A handle that records instead of sounding, and holds a real volume the way a
 * native player does.
 *
 * `volume` is the important part: it is seeded with the volume the player was
 * CREATED with and only changes when `setVolume` is actually called, so
 * `recording.volume` is "what the device is really playing at". Asserting against
 * it rather than against the call log is what makes the inconsistency visible -
 * a call log can look right while the player is wrong.
 */
function recordingHandle(initialVolume: number, options?: { throwOnPlay?: boolean }) {
  const calls: string[] = [];
  const volumes: number[] = [];
  const live = { volume: initialVolume };
  const handle: MeditationAudioHandle = {
    play() {
      calls.push('play');
      if (options?.throwOnPlay) throw new Error('native play failed');
    },
    pause() {
      calls.push('pause');
    },
    stop() {
      calls.push('stop');
    },
    setVolume(volume: number) {
      volumes.push(volume);
      live.volume = volume;
    },
    release() {
      calls.push('release');
    },
  };
  return {
    handle,
    calls,
    volumes,
    get volume(): number {
      return live.volume;
    },
  };
}

type Recording = ReturnType<typeof recordingHandle>;

/** A driver whose `create` resolves only when the test says so. */
function manualDriver() {
  const pending: {
    source: MeditationAudioSource;
    volume: number;
    loop: boolean;
    resolve: (handle: MeditationAudioHandle) => void;
    reject: (error: unknown) => void;
  }[] = [];

  const driver: MeditationAudioDriver = {
    create(source, options) {
      return new Promise<MeditationAudioHandle>((resolve, reject) => {
        pending.push({ source, volume: options.volume, loop: options.loop, resolve, reject });
      });
    },
  };

  return {
    driver,
    pending,
    /** Hands the oldest unresolved load a player configured at the requested volume. */
    async settle(options?: { throwOnPlay?: boolean }): Promise<Recording> {
      const load = pending.shift();
      if (!load) throw new Error('no load is pending');
      const made = recordingHandle(load.volume, options);
      load.resolve(made.handle);
      await flush();
      return made;
    },
    /** Fails the oldest unresolved load, the way a missing file would. */
    async fail(message = 'no audio on this device'): Promise<void> {
      const load = pending.shift();
      if (!load) throw new Error('no load is pending');
      load.reject(new Error(message));
      await flush();
    },
  };
}

/**
 * The invariant the whole file exists for: what the controller reports and what
 * the device is really doing are the same thing.
 */
function consistent(audio: MeditationAudioController, player: Recording): boolean {
  return Math.abs(audio.snapshot().volume - player.volume) < 1e-9;
}

export function run(): void {
  suite('ambient sound race: a volume change during a load reaches the player', async () => {
    // THE REGRESSION. The player is created at DEFAULT_AMBIENT_VOLUME, the volume
    // is changed while that creation is still pending, and the player that arrives
    // must end up at the new value.
    const { driver, pending, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    check('a load is in flight', pending.length === 1 && audio.snapshot().phase === 'loading');
    check('the driver was asked for the volume as it stood', pending[0].volume === 0.25, pending[0].volume);

    // The bed is still being built. This is the change that used to be dropped.
    audio.setVolume(0.2);
    check('the controller reports the new volume at once', audio.snapshot().volume === 0.2, audio.snapshot().volume);
    check('but there is no player to push it into yet', pending.length === 1);

    const made = await settle();

    check('the player that arrived is at the volume asked for during the load', made.volume === 0.2, made.volume);
    check('and the controller agrees with it', consistent(audio, made), {
      controller: audio.snapshot().volume,
      player: made.volume,
    });
    check('the volume was pushed once, not repeatedly', made.volumes.join(',') === '0.2', made.volumes);
    check('the volume change did not touch playback', made.calls.length === 0, made.calls);
  });

  suite('ambient sound race: the last of several volume changes during a load wins', async () => {
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    audio.setVolume(0.2);
    audio.setVolume(0.7);
    audio.setVolume(0.4);

    const made = await settle();

    check('the final player volume is the last one asked for', made.volume === 0.4, made.volume);
    check('and the controller agrees', consistent(audio, made), {
      controller: audio.snapshot().volume,
      player: made.volume,
    });
    // Reconciliation, not a replay of history: three changes while loading must
    // not turn into three native calls once the player exists.
    check('the intermediate volumes were not replayed at the player', made.volumes.join(',') === '0.4', made.volumes);
  });

  suite('ambient sound race: a volume change and a play during a load both land', async () => {
    // The two halves of the same arrival: volume is the part that was missing, and
    // intent is the part that already worked. Both must survive together.
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    audio.setVolume(0.3);
    audio.play();

    const made = await settle();

    check('the player was told to play', made.calls.join(',') === 'play', made.calls);
    check('at the volume chosen while it was loading', made.volume === 0.3, made.volume);
    check('the controller reports playing', audio.snapshot().phase === 'playing');
    check('and its volume matches the player', consistent(audio, made), {
      controller: audio.snapshot().volume,
      player: made.volume,
    });
  });

  suite('ambient sound race: pausing during a load still yields a silent player at the right volume', async () => {
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    audio.setVolume(0.15);
    audio.play();
    audio.pause();

    const made = await settle();

    check('the player was told to pause and never played', made.calls.join(',') === 'pause', made.calls);
    check('at the volume chosen while it was loading', made.volume === 0.15, made.volume);
    check('the session is paused', audio.snapshot().phase === 'paused');
  });

  suite('ambient sound race: reconciling volume does not invent playback', async () => {
    // The stated principle: state about actual playback may only claim playback
    // when the native call genuinely succeeded. Applying a volume is not a reason
    // to move the phase, so a plain load must still make no sound at all.
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    const made = await settle();

    check('a player arriving with no play intent is not played', !made.calls.includes('play'), made.calls);
    check('and is not asked to play or pause either', made.calls.length === 0, made.calls);
    check('it is still only stopped', audio.snapshot().phase === 'stopped');

    // And if the native play genuinely fails, the controller must not claim it.
    const failing = manualDriver();
    const second = new MeditationAudioController(failing.driver);
    void second.load(9);
    const broken = await failing.settle({ throwOnPlay: true });
    second.play();

    check('it did try to play', broken.calls.includes('play'), broken.calls);
    check('but does not claim to be playing', second.snapshot().phase !== 'playing', second.snapshot().phase);
  });

  suite('ambient sound race: unloading during a load discards the player untouched', async () => {
    // The orphaned player must be released, must never become the active handle,
    // and must not be given a volume - there is no controller left to own it.
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    audio.setVolume(0.2);
    audio.unload();

    const orphan = await settle();

    check('the stale player was released', orphan.calls.join(',') === 'release', orphan.calls);
    check('it was never given the volume', orphan.volumes.length === 0, orphan.volumes);
    check('and never played', !orphan.calls.includes('play'), orphan.calls);
    check('the controller reports no source', audio.snapshot().hasSource === false);
    check('and is stopped', audio.snapshot().phase === 'stopped');

    // The controller stays usable, and the volume it was left holding is the one a
    // later load uses.
    void audio.load(8);
    const next = await settle();
    check('a fresh load still gets a player', next.calls.length === 0, next.calls);
    check('at the volume the controller was left holding', next.volume === 0.2, next.volume);
    check('and they agree', consistent(audio, next), { controller: audio.snapshot().volume, player: next.volume });
  });

  suite('ambient sound race: a failed creation leaks nothing and a retry still works', async () => {
    const { driver, fail, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    audio.setVolume(0.35);
    await fail('expo-audio is not available');

    check('the failure is recorded, not thrown', audio.snapshot().phase === 'error', audio.snapshot().phase);
    check('a volume set during the failed load is still remembered', audio.snapshot().volume === 0.35, audio.snapshot().volume);

    // Entering the screen again is allowed to try once more, and the retry must
    // pick up the volume rather than resetting to the constructor default.
    void audio.load(7);
    const made = await settle();

    check('the retry produced a player', audio.snapshot().phase === 'stopped', audio.snapshot().phase);
    check('at the volume the controller was holding', made.volume === 0.35, made.volume);
    check('and they agree', consistent(audio, made), { controller: audio.snapshot().volume, player: made.volume });
  });

  suite('ambient sound race: volume changes still apply immediately once loaded', async () => {
    // The pre-existing behaviour the fix must not regress.
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver, { volume: 0.2 });

    void audio.load(7);
    const made = await settle();
    check('the player arrived at the volume it was created with', made.volume === 0.2, made.volume);

    audio.play();
    audio.setVolume(0.6);

    check('the change reached the loaded player at once', made.volume === 0.6, made.volume);
    check('and they agree', consistent(audio, made), { controller: audio.snapshot().volume, player: made.volume });
    check('and playback was neither stopped nor restarted', made.calls.join(',') === 'play', made.calls);
  });

  suite('ambient sound race: a volume change during a load is clamped like any other', async () => {
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    audio.setVolume(5);
    const loud = await settle();
    check('a volume above one is clamped before it reaches the player', loud.volume === 1, loud.volume);

    void audio.load(8);
    audio.setVolume(-3);
    const quiet = await settle();
    check('a negative volume is clamped to silence', quiet.volume === 0, quiet.volume);
    check('and the controller says the same thing', consistent(audio, quiet), {
      controller: audio.snapshot().volume,
      player: quiet.volume,
    });
  });

  suite('ambient sound race: a disposed controller ignores a volume change', async () => {
    const { driver, settle } = manualDriver();
    const audio = new MeditationAudioController(driver);

    void audio.load(7);
    const made = await settle();
    audio.dispose();
    audio.setVolume(0.9);

    check('the volume is not adopted after disposal', audio.snapshot().volume !== 0.9, audio.snapshot().volume);
    check('and the released player is not reconfigured', made.volumes.join(',') !== '0.9', made.volumes);
    check('the controller stays stopped', audio.snapshot().phase === 'stopped');
  });
}