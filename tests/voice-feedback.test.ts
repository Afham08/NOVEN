import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { pausedFeedback, phaseFeedback, presenceFeedback, readinessFeedback, setupFeedback } from '../src/exercise/feedback';
import { SessionEngine } from '../src/exercise/session-engine';
import { repCountToWords, VoiceFeedbackController, type SpeechPriority, type SpeechSink } from '../src/exercise/voice-feedback';

import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName, PosePresence } from '../modules/pose-tracker';
import type { Side } from '../src/exercise/types';

/**
 * Coverage for the voice decision layer.
 *
 * These tests never touch Android's text-to-speech engine. They drive the real
 * VoiceFeedbackController with a recording sink, and the integration suites at
 * the bottom drive the real SessionEngine so the "exactly one announcement per
 * state change" guarantee is proven end to end rather than against a
 * hand-built cue.
 *
 * The controller deliberately takes NO clock: whether a cue is spoken is a pure
 * function of the previous cue kind and the current one. The clock below is a
 * test-only fiction used to let plenty of real time pass in a test, so the
 * assertions can prove that elapsed time alone never re-arms a cue.
 *
 * Nothing here verifies that sound actually comes out of the speaker.
 */

type Spoken = { text: string; priority: SpeechPriority; interrupt: boolean };

function recordingSink() {
  const spoken: Spoken[] = [];
  const stops: number[] = [];
  const sink: SpeechSink = {
    speak(text, options) {
      spoken.push({ text, priority: options.priority, interrupt: options.interrupt });
    },
    stop() {
      stops.push(spoken.length);
    },
  };
  return { spoken, stops, sink };
}

