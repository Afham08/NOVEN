import { check, suite } from './harness';

import {
  ambientAudioFor,
  createExpoAudioDriver,
  DEFAULT_AMBIENT_VOLUME,
  MeditationAudioController,
  type MeditationAudioDriver,
  type MeditationAudioHandle,
  type MeditationAudioSource,
} from '../src/activities/meditation-audio';
import { GuidedSession } from '../src/activities/guided-session';
import { defineGuidedActivity, type GuidedActivity } from '../src/activities/types';

/*
 * The last two suites read the app's source rather than importing the screen, for
 * the same reason settings-navigation.test.ts and activity-flow.test.ts do: the
 * screen is a React Native component with @/ aliases and native-only imports, and
 * the test build deliberately excludes it. What is guarded there is the wiring —
 * that the four lifecycle callbacks each reach the audio controller, and that the
 * config asks for no permissions — rather than the behaviour, which the suites
 * above prove directly against the real controller.
 */
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};

const fs = require('fs') as ReturnType<typeof require>;
const nodePath = require('path') as ReturnType<typeof require>;

// __dirname is the COMPILED test directory, so the app source is two levels up.
const fromRoot = (...segments: string[]) => nodePath.resolve(__dirname, '../..', ...segments);
const read = (...segments: string[]) => fs.readFileSync(fromRoot(...segments), 'utf8');

/**
 * Coverage for the ambient sound decision layer.
 *
 * Nothing here plays audio. Every test drives the real MeditationAudioController
 * over a hand-written driver whose `create` is a promise the test resolves by
 * hand, which is the entire point of keeping that boundary injected: the hard part
 * of this feature is not making a noise, it is the load-versus-lifecycle races,
 * and those are only provable if the load can be held open while a pause, an end
 * or an unmount happens underneath it.
 *
 * There is no clock and no timer anywhere below. "Loading takes a while" is
 * modelled by not resolving the promise yet, which means every race here finishes
 * in microseconds and always in the same order.
 */

/* ------------------------------------------------------------------- rig -- */

type Recording = {
  handle: MeditationAudioHandle;
  /** Every verb called, in order, e.g. ['play', 'pause', 'stop']. */
  calls: string[];
  /** Volume values pushed at the handle, in order. */
  volumes: number[];
};

/** A handle that records rather than sounds, and can be told to throw. */
function recordingHandle(options?: { throwOnPlay?: boolean }): Recording {
  const calls: string[] = [];
  const volumes: number[] = [];
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
    },
    release() {
      calls.push('release');
    },
  };
  return { handle, calls, volumes };
}

type PendingLoad = {
  source: MeditationAudioSource;
  volume: number;
  loop: boolean;
  resolve: (handle: MeditationAudioHandle) => void;
  reject: (error: unknown) => void;
};

/**
 * A driver whose loads are resolved by the test, plus a log of the options each
 * one was asked for. Nothing resolves on its own, so no test can accidentally
 * depend on how long a real load takes.
 */
function manualDriver() {
  const pending: PendingLoad[] = [];
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
    /** Hands the oldest unresolved load a working player. */
    async settle(handle?: Recording) {
      const load = pending.shift();
      if (!load) throw new Error('no load is pending');
      const made = handle ?? recordingHandle();
      load.resolve(made.handle);
      await flush();
      return made;
    },
    /** Fails the oldest unresolved load, the way a missing file would. */
    async fail(message = 'no audio on this device') {
      const load = pending.shift();
      if (!load) throw new Error('no load is pending');
      load.reject(new Error(message));
      await flush();
    },
  };
}

/**
 * Lets the load continuation run. One microtask tick is enough because the test's
 * own await is queued after the one the load just released; the second is
 * belt-and-braces so a controller that chains is never caught half-way.
 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/* --------------------------------------------------- no source is required -- */

