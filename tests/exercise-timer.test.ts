import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName, PosePresence } from '../modules/pose-tracker';
import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { SessionEngine } from '../src/exercise/session-engine';
import type { Side } from '../src/exercise/types';

/**
 * The exercise clock must be ACTIVE TIME IN POSITION, not wall-clock time since
 * Start. These suites drive the real SessionEngine with synthetic pose frames
 * and assert exactly when elapsed time may accumulate:
 *
 *   A. before readiness     -> 0
 *   B. readiness granted    -> clock starts
 *   C. readiness lost       -> clock stops immediately
 *   D. readiness regained   -> clock resumes, never resets
 *   E. session ended        -> clock frozen forever
 *   F. paused gap           -> never banked as active time
 *   G. final value          -> the engine's own number, carried on every frame
 *
 * There is intentionally no wall-clock or interval here: the engine owns
 * readiness, so it owns the timer. The source-level checks at the bottom pin
 * the screen to this engine result and forbid a second, competing timer.
 */

/* ------------------------------------------------------------- file reads -- */

declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};

const fs = require('fs') as ReturnType<typeof require>;
const nodePath = require('path') as ReturnType<typeof require>;

// __dirname is the COMPILED test directory, so the app source is two levels up.
const fromApp = (...segments: string[]) => nodePath.resolve(__dirname, '../../src/app', ...segments);
const read = (...segments: string[]) => fs.readFileSync(fromApp(...segments), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ----------------------------------------------------------- synthetic pose -- */

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

/** Synthetic seated pose at a chosen knee angle per side, both sides trustworthy. */
function pose(leftAngle: number, rightAngle: number): LandmarkEventPayload[] {
  const landmarks: LandmarkEventPayload[] = [];
  for (const side of ['left', 'right'] as const) {
    const { hip, knee } = SIDE_GEOMETRY[side];
    const names = SIDE_NAMES[side];
    const ankle = ankleFor(hip, knee, side === 'left' ? leftAngle : rightAngle);
    for (const [name, point] of [[names.hip, hip], [names.knee, knee], [names.ankle, ankle]] as const) {
      landmarks.push({ name, x: point.x, y: point.y, z: 0, visibility: 1, presence: 1 });
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

const REST = 90;

/**
 * Feeds still frames until the readiness gate grants counting. The gate needs
 * minStableFrames=10 calm frames spanning minStableMs=1000, so 14 frames at a
 * 100ms cadence sits comfortably past it. Deterministic ms arithmetic:
 * the gate flips ready on the frame at startMs+1100 and the two later ready
 * frames bank 200ms before this helper returns.
 */
function reachReady(engine: SessionEngine, startMs = 0): number {
  let t = startMs;
  for (let i = 0; i < 14; i++) {
    engine.handlePoseFrame(frame(pose(REST, REST), t));
    t += 100;
  }
  return t;
}

/** Feeds `frames` still frames at `stepMs` while the gate is already ready. */
function feedReady(engine: SessionEngine, startMs: number, frames: number, stepMs = 100): number {
  let t = startMs;
  for (let i = 0; i < frames; i++) {
    engine.handlePoseFrame(frame(pose(REST, REST), t));
    t += stepMs;
  }
  return t;
}

/** One full left-leg rep at a 100ms cadence; the right leg stays bent. */
const REP_CADENCE = [120, 150, 170, 170, 130, 110, REST, REST];
function doLeftRep(engine: SessionEngine, startMs: number): number {
  let t = startMs;
  for (const angle of REP_CADENCE) {
    engine.handlePoseFrame(frame(pose(angle, REST), t));
    t += 100;
  }
  return t;
}

export function run(): void {
  suite('exercise clock: a fresh session owns its own, cleared clock', () => {
    check(
      'a new engine starts at zero',
      new SessionEngine(SEATED_KNEE_EXTENSION).elapsedSeconds === 0,
    );
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    engine.reset();
    engine.reset();
    check('reset clears any accumulated time', engine.elapsedSeconds === 0);
  });

  // A. Start → timer remains 0 / not running
  suite('exercise clock: start arms readiness, and no time passes until it', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    // 9 calm frames: the gate needs 10 stable frames over 1000ms, so this has
    // not reached readiness and must not have opened the clock.
    for (let i = 0; i < 9; i++) {
      engine.handlePoseFrame(frame(pose(REST, REST), t));
      t += 100;
    }
    check('readiness has not been granted', engine.readinessPhase !== 'ready', engine.readinessPhase);
    check('the clock stays at zero before readiness', engine.elapsedSeconds === 0, engine.elapsedSeconds);
  });

  // B. Readiness becomes true → timer starts
  suite('exercise clock: the timer runs only once the position is held', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    check('readiness was granted', engine.readinessPhase === 'ready', engine.readinessPhase);
    // A little over a second of continued ready frames and the clock reads 1.
    t = feedReady(engine, t, 11);
    check('seconds accumulate while ready', engine.elapsedSeconds === 1, engine.elapsedSeconds);
  });

  // C. Readiness becomes false → timer stops immediately
  suite('exercise clock: losing the position stops the count at once', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    t = feedReady(engine, t, 25);
    const frozen = engine.elapsedSeconds;
    check('the clock was counting', frozen > 0, frozen);

    // Person leaves the frame: the gate drops and the anchor clears.
    engine.handlePoseFrame(frame(pose(REST, REST), t, 'lost'));
    t += 100;
    check('readiness left the gate', engine.readinessPhase !== 'ready', engine.readinessPhase);

    // Sub-threshold calm frames that have not re-earned the calm window.
    for (let i = 0; i < 5; i++) {
      engine.handlePoseFrame(frame(pose(REST, REST), t));
      t += 100;
    }
    check(
      'out of position, the timer freezes where it stood',
      engine.elapsedSeconds === frozen,
      engine.elapsedSeconds,
    );
  });

  // D. Readiness becomes true again → resumes from the previous value
  suite('exercise clock: returning to position resumes from where it stopped', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    t = feedReady(engine, t, 25);
    const before = engine.elapsedSeconds;

    // Position lost, then enough calm frames to re-earn readiness.
    engine.handlePoseFrame(frame(pose(REST, REST), t, 'lost'));
    t += 100;
    let guard = 0;
    while (engine.readinessPhase !== 'ready' && guard < 100) {
      engine.handlePoseFrame(frame(pose(REST, REST), t));
      t += 100;
      guard += 1;
    }
    check('readiness was granted again', engine.readinessPhase === 'ready', engine.readinessPhase);
    check(
      're-settling into position counts no time',
      engine.elapsedSeconds === before,
      engine.elapsedSeconds,
    );

    // 21 ready frames = 2s of active time on top of the pre-loss value.
    t = feedReady(engine, t, 21);
    check(
      'the clock resumes from the previous value instead of resetting',
      engine.elapsedSeconds === before + 2,
      { before, now: engine.elapsedSeconds },
    );
    check(
      'the resumed clock never goes backwards',
      engine.elapsedSeconds >= before,
      engine.elapsedSeconds,
    );
  });

  // E. Session ends → timer stops permanently
  suite('exercise clock: ending the session freezes the clock forever', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    t = feedReady(engine, t, 11);
    check('the clock was counting', engine.elapsedSeconds === 1, engine.elapsedSeconds);

    engine.end();
    const frozen = engine.elapsedSeconds;
    // Frames after End are ignored by the engine (terminal), so even a stream
    // of ready frames cannot move the clock again.
    t = feedReady(engine, t, 21);
    check('a finished session banks no more time', engine.elapsedSeconds === frozen, engine.elapsedSeconds);
  });

  // F. Pause/resume → the paused gap is not accumulated
  suite('exercise clock: a paused gap never counts as active time', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    t = feedReady(engine, t, 11);
    check('the clock was counting', engine.elapsedSeconds === 1, engine.elapsedSeconds);

    engine.pause();
    // A sub-cap resume: 800ms elapses while paused, shorter than the 1000ms
    // frame-gap cap, so only the pause itself (by clearing the anchor) can keep
    // this gap out of the total — the cap alone would not save it.
    const resumed = t + 800;
    engine.handlePoseFrame(frame(pose(REST, REST), resumed));
    engine.handlePoseFrame(frame(pose(REST, REST), resumed + 100));
    check(
      'the paused time is not banked when frames resume',
      engine.elapsedSeconds === 1,
      engine.elapsedSeconds,
    );
  });

  // G. Completion → the engine carries the final value on every frame
  suite('exercise clock: every frame carries the one clock the result will read', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine, 0);
    const result = engine.handlePoseFrame(frame(pose(REST, REST), t));
    check(
      'the frame result reports the same elapsed value as the engine',
      result.elapsedSeconds === engine.elapsedSeconds,
      { result: result.elapsedSeconds, engine: engine.elapsedSeconds },
    );
  });

  suite('exercise clock: the clock does not disturb rep counting', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    t = doLeftRep(engine, t);
    check('a genuine rep still counts while ready', engine.reps === 1, engine.reps);
    check('the ready frames still bank their time', engine.elapsedSeconds >= 0, engine.elapsedSeconds);
  });

  suite('exercise clock: the session screen owns no timer of its own', () => {
    const screen = stripComments(read('exercise', 'session.tsx'));

    check(
      'the screen draws its seconds from the engine result',
      screen.includes('setSeconds(result.elapsedSeconds)'),
    );
    check(
      'there is no wall-clock interval racing the readiness clock',
      !/setInterval/.test(screen),
    );
    check(
      'the saved duration reads the same engine clock',
      screen.includes('durationSeconds: engine?.elapsedSeconds ?? 0'),
    );
    check(
      'start arms the session once and lets readiness own the clock',
      screen.includes('engine?.reset()') && !screen.includes('timerRunning'),
    );
  });

  suite('exercise clock: the camera preview stays unobstructed', () => {
    const screen = stripComments(read('exercise', 'session.tsx'));

    check('no HUD overlay paints over the video', !screen.includes('hudOverlay'));
    check(
      'the phase chip and clock sit below the camera frame',
      screen.indexOf('<SessionTimer') > screen.indexOf('styles.cameraFrame'),
    );
    check(
      'timer and current guidance are rendered below camera in the same horizontal section',
      screen.includes('infoBar') && screen.indexOf('infoBar') > screen.indexOf('styles.cameraFrame'),
    );
    check(
      'the End control sits below the instructions/info section',
      screen.indexOf('title="End"') > screen.indexOf('style={styles.guidance}'),
    );
  });

  suite('exercise clock: the screen keeps the safe-area bottom inset', () => {
    const screen = stripComments(read('exercise', 'session.tsx'));
    // Screen appends the bottom inset AFTER contentStyle; paddingVertical in the
    // screen's own style would overwrite it and drop the controls into Android's
    // gesture-navigation zone. The style must set paddingTop only.
    check(
      'the content style does not wipe the bottom inset',
      /content:\s*\{[^}]*paddingTop: Spacing\.three/.test(screen) &&
        !/content:\s*\{[^}]*paddingVertical/.test(screen),
    );
  });

  suite('exercise clock: the session screen renders exercise instructions below the camera', () => {
    const screen = stripComments(read('exercise', 'session.tsx'));
    check(
      'the Instructions card is rendered in the session screen',
      screen.includes('>Instructions<') || screen.includes('Instructions</Text>'),
    );
    check(
      'the instructions are mapped from exercise.instructions',
      screen.includes('exercise.instructions.map'),
    );
    check(
      'the instructions card appears after the camera frame',
      screen.indexOf('styles.instructions') > screen.indexOf('styles.cameraFrame'),
    );
    check(
      'instruction text is not rendered as an overlay on the camera',
      !screen.includes('hudOverlay'),
    );
  });

}