/** Test-only: simulates real time passing. The controller never reads it. */
function fakeClock(start = 10_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

/** Builds a controller over a recording sink, plus a clock the code ignores. */
function rig() {
  const rec = recordingSink();
  const clock = fakeClock();
  const voice = new VoiceFeedbackController(rec.sink);
  return { ...rec, clock, voice };
}

/* ------------------------------------------------------------------ cues -- */

const RESTING = { feedback: readinessFeedback('ready'), repCompletedThisFrame: false, reps: 0 };
const EXTENDING = { feedback: phaseFeedback('extending', false), repCompletedThisFrame: false, reps: 0 };
const HOLDING = { feedback: phaseFeedback('extended', false), repCompletedThisFrame: false, reps: 0 };
const RETURNING = { feedback: phaseFeedback('returning', false), repCompletedThisFrame: false, reps: 0 };
const PRAISE = { feedback: phaseFeedback('rest', true), repCompletedThisFrame: false, reps: 1 };
const NOT_TRACKED = {
  feedback: presenceFeedback('lost'),
  repCompletedThisFrame: false,
  reps: 3,
};
const WAITING = { feedback: readinessFeedback('waiting'), repCompletedThisFrame: false, reps: 3 };
const STABILIZING = { feedback: readinessFeedback('stabilizing'), repCompletedThisFrame: false, reps: 3 };
const rep = (n: number) => ({
  feedback: phaseFeedback('rest', true),
  repCompletedThisFrame: true,
  reps: n,
});

/* ------------------------------------------------- 1. rapid duplication -- */

export function run(): void {
  suite('voice: correct movement is silent, however many frames it lasts', () => {
    // "The pose pipeline can run many times per second" — 40 frames inside one
    // second must not become 40 utterances. Under the form-correction policy it
    // must not become even one: the user is performing the movement correctly.
    const { spoken, voice, clock } = rig();
    for (let i = 0; i < 40; i++) {
      voice.onFrame(EXTENDING);
      clock.advance(25);
    }
    check('40 extend frames -> 0 utterances', spoken.length === 0, spoken);
  });

  suite('voice: a whole correct rep says nothing but the rep count', () => {
    const { spoken, voice } = rig();
    // The detector holds a phase for several frames; the cue is constant while it
    // does, so each of these is fed repeatedly the way a real frame stream would.
    for (let i = 0; i < 6; i++) voice.onFrame(EXTENDING);
    for (let i = 0; i < 6; i++) voice.onFrame(HOLDING);
    for (let i = 0; i < 6; i++) voice.onFrame(RETURNING);
    voice.onFrame(rep(1));
    for (let i = 0; i < 6; i++) voice.onFrame(PRAISE);

    const texts = spoken.map((s) => s.text);
    check(
      'extend/hold/return are silent, the rep is confirmed once',
      JSON.stringify(texts) === JSON.stringify(['Good. Rep one.']),
      texts,
    );
  });

  /* ------------------------------- 1-4. positioning is a state, not a timer -- */

  suite('voice: entering a positioning problem speaks exactly once', () => {
    const { spoken, voice } = rig();
    voice.onFrame(WAITING);
    check('one utterance on entry', spoken.length === 1, spoken);
    check('it asks the user to settle in', spoken[0]?.text === 'Move into position.', spoken);
  });

  suite('voice: staying in the same positioning problem stays silent', () => {
    // The camera runs many times per second, so a user who needs ten seconds to
    // get into position produces hundreds of identical frames. Each one must be
    // silent after the first: the state has not changed.
    const { spoken, voice, clock } = rig();
    voice.onFrame(WAITING);
    const afterEntry = spoken.length;

    for (let i = 0; i < 400; i++) {
      voice.onFrame(WAITING);
      clock.advance(25); // ten seconds of real time, frame by frame
    }
    check('no further utterance while the state persists', spoken.length === afterEntry, spoken);
  });

  suite('voice: elapsed time alone never re-arms a positioning problem', () => {
    // The old policy re-nagged once a cooldown expired, which is what produced
    // "Move into position." every few seconds. There is no timer any more, so
    // waiting as long as we like must change nothing.
    const { spoken, voice, clock } = rig();
    voice.onFrame(WAITING);

    for (let seconds = 0; seconds < 60; seconds++) {
      clock.advance(1000);
      voice.onFrame(WAITING);
    }
    check('still exactly one utterance after a full minute', spoken.length === 1, spoken);
  });

  suite('voice: a genuine recovery re-arms the positioning problem', () => {
    // 'ready' is the engine saying the posture is countable again. It has no
    // wording of its own, but it must still be recorded, or the next problem
    // would be mistaken for a repeat of the previous one and never announced.
    const { spoken, voice } = rig();
    voice.onFrame(WAITING);
    check('first problem announced', spoken.length === 1, spoken);

    voice.onFrame(RESTING);
    check('recovery itself is silent', spoken.length === 1, spoken);

    voice.onFrame(WAITING);
    check('the problem returning is announced again', spoken.length === 2, spoken);
    check(
      'and it says the same thing both times',
      spoken.every((s) => s.text === 'Move into position.'),
      spoken,
    );
  });

  suite('voice: the three setup problems do not interrupt each other', () => {
    // All three are phases of the same unresolved problem — the posture is not
    // countable yet. Flapping between them (which a single noisy frame
    // genuinely does) must not produce "Move into position." / "Hold still." /
    // "Move into position." for one pose the user is still settling into.
    const { spoken, voice, clock } = rig();
    for (let i = 0; i < 30; i++) {
      voice.onFrame(NOT_TRACKED);
      voice.onFrame(WAITING);
      voice.onFrame(STABILIZING);
      clock.advance(50);
    }
    check('one utterance for the whole unresolved problem', spoken.length === 1, spoken);
    check('it was the entry cue', spoken[0]?.text === 'Move into the camera view.', spoken);
  });

  suite('voice: leaving the setup problem silences it until it comes back', () => {
    const { spoken, voice } = rig();
    voice.onFrame(WAITING);
    voice.onFrame(RESTING);
    voice.onFrame(rep(1)); // a counted rep is itself proof of a good posture
    const afterRep = spoken.length;

    for (let i = 0; i < 50; i++) voice.onFrame(WAITING);
    check('a lost posture after a real rep is announced again', spoken.length === afterRep + 1, spoken);
  });

  /* --------------------------------------------------------- 2. timers -- */

  suite('voice: a correct movement cue never speaks, not even after a long hold', () => {
    const { spoken, voice, clock } = rig();
    voice.onFrame(EXTENDING);
    clock.advance(30_000);
    voice.onFrame(EXTENDING);
    check('a held extension is never announced', spoken.length === 0, spoken);
  });

  /* --------------------------------------------------------- 3/4. reps -- */

  suite('voice: one rep produces exactly one announcement', () => {
    const { spoken, voice, clock } = rig();
    voice.onFrame(rep(1));
    check('one utterance for one rep', spoken.length === 1, spoken);
    check('it counts the rep in words', spoken[0]?.text === 'Good. Rep one.', spoken);

    // The praise cue is latched on screen for many frames after the rep. Those
    // frames must stay silent.
    for (let i = 0; i < 30; i++) {
      voice.onFrame(PRAISE);
      clock.advance(40);
    }
    check('latched praise frames add nothing', spoken.length === 1, spoken);
  });

  suite('voice: rep counting words reads naturally', () => {
    check('zero', repCountToWords(0) === 'zero', repCountToWords(0));
    check('four', repCountToWords(4) === 'four', repCountToWords(4));
    check('twelve', repCountToWords(12) === 'twelve', repCountToWords(12));
    check('twenty', repCountToWords(20) === 'twenty', repCountToWords(20));
    check('beyond twenty falls back to digits', repCountToWords(37) === '37', repCountToWords(37));
    check('non-finite input does not throw', repCountToWords(Number.NaN) === 'NaN');
  });

  /* -------------------------------------------- 5-9. phase transitions -- */

  suite('voice: each phase transition is announced exactly once', () => {
    const { spoken, voice } = rig();
    voice.announceStart();
    check('READY -> RUNNING says Start', spoken.length === 1 && spoken[0].text === 'Start.', spoken);

    voice.announcePause();
    check('RUNNING -> PAUSED says Paused', spoken.length === 2 && spoken[1].text === 'Paused.', spoken);

    voice.announceResume();
    check('PAUSED -> RUNNING says Resume', spoken.length === 3 && spoken[2].text === 'Resume.', spoken);

    voice.announceCompletion(8);
    const texts = spoken.map((s) => s.text);
    check(
      'COMPLETED says complete and the tally',
      JSON.stringify(texts) ===
        JSON.stringify(['Start.', 'Paused.', 'Resume.', 'Session complete.', 'You completed eight reps.']),
      texts,
    );
  });

  suite('voice: nothing is spoken after completion', () => {
    const { spoken, voice, clock } = rig();
    voice.announceCompletion(3);
    const afterCompletion = spoken.length;
    check('completion was announced', afterCompletion > 0, spoken);

    // A late pose frame, a re-render, and further transitions must all be silent.
    voice.onFrame(rep(4));
    voice.onFrame(EXTENDING);
    voice.announcePause();
    voice.announceResume();
    voice.consider('position');
    clock.advance(10_000);
    voice.onFrame(NOT_TRACKED);
    check('the session stays silent forever', spoken.length === afterCompletion, spoken);
  });

  /* -------------------------------------------------------- 10. paused -- */

  suite('voice: no exercise speech while paused', () => {
    const { spoken, voice, clock } = rig();
    voice.announceStart();
    voice.announcePause();
    const atPause = spoken.length;

    // Frames still arrive from the camera while paused. None of them may speak,
    // and in particular none of them may announce a rep.
    for (let i = 0; i < 20; i++) {
      voice.onFrame(EXTENDING);
      voice.onFrame(rep(2));
      voice.onFrame(PRAISE);
      clock.advance(50);
    }
    check('silence while suspended', spoken.length === atPause, spoken);

    voice.announceResume();
    check('resuming speaks again', spoken.length === atPause + 1, spoken);
  });

  suite('voice: a pause cannot be used to smuggle in a rep', () => {
    const { spoken, voice } = rig();
    voice.announcePause();
    voice.onFrame(rep(1));
    voice.onFrame(rep(2));
    check('no rep announced while paused', spoken.every((s) => !s.text.includes('Rep')), spoken);
  });

  /* -------------------------------------------- 11/12. interrupt policy -- */

  suite('voice: a genuine loss of the user interrupts stale praise', () => {
    // 'position' is a model-level presence loss: the person is not in frame at
    // all, so praise still playing describes something they can no longer be
    // doing. Cutting it off is the correct behaviour.
    const { spoken, stops, voice } = rig();
    voice.onFrame(rep(1));
    check('praise first', spoken[0].text === 'Good. Rep one.', spoken);

    voice.onFrame(NOT_TRACKED);
    check('warning came second', spoken.length === 2, spoken);
    check('the warning is the interrupting one', spoken[1].interrupt === true, spoken[1]);
    check('praise did not interrupt', spoken[0].interrupt === false, spoken[0]);
    check('the speaker was stopped before the warning', stops.length === 1, stops);
    check('warning priority is high', spoken[1].priority === 'high', spoken[1]);
  });

  suite('voice: a not-yet-settled posture does not interrupt praise', () => {
    // The opposite case. 'positioning' means the posture is not countable YET,
    // which a single transient frame can cause, so it must not cut off a rep
    // confirmation the user actually earned. It still speaks, once.
    const { spoken, stops, voice } = rig();
    voice.onFrame(rep(1));

    voice.onFrame(WAITING);
    check('the correction was still spoken', spoken.length === 2, spoken);
    check('it did not interrupt', spoken[1].interrupt === false, spoken[1]);
    check('the speaker was left alone', stops.length === 0, stops);
    check('it is not high priority', spoken[1].priority === 'normal', spoken[1]);
  });

  suite('voice: a transient frame cannot cut off a session transition', () => {
    // The user is hearing the end-of-session message; a setup cue caused by one
    // bad frame must not truncate it.
    const { spoken, stops, voice } = rig();
    voice.announceCompletion(4);
    const afterCompletion = spoken.length;

    voice.onFrame(WAITING);
    voice.onFrame(STABILIZING);
    voice.onFrame(NOT_TRACKED);
    check('the session closing was not interrupted', spoken.length === afterCompletion, spoken);
    check('the speaker was not stopped again', stops.length === 1, stops);
  });

  suite('voice: entering the hold-still state speaks exactly once', () => {
    const { spoken, voice } = rig();
    voice.onFrame(STABILIZING);
    check('one utterance on entry', spoken.length === 1, spoken);
    check('it asks for stillness', spoken[0]?.text === 'Hold still.', spoken);
  });

  suite('voice: staying in the hold-still state stays silent', () => {
    // Holding still is precisely the phase where a user is motionless and least
    // able to react, so repeating "Hold still." is the worst case of all of them.
    const { spoken, voice, clock } = rig();
    voice.onFrame(STABILIZING);
    for (let i = 0; i < 300; i++) {
      voice.onFrame(STABILIZING);
      clock.advance(25);
    }
    check('seven and a half seconds of stillness is still one utterance', spoken.length === 1, spoken);
  });

  suite('voice: recovering and needing to settle again speaks twice', () => {
    const { spoken, voice } = rig();
    voice.onFrame(STABILIZING);
    voice.onFrame(RESTING);
    voice.onFrame(STABILIZING);
    check('the second settling gets its own announcement', spoken.length === 2, spoken);
  });

  /* ----------------------------------------------- 5. setup instruction -- */

  suite('voice: the setup instruction is spoken once, in full', () => {
    const { spoken, voice } = rig();
    voice.announceSetup();
    voice.announceSetup();
    check('spoken exactly once', spoken.length === 1, spoken);
    check(
      'it tells the user how to sit',
      spoken[0].text === 'Sit sideways to the camera.',
      spoken[0],
    );
  });

  suite('voice: reset forgets the observed state so a new session starts clean', () => {
    const { spoken, voice } = rig();
    voice.onFrame(NOT_TRACKED);
    voice.reset();
    voice.onFrame(NOT_TRACKED);
    check('the warning is available again immediately', spoken.length === 2, spoken);
  });

  /* ------------------------------------------- 6. dispose / TTS failure -- */

  suite('voice: a disposed controller is inert', () => {
    const { spoken, stops, voice, clock } = rig();
    voice.onFrame(EXTENDING);
    const before = spoken.length;
    voice.dispose();
    check('disposing stops the speaker', stops.length === 1, stops);
    voice.onFrame(rep(1));
    voice.announceCompletion(1);
    clock.advance(10_000);
    check('nothing is said after unmount', spoken.length === before, spoken);
  });

  suite('voice: a failing text-to-speech engine cannot break the session', () => {
    // Every native call throws, as a device with no TTS engine, a revoked audio
    // permission, or a broken engine would.
    const exploding: SpeechSink = {
      speak() {
        throw new Error('no tts engine');
      },
      stop() {
        throw new Error('no tts engine');
      },
    };
    const voice = new VoiceFeedbackController(exploding);

    let threw = false;
    try {
      voice.onFrame(EXTENDING);
      voice.onFrame(rep(1));
      voice.announcePause();
      voice.announceResume();
      voice.announceCompletion(2);
      voice.dispose();
    } catch {
      threw = true;
    }
    check('no exception escapes to the caller', !threw);
  });

  /* ------------------------------------------- 12/13. engine integration -- */

  suite('voice: invalid and non-finite frames never produce praise or a rep', () => {
    const spoken: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        spoken.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    const busted = frame(pose(Number.NaN, Number.NaN), 0);
    const dim = frame(pose(90, 90, { visibility: 0.05 }), 100);

    for (const f of [busted, dim, busted, dim]) {
      const result = engine.handlePoseFrame(f);
      voice.onFrame(result);
    }
    check('no rep was counted', engine.reps === 0, engine.reps);
    check(
      'no rep was announced',
      spoken.every((t) => !t.includes('Rep ')),
      spoken,
    );
    check(
      'no praise was spoken',
      spoken.every((t) => !t.includes('Good')),
      spoken,
    );
    // A corrective positioning cue IS expected here, and is the whole point: the
    // engine is truthfully reporting that the posture is not countable. Going
    // silent instead would leave the user with no idea why counting stopped, so
    // the rule enforced above is "never say anything misleading", not "never say
    // anything at all".
    check(
      'only corrective cues are spoken',
      spoken.every((t) => t === 'Move into position.' || t === 'Move into the camera view.'),
      spoken,
    );
    // Four unusable frames in a row are ONE problem, not four. The engine keeps
    // reporting the same non-countable posture throughout, so the user is told
    // once and then left to fix it in peace.
    check(
      'and the whole run of bad frames produced a single correction',
      spoken.length === 1,
      spoken,
    );
  });

  suite('voice: a pose still settling produces no repeated setup speech', () => {
    // The regression this whole policy exists for, driven through the REAL
    // engine. A user who is nearly ready has their readiness gate flap between
    // the settling and waiting phases as individual frames are noisy. Because
    // those are two phases of one unresolved problem, the user must hear one
    // instruction and nothing else until the pose is genuinely good again —
    // never "Move into position." / "Hold still." / "Move into position.".
    const spoken: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        spoken.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    let t = 0;
    const feed = (landmarks: LandmarkEventPayload[]) => {
      voice.onFrame(engine.handlePoseFrame(frame(landmarks, t)));
      t += 100;
    };
    const good = () => pose(90, 90);
    const bad = () => pose(Number.NaN, Number.NaN);

    // Settle properly first: the gate needs 10 calm frames spanning 1000ms.
    for (let i = 0; i < 14; i++) feed(good());
    check('the gate reached ready', engine.readinessPhase === 'ready', engine.readinessPhase);
    const beforeTrouble = spoken.length;

    // Now a pose that keeps almost settling: bad frame, a few good frames that
    // are not enough to re-anchor the gate, bad frame again, and so on. Each
    // "bad" frame drops the gate back to the waiting phase, so the engine really
    // is reporting a different kind every other frame.
    for (let round = 0; round < 4; round++) {
      feed(bad());
      for (let i = 0; i < 5; i++) feed(good());
    }
    check(
      'the user heard the correction once, not once per phase flap',
      spoken.length === beforeTrouble + 1,
      spoken,
    );
    check('it was the settling instruction', spoken[spoken.length - 1] === 'Move into position.', spoken);

    // It really was flapping, otherwise the assertion above proves nothing.
    check('the gate never recovered during the flapping', engine.readinessPhase !== 'ready', engine.readinessPhase);
    check('and still no rep was counted', engine.reps === 0, engine.reps);
  });

  suite('voice: a settled pose is released and a later problem is announced again', () => {
    // The other half of the state rule: silence must end when the problem does.
    const spoken: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        spoken.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    let t = 0;
    const feed = (landmarks: LandmarkEventPayload[], presence: PosePresence = 'tracked') => {
      voice.onFrame(engine.handlePoseFrame(frame(landmarks, t, presence)));
      t += 100;
    };
    const good = () => pose(90, 90);
    const bad = () => pose(Number.NaN, Number.NaN);

    // Settling into position legitimately earns one instruction of its own.
    for (let i = 0; i < 14; i++) feed(good());
    check('the gate is ready before any trouble', engine.readinessPhase === 'ready', engine.readinessPhase);
    const afterSettling = spoken.length;
    check('settling was announced once', afterSettling === 1, spoken);

    // Problem one.
    for (let i = 0; i < 6; i++) feed(bad());
    check('the first problem was announced once', spoken.length === afterSettling + 1, spoken);

    // Genuine recovery: the gate is ready again, which is a real state change.
    for (let i = 0; i < 16; i++) feed(good());
    check('the gate recovered', engine.readinessPhase === 'ready', engine.readinessPhase);
    check('recovery was silent', spoken.length === afterSettling + 1, spoken);

    // Problem two, long after the first.
    for (let i = 0; i < 6; i++) feed(bad());
    check(
      'a later problem is announced again, exactly once',
      spoken.length === afterSettling + 2,
      spoken,
    );
  });

  suite('voice: a real rep through the real engine is announced once', () => {
    const spoken: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        spoken.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    // Let the gate settle, then perform two genuine left-leg reps, feeding the
    // controller every single frame exactly as the session screen does.
    let t = 0;
    const feed = (landmarks: LandmarkEventPayload[], presence: PosePresence = 'tracked') => {
      const result = engine.handlePoseFrame(frame(landmarks, t, presence));
      voice.onFrame(result);
      t += 100;
    };

    for (let i = 0; i < 14; i++) feed(pose(90, 90));
    check('gate is ready before the reps', engine.readinessPhase === 'ready', engine.readinessPhase);

    for (const _rep of [0, 1]) {
      for (const angle of [120, 150, 170, 170, 130, 110, 90, 90]) feed(pose(angle, 90));
    }
    check('engine counted both reps', engine.reps === 2, engine.reps);

    const repLines = spoken.filter((t2) => t2.includes('Rep '));
    check(
      'exactly one announcement per rep',
      JSON.stringify(repLines) === JSON.stringify(['Good. Rep one.', 'Good. Rep two.']),
      repLines,
    );
  });

  suite('voice: a lost frame mid-rep cannot announce anything', () => {
    const spoken: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        spoken.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    let t = 0;
    const feed = (landmarks: LandmarkEventPayload[], presence: PosePresence = 'tracked') => {
      const result = engine.handlePoseFrame(frame(landmarks, t, presence));
      voice.onFrame(result);
      t += 100;
    };

    for (let i = 0; i < 14; i++) feed(pose(90, 90));
    // Extend, then vanish mid-cycle, then come back and lower the leg.
    feed(pose(170, 90));
    feed(pose(170, 90));
    feed(pose(170, 90), 'lost');
    for (let i = 0; i < 14; i++) feed(pose(90, 90));

    check('no rep survived the loss', engine.reps === 0, engine.reps);
    check(
      'no rep was announced',
      spoken.every((line) => !line.includes('Rep ')),
      spoken,
    );
  });

  suite('voice: setup cue kind is the one the HUD shows', () => {
    // The screen and the speaker must not disagree: the setup HUD copy is spoken
    // from the same kind the engine emits pre-Start.
    check('setup kind is setup', setupFeedback().kind === 'setup', setupFeedback().kind);
    check('paused kind is paused', pausedFeedback().kind === 'paused', pausedFeedback().kind);
  });

  /* ------------------------------- form-correction policy additions ---- */

  suite('voice: every correct movement phase is silent on its own', () => {
    // Requirements: correct extending / extended / returning produce no speech.
    // The HUD is what carries the continuous instruction; the ear is not told
    // what to do while the user is already doing it.
    const { spoken, voice, clock } = rig();
    for (let i = 0; i < 20; i++) {
      voice.onFrame(RESTING);
      voice.onFrame(EXTENDING);
      voice.onFrame(HOLDING);
      voice.onFrame(RETURNING);
      clock.advance(120);
    }
    check('nothing at all is spoken during correct movement', spoken.length === 0, spoken);
  });

  suite('voice: a long alternating session is silent apart from the rep count', () => {
    // Requirement: correct consecutive repetitions produce no coaching speech.
    // Five reps through the REAL engine, feeding every frame to the controller.
    const lines: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        lines.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    let t = 0;
    const feed = (landmarks: LandmarkEventPayload[]) => {
      const result = engine.handlePoseFrame(frame(landmarks, t));
      // Only feed the controller once counting is actually enabled. The frames
      // before that legitimately earn a "Move into position." / "Hold still."
      // correction, and this suite is about what is said DURING the session.
      if (engine.readinessPhase === 'ready') voice.onFrame(result);
      t += 100;
    };
    for (let i = 0; i < 14; i++) feed(pose(90, 90));
    for (let r = 0; r < 5; r++) {
      for (const angle of [120, 150, 170, 170, 130, 110, 90, 90]) feed(pose(angle, 90));
      t += 1500;
    }

    check('five reps counted', engine.reps === 5, engine.reps);
    check(
      'only the five rep confirmations were spoken',
      JSON.stringify(lines) ===
        JSON.stringify([
          'Good. Rep one.',
          'Good. Rep two.',
          'Good. Rep three.',
          'Good. Rep four.',
          'Good. Rep five.',
        ]),
      lines,
    );
  });

  suite('voice: a rep counted twice is only ever announced once', () => {
    // Ties the aggregation fix to the speaker: the collapsed second sighting of
    // one physical movement must not produce a second "Good. Rep one."
    const lines: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        lines.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    let t = 0;
    // The RIGHT leg performs the rep; the LEFT leg's landmarks are placed on the
    // right leg's projected positions, which is what the model does to an
    // occluded limb in a side view. pose(left, right), so the mover is the
    // second argument.
    const aliased = (angle: number): LandmarkEventPayload[] => {
      const base = pose(90, angle);
      const nearAnkle = base.find((l) => l.name === 'RIGHT_ANKLE');
      const nearKnee = base.find((l) => l.name === 'RIGHT_KNEE');
      const nearHip = base.find((l) => l.name === 'RIGHT_HIP');
      if (!nearAnkle || !nearKnee || !nearHip) throw new Error('missing landmark');
      return [
        { ...nearHip, name: 'LEFT_HIP', x: nearHip.x + 0.002, y: nearHip.y + 0.003 },
        { ...nearKnee, name: 'LEFT_KNEE', x: nearKnee.x + 0.004, y: nearKnee.y + 0.006 },
        { ...nearAnkle, name: 'LEFT_ANKLE', x: nearAnkle.x + 0.004, y: nearAnkle.y + 0.006 },
        nearHip,
        nearKnee,
        nearAnkle,
      ];
    };
    const feed = (landmarks: LandmarkEventPayload[]) => {
      const result = engine.handlePoseFrame(frame(landmarks, t));
      if (engine.readinessPhase === 'ready') voice.onFrame(result);
      t += 100;
    };

    for (let i = 0; i < 14; i++) feed(aliased(90));
    for (const angle of [120, 150, 170, 170, 130, 110, 90, 90]) feed(aliased(angle));

    check('the single physical rep is counted once', engine.reps === 1, engine.reps);
    check(
      'and announced once',
      JSON.stringify(lines.filter((l) => l.includes('Rep '))) ===
        JSON.stringify(['Good. Rep one.']),
      lines,
    );
  });

  suite('voice: a rejected shallow movement is never praised', () => {
    // Requirement: if the rep is rejected, do not praise it. The leg settles just
    // under the bent threshold and only creeps to the extension threshold, so the
    // observed range is under minRangeDeg.
    const lines: string[] = [];
    const sink: SpeechSink = {
      speak(text) {
        lines.push(text);
      },
      stop() {},
    };
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const voice = new VoiceFeedbackController(sink);

    let t = 0;
    const feed = (angle: number) => {
      voice.onFrame(engine.handlePoseFrame(frame(pose(angle, 138), t)));
      t += 100;
    };
    for (let i = 0; i < 14; i++) feed(138);
    for (const angle of [138, 141, 160, 160, 141, 138, 138, 138]) feed(angle);

    check('the shallow cycle counted nothing', engine.reps === 0, engine.reps);
    check(
      'nothing was praised',
      lines.every((l) => !l.includes('Good')),
      lines,
    );
  });

  suite('voice: resume does not immediately narrate the movement', () => {
    // Requirement: resuming speaks the transition, then goes quiet again. The
    // user is mid-session, not being re-instructed.
    const { spoken, voice } = rig();
    voice.announceStart();
    voice.announcePause();
    voice.announceResume();
    const afterResume = spoken.length;
    check('resume was announced', spoken[spoken.length - 1].text === 'Resume.', spoken);

    for (let i = 0; i < 30; i++) {
      voice.onFrame(EXTENDING);
      voice.onFrame(HOLDING);
      voice.onFrame(RETURNING);
      voice.onFrame(RESTING);
    }
    check('nothing more is said after resuming', spoken.length === afterResume, spoken);
  });

  suite('voice: the completion tally does not cut off the sentence before it', () => {
    // Two utterances are emitted back to back. The first interrupts whatever was
    // in flight (correct); the second must not interrupt the first, or the user
    // hears a truncated "Session complete."
    const { spoken, stops, voice } = rig();
    voice.announceCompletion(8);
    const texts = spoken.map((s) => s.text);
    check(
      'both completion lines are emitted',
      JSON.stringify(texts) ===
        JSON.stringify(['Session complete.', 'You completed eight reps.']),
      texts,
    );
    check('the first line interrupts', spoken[0].interrupt === true, spoken[0]);
    check('the tally does not interrupt the first line', spoken[1].interrupt === false, spoken[1]);
    check('the speaker was stopped exactly once', stops.length === 1, stops);
  });

  suite('voice: no wording is invented beyond what the engine reports', () => {
    // Guards against "form correction" creeping into claims the pipeline cannot
    // support. Only these four problems are real engine facts.
    const { spoken, voice } = rig();
    for (const kind of ['position', 'positioning', 'stabilizing', 'setup'] as const) {
      voice.reset();
      voice.consider(kind);
    }
    const allowed = ['Move into the camera view.', 'Move into position.', 'Hold still.', 'Sit sideways to the camera.'];
    check('only real engine facts are ever spoken', spoken.every((s) => allowed.includes(s.text)), spoken);
    check('four distinct corrections exist', spoken.length === 4, spoken);
  });
}

/* -------------------------------------------------- synthetic pose data -- */

type XY = { x: number; y: number };

const SIDE_NAMES: Record<Side, { hip: PoseLandmarkName; knee: PoseLandmarkName; ankle: PoseLandmarkName }> = {
  left: { hip: 'LEFT_HIP', knee: 'LEFT_KNEE', ankle: 'LEFT_ANKLE' },
  right: { hip: 'RIGHT_HIP', knee: 'RIGHT_KNEE', ankle: 'RIGHT_ANKLE' },
};
const SIDE_GEOMETRY: Record<Side, { hip: XY; knee: XY }> = {
  left: { hip: { x: 0.46, y: 0.3 }, knee: { x: 0.46, y: 0.5 } },
  right: { hip: { x: 0.54, y: 0.3 }, knee: { x: 0.54, y: 0.5 } },
};

function ankleFor(hip: XY, knee: XY, angleDeg: number): XY {
  const hdir = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const rad = hdir - (angleDeg * Math.PI) / 180;
  return { x: knee.x + Math.cos(rad) * 0.28, y: knee.y + Math.sin(rad) * 0.28 };
}

function pose(
  leftAngle: number,
  rightAngle: number,
  opts: { visibility?: number } = {},
): LandmarkEventPayload[] {
  const visibility = opts.visibility ?? 1;
  const landmarks: LandmarkEventPayload[] = [];
  for (const side of ['left', 'right'] as const) {
    const { hip, knee } = SIDE_GEOMETRY[side];
    const names = SIDE_NAMES[side];
    const ankle = ankleFor(hip, knee, side === 'left' ? leftAngle : rightAngle);
    for (const [name, point] of [[names.hip, hip], [names.knee, knee], [names.ankle, ankle]] as const) {
      landmarks.push({ name, x: point.x, y: point.y, z: 0, visibility });
    }
  }
  return landmarks;
}

function frame(
  landmarks: LandmarkEventPayload[],
  timestampMs: number,
  presence: PosePresence = 'tracked',
): { nativeEvent: PoseFrameEventPayload } {
  return { nativeEvent: { timestampMs, presence, landmarks } as PoseFrameEventPayload };
}