suite('ambient sound: a meditation with no source is silent and stays inert', async () => {
  const { driver, pending } = manualDriver();
  const audio = new MeditationAudioController(driver);

  check('a controller nobody loaded is disabled', audio.snapshot().phase === 'disabled');
  check('it reports no source', audio.snapshot().hasSource === false);

  audio.play();
  audio.pause();
  audio.stop();
  await flush();

  check('play on an unconfigured controller touches no driver', pending.length === 0);
  check('and it is still disabled', audio.snapshot().phase === 'disabled');
  check('and still reports no source', audio.snapshot().hasSource === false);
});

suite('ambient sound: the default bed is quiet', () => {
  const { driver } = manualDriver();
  const plain = new MeditationAudioController(driver);
  check(
    'the default volume is well below half',
    plain.snapshot().volume < 0.5,
    plain.snapshot().volume,
  );
  check('the default volume is the documented one', plain.snapshot().volume === DEFAULT_AMBIENT_VOLUME);
});

suite('ambient sound: volume is clamped rather than trusted', () => {
  const { driver } = manualDriver();
  const audio = new MeditationAudioController(driver, { volume: 5 });
  check('a volume above one is clamped', audio.snapshot().volume === 1);

  audio.setVolume(-3);
  check('a negative volume is clamped to silence', audio.snapshot().volume === 0);

  audio.setVolume(0.4);
  check('a sensible volume is kept as given', Math.abs(audio.snapshot().volume - 0.4) < 1e-9);

  audio.setVolume(Number.NaN);
  check('a nonsensical volume falls back to the default', audio.snapshot().volume === DEFAULT_AMBIENT_VOLUME);
});

/* ------------------------------------------------------------- happy path -- */

suite('ambient sound: loading without playing stays silent', async () => {
  const { driver, pending, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(42);
  check('a load in flight is loading', audio.snapshot().phase === 'loading');
  check('the driver was asked for the source it was given', pending[0].source === 42);
  check('the bed is asked to loop, so it outlives its own length', pending[0].loop === true);
  check('the volume is handed to the driver, not applied later', pending[0].volume === DEFAULT_AMBIENT_VOLUME);

  const made = await settle();
  check('nothing played just because a player arrived', !made.calls.includes('play'), made.calls);
  check('and nothing was asked of it either', made.calls.length === 0, made.calls);
  check('and the controller is stopped, not playing', audio.snapshot().phase === 'stopped');
});

suite('ambient sound: the bed plays, pauses, resumes and stops with the session', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  const made = await settle();

  audio.play();
  check('playing is playing', audio.snapshot().phase === 'playing');
  check('the intent is playing too', audio.snapshot().intent === 'playing');

  audio.pause();
  check('pausing is pausing', audio.snapshot().phase === 'paused');

  audio.play();
  check('resuming is playing again', audio.snapshot().phase === 'playing');

  audio.stop();
  check('stopping is stopping', audio.snapshot().phase === 'stopped');

  check(
    'the player saw exactly one play, one pause, a second play and a stop',
    made.calls.join(',') === 'play,pause,play,stop',
    made.calls,
  );
});

suite('ambient sound: volume reaches the player without reloading it', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver, { volume: 0.2 });

  void audio.load(7);
  const made = await settle();

  audio.play();
  audio.setVolume(0.6);

  check('the new volume reached the player', made.volumes[made.volumes.length - 1] === 0.6);
  check(
    'changing the volume neither stopped nor restarted playback',
    made.calls.join(',') === 'play',
    made.calls,
  );
});

/* ------------------------------------------------------------ idempotency -- */

suite('ambient sound: repeated transitions do not repeat themselves', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  const made = await settle();

  // A double tap on Start, or a re-render that calls play again.
  audio.play();
  audio.play();
  audio.play();
  check('three plays make one sound', made.calls.filter((c) => c === 'play').length === 1);
  check('the phase is still simply playing', audio.snapshot().phase === 'playing');

  audio.pause();
  audio.pause();
  check('two pauses make one pause', made.calls.filter((c) => c === 'pause').length === 1);

  audio.stop();
  audio.stop();
  check('two stops make one stop', made.calls.filter((c) => c === 'stop').length === 1);

  // And the opposite order: stopping, then starting again, is a real transition.
  audio.play();
  check('starting after a stop plays again', made.calls.filter((c) => c === 'play').length === 2);
});

suite('ambient sound: the same source is only ever loaded once', async () => {
  const { driver, pending, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  void audio.load(7);
  void audio.load(7);
  check('three loads of one source ask the driver once', pending.length === 1);

  const made = await settle();
  check('and produce one player', made.calls.length === 0);

  // Loading again after it is loaded must not build a second player either.
  void audio.load(7);
  await flush();
  check('still only the original load', pending.length === 0);
});

/* ------------------------------------------------------------------ races -- */

suite('ambient sound: pausing while it is still loading never makes a sound', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  // Start, then immediately pause, before the player exists.
  audio.play();
  audio.pause();
  check('the intent is already paused', audio.snapshot().intent === 'paused');

  const made = await settle();
  check(
    'the player that arrived was told to pause and was never played',
    made.calls.join(',') === 'pause',
    made.calls,
  );
  check('so the session is paused, not playing', audio.snapshot().phase === 'paused');
});

suite('ambient sound: ending while it is still loading never makes a sound', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  audio.play();
  // The session ends before the load comes back.
  audio.stop();
  check('the intent is already stopped', audio.snapshot().intent === 'stopped');

  const made = await settle();
  check(
    'the player that arrived was never played',
    !made.calls.includes('play'),
    made.calls,
  );
  check('so the session is stopped', audio.snapshot().phase === 'stopped');
});

suite('ambient sound: unmounting while it is still loading leaks nothing', async () => {
  const { driver, pending, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  audio.play();
  audio.dispose();

  check('a disposed controller is stopped', audio.snapshot().phase === 'stopped');

  // The load lands after the screen has gone. The player it produces must be
  // released and must never be played.
  const made = await settle();
  check('the orphaned player was released and never played', made.calls.join(',') === 'release', made.calls);
  check('there is exactly one orphaned player', pending.length === 0);

  // And the controller is inert afterwards, whatever the screen tries.
  audio.play();
  audio.pause();
  audio.stop();
  await flush();
  check('a disposed controller ignores everything afterwards', audio.snapshot().phase === 'stopped');
  check('and nothing further reached the orphaned player', made.calls.join(',') === 'release');
});

suite('ambient sound: switching source mid-load keeps only the newest player', async () => {
  const { driver, pending, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load('first');
  void audio.load('second');
  check('two sources means two loads', pending.length === 2);

  // The superseded load lands late, after the second one was already asked for.
  const superseded = await settle();
  audio.play();
  check(
    'the superseded player was released and never played',
    superseded.calls.join(',') === 'release',
    superseded.calls,
  );

  const current = await settle();
  check('the newest source is the one that plays', current.calls.join(',') === 'play', current.calls);
  check('both loads have now been consumed', pending.length === 0);
});

/* ------------------------------------------------------------- unloading -- */

suite('ambient sound: finishing a session keeps the player but stops it', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  const made = await settle();
  audio.play();

  // This is what "End" does: stop, and keep the player so Start again is instant.
  audio.stop();
  check('the player is stopped', made.calls.join(',') === 'play,stop', made.calls);
  check('but not released, so it can be reused', audio.snapshot().hasSource === true);

  audio.play();
  check('and a fresh session plays again', made.calls.join(',') === 'play,stop,play', made.calls);
});

suite('ambient sound: unloading frees the player and forgets the source', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  const made = await settle();
  audio.play();

  audio.unload();
  check('unloading stops and releases', made.calls.join(',') === 'play,stop,release', made.calls);
  check('it reports no source afterwards', audio.snapshot().hasSource === false);
  check('and is stopped', audio.snapshot().phase === 'stopped');

  // An unloaded controller with no new source must not resurrect itself.
  audio.play();
  check('playing an unloaded controller does nothing', made.calls.join(',') === 'play,stop,release');
});

/* --------------------------------------------------------------- failure -- */

suite('ambient sound: a device with no working audio plays the session in silence', async () => {
  const { driver, fail } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  await fail('expo-audio is not available');

  check('the failure is recorded rather than thrown', audio.snapshot().phase === 'error');

  // The important part: the session carries on.
  audio.play();
  audio.pause();
  await flush();
  check('and nothing raises an unhandled rejection', audio.snapshot().phase === 'error');

  // A failed load is not retried behind the person's back, but entering the screen
  // again is allowed to try once more.
  void audio.load(7);
  await fail();
  check('a reload after a failure does try again', audio.snapshot().phase === 'error');
});

suite('ambient sound: a player that throws cannot take the session down', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  const made = await settle(recordingHandle({ throwOnPlay: true }));

  audio.play();
  check('the controller does not claim to be playing', audio.snapshot().phase === 'stopped');
  check('but it did try', made.calls.includes('play'), made.calls);
});

suite('ambient sound: a listener that throws cannot stop the others being told', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  void audio.load(7);
  await settle();

  // Counted from here so the assertion is about the play() transition alone,
  // rather than about however many transitions the load happened to make.
  let goodCalls = 0;
  audio.subscribe(() => {
    goodCalls++;
    throw new Error('a bad subscriber');
  });
  audio.subscribe(() => {
    goodCalls++;
  });

  audio.play();

  check('both listeners were told, despite the first throwing', goodCalls === 2, goodCalls);
  check('and the transition still completed', audio.snapshot().phase === 'playing');
});

suite('ambient sound: the real driver degrades instead of crashing on a machine with no native runtime', async () => {
  const audio = new MeditationAudioController(createExpoAudioDriver());

  // Must not reject: `load` absorbs the failure, which is what keeps the screen's
  // `void audio.load(...)` from producing an unhandled rejection.
  await audio.load('https://example.invalid/bed.mp3');

  check('it lands in error rather than throwing', audio.snapshot().phase === 'error', audio.snapshot());
});

/* -------------------------------------------------- which activities get it -- */

function activityWithAudio(kind: GuidedActivity['kind']): GuidedActivity {
  return defineGuidedActivity({
    id: `${kind}-with-audio`,
    kind,
    name: 'Test activity',
    summary: 'A test activity.',
    steps: [{ seconds: 60, title: 'Sit', guidance: 'Sit comfortably.' }],
    progressNoun: 'stages',
    safetyNote: 'Stop if anything hurts.',
    ambientAudio: { source: 99 },
  });
}

suite('ambient sound: only a meditation can have a bed', () => {
  const meditation = activityWithAudio('meditation');
  check('a meditation gets its bed', ambientAudioFor(meditation)?.source === 99);

  for (const kind of ['yoga', 'wellness'] as const) {
    check(
      `${kind} never gets a bed, even carrying one on the activity`,
      ambientAudioFor(activityWithAudio(kind)) === undefined,
    );
  }

  const plain = defineGuidedActivity({
    id: 'meditation-silent',
    kind: 'meditation',
    name: 'Silent meditation',
    summary: 'No sound.',
    steps: [{ seconds: 60, title: 'Sit', guidance: 'Sit comfortably.' }],
    progressNoun: 'stages',
    safetyNote: 'Stop if anything hurts.',
  });
  check('a meditation with no source gets nothing', ambientAudioFor(plain) === undefined);
});

/* ------------------------------------------------ the real session, mapped -- */

suite('ambient sound: a real GuidedSession drives the bed through its own phases', async () => {
  const { driver, settle } = manualDriver();
  const audio = new MeditationAudioController(driver);

  const activity = defineGuidedActivity({
    id: 'meditation-session',
    kind: 'meditation',
    name: 'Breathing',
    summary: 'Five minutes.',
    steps: [{ seconds: 300, title: 'Breathe', guidance: 'Breathe slowly.', breathingTechniqueId: 'box-breathing' }],
    progressNoun: 'stages',
    safetyNote: 'Stop if anything hurts.',
    ambientAudio: { source: 99, volume: 0.3 },
  });
  const session = new GuidedSession(activity);

  void audio.load(activity.ambientAudio!.source);
  const made = await settle();

  // Exactly what the screen does, in the same order.
  session.start();
  audio.play();
  check('starting the session starts the bed', made.calls.join(',') === 'play', made.calls);

  session.pause();
  audio.pause();
  check('pausing the session pauses the bed', made.calls.join(',') === 'play,pause', made.calls);

  session.resume();
  audio.play();
  check('resuming the session resumes the bed', made.calls.join(',') === 'play,pause,play', made.calls);

  session.finishEarly();
  audio.stop();
  check('finishing the session stops the bed', made.calls.join(',') === 'play,pause,play,stop', made.calls);
  check(
    'and the session really did finish',
    session.snapshot().finished === true,
    session.snapshot(),
  );
});

/* ------------------------------------------------------------ source wiring -- */

suite('ambient sound: the screen wires audio into the session and nothing else', () => {
  const screen = read('src', 'components', 'guided', 'guided-activity-screen.tsx');
  const audio = read('src', 'activities', 'meditation-audio.ts');

  check('the screen builds the controller over the real expo-audio driver', /createExpoAudioDriver\(\)/.test(screen));
  check('the screen disposes it on unmount', /audio\.dispose\(\)/.test(screen));
  check('the screen unsubscribes before disposing', screen.indexOf('unsubscribe();') < screen.indexOf('audio.dispose();'));
  check('Start asks the bed to play', /ambientOnRef\.current\) audioRef\.current\?\.play\(\)/.test(screen));
  check('Pause silences it', /audioRef\.current\?\.pause\(\)/.test(screen));
  check('finishing the session stops it', /audioRef\.current\?\.stop\(\)/.test(screen));
  check('the bed is loaded on mount rather than on the first Start', /void audio\.load\(ambientSource\)/.test(screen));

  check('the controller has no timer of its own', !/setInterval|setTimeout/.test(audio));
  check('the controller imports no React and no react-native', !/from 'react'|from 'react-native'/.test(audio));
  check('the expo-audio module is loaded lazily, not at import time', /require\('expo-audio'\)/.test(audio));
  check('the audio layer is not wired into the exercise pipeline', !/session-store|SessionEngine/.test(audio));

  check(
    'a failed load puts no error message in front of the person',
    !/Ambient sound unavailable/.test(screen),
  );
  check(
    'and the only word "playing" can appear on is one guarded by the real phase',
    /audioPhase === 'playing'\s*\?\s*'Ambient sound playing'/.test(screen),
  );
});

suite('ambient sound: the app config asks for no audio permissions', () => {
  const appJson = JSON.parse(read('app.json')) as {
    expo: { plugins: unknown[]; android: { permissions?: string[] } };
  };

  const plugin = appJson.expo.plugins.find(
    (entry) => entry === 'expo-audio' || (Array.isArray(entry) && entry[0] === 'expo-audio'),
  );
  check('expo-audio has a config plugin entry', plugin !== undefined);

  const options = (Array.isArray(plugin) ? plugin[1] : {}) as Record<string, unknown>;
  check(
    'background playback is off, so no media service or lock-screen controls',
    options.enableBackgroundPlayback === false,
    options,
  );
  check('background recording is off', options.enableBackgroundRecording === false);
  check('the Android record permission is not requested', options.recordAudioAndroid === false);
  check('no microphone prompt is declared for iOS', options.microphonePermission === false);

  const permissions = appJson.expo.android.permissions ?? [];
  check(
    'and the manifest asks for no audio permission at all',
    permissions.every((p) => !/AUDIO|MICROPHONE/.test(p)),
    permissions,
  );
});

export function run(): void {
  // Suites self-register through `suite(...)` as they are declared.
}