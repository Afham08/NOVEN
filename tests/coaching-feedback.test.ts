import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { movementWording, phaseFeedback, type FeedbackCue } from '../src/exercise/feedback';
import { guidedPoseTrackedConfigs } from '../src/exercise/pose-configs';
import { allGuidedActivities } from '../src/activities/catalog';
import type { RepPhase } from '../src/exercise/types';

/*
 * The live coaching cue used to say "Extend your knee", "Keep it straight" and
 * "Return slowly" for every camera session in the app, whatever was moving.
 *
 * That was correct for exactly one of the movements NOVEN offers. A person doing
 * a neck stretch in a guided yoga routine was told to straighten their leg,
 * live, while the camera was watching them. Nothing crashed and no test failed,
 * because the cue was internally consistent and only the body part in it was
 * wrong.
 *
 * A phase alone cannot say which body part is moving, so these tests pin the
 * property that actually matters: the knee wording belongs to the knee movement,
 * every other movement gets wording of its own, and a movement nobody has
 * described gets safe generic wording rather than someone else's instructions.
 *
 * The ids come from the real registries, so adding a camera movement without
 * describing it fails here instead of inheriting the previous wording.
 */

const KNEE = SEATED_KNEE_EXTENSION.id;

const PHASES: readonly RepPhase[] = ['rest', 'extending', 'extended', 'returning'];

/** The three cues that used to be said about a knee regardless of the movement. */
const KNEE_PHRASES = ['Extend your knee', 'Keep it straight', 'Return slowly'];

function cueText(phase: RepPhase, movementId?: string): string {
  return phaseFeedback(phase, false, movementId).text;
}

/** Every camera step the guided catalogue can actually put a camera on. */
function guidedCameraStepIds(): string[] {
  const ids: string[] = [];
  for (const activity of allGuidedActivities) {
    for (const step of activity.steps) {
      if (step.cameraConfigId) ids.push(step.cameraConfigId);
    }
  }
  return ids;
}

export function run(): void {
  suite('coaching: the knee movement keeps its own coaching', () => {
    check('extending says to extend the knee', cueText('extending', KNEE) === 'Extend your knee');
    check('extended says to keep it straight', cueText('extended', KNEE) === 'Keep it straight');
    check('returning says to return slowly', cueText('returning', KNEE) === 'Return slowly');

    // The knee movement is the only one entitled to the knee words.
    for (const phrase of KNEE_PHRASES) {
      check(
        `only the knee movement says "${phrase}"`,
        movementWording(KNEE).extend === 'Extend your knee' ||
          movementWording(KNEE).hold === 'Keep it straight' ||
          movementWording(KNEE).return === 'Return slowly',
        phrase,
      );
    }
  });

  suite('coaching: no other movement is told about its knee', () => {
    const otherIds = [
      ...new Set([
        ...guidedPoseTrackedConfigs.map((config) => config.id),
        ...guidedCameraStepIds(),
      ]),
    ].filter((id) => id !== KNEE);

    check('there are other camera movements to check', otherIds.length > 0, otherIds);

    for (const id of otherIds) {
      for (const phase of PHASES) {
        const text = cueText(phase, id);
        check(
          `${id} / ${phase} does not use knee coaching`,
          !KNEE_PHRASES.includes(text),
          { id, phase, text },
        );
      }
    }
  });

  suite('coaching: an unidentified movement gets safe generic wording', () => {
    for (const id of [undefined, '', 'a-movement-nobody-described'] as const) {
      for (const phase of ['extending', 'extended', 'returning'] as const) {
        const text = cueText(phase, id);
        check(`no knee coaching for ${String(id)}`, !KNEE_PHRASES.includes(text), text);
      }
    }

    check(
      'an unknown movement reads the same as no movement at all',
      movementWording('a-movement-nobody-described').extend === movementWording().extend,
    );
  });

  suite('coaching: every cue is non-empty and short enough to read at a glance', () => {
    for (const id of [KNEE, ...guidedPoseTrackedConfigs.map((config) => config.id), undefined]) {
      for (const phase of PHASES) {
        const cue: FeedbackCue = phaseFeedback(phase, false, id);
        check(`${String(id)} / ${phase} has text`, cue.text.trim().length > 0, cue);
        check(`${String(id)} / ${phase} is one or two short sentences`, cue.text.length <= 24, cue.text);
        check(`${String(id)} / ${phase} has a tone`, cue.tone.length > 0, cue);
        check(`${String(id)} / ${phase} has a kind`, cue.kind.length > 0, cue);
      }
    }
  });

  suite('coaching: wording describes the movement without prescribing anything', () => {
    const clinical = [
      'pain',
      'injury',
      'injur',
      'diagnos',
      'treat',
      'therapy',
      'rehab',
      'shoulder impingement',
      'safe for you',
      'you must',
      'always',
      'never',
      'correct posture is',
      'consult',
      'doctor',
    ];

    for (const config of [...guidedPoseTrackedConfigs, SEATED_KNEE_EXTENSION]) {
      for (const phase of ['extending', 'extended', 'returning'] as const) {
        const text = cueText(phase, config.id);
        const lowered = text.toLowerCase();
        for (const word of clinical) {
          check(`${config.id} / ${phase} does not advise (${word})`, !lowered.includes(word), text);
        }
      }
    }
  });

  suite('coaching: the phase still decides the kind, not the wording', () => {
    // The voice layer reacts to `kind`, so moving the wording must not have
    // changed what the speaker is told is happening.
    for (const id of [KNEE, 'yoga-neck-extension', undefined]) {
      check(`${String(id)}: rest is ready`, phaseFeedback('rest', false, id).kind === 'ready');
      check(`${String(id)}: extending is extend`, phaseFeedback('extending', false, id).kind === 'extend');
      check(`${String(id)}: extended is hold`, phaseFeedback('extended', false, id).kind === 'hold');
      check(`${String(id)}: returning is return`, phaseFeedback('returning', false, id).kind === 'return');
      check(`${String(id)}: a counted rep is good`, phaseFeedback('rest', true, id).kind === 'good');
    }

    // Praise is shared by every movement and must not be movement-specific.
    for (const id of [KNEE, 'yoga-neck-extension', 'sit-to-stand', undefined]) {
      check(`${String(id)}: praise is the same words`, cueText('rest', id) === 'Ready');
      check(
        `${String(id)}: a completed rep praises identically`,
        phaseFeedback('rest', true, id).text === 'Good movement',
      );
    }
  });

  suite('coaching: tones are unchanged, so the HUD colouring still reads correctly', () => {
    for (const id of [KNEE, 'yoga-trunk-forward-flexion', undefined]) {
      check(`${String(id)}: rest tone`, phaseFeedback('rest', false, id).tone === 'ready');
      check(`${String(id)}: extending tone`, phaseFeedback('extending', false, id).tone === 'accent');
      check(`${String(id)}: extended tone`, phaseFeedback('extended', false, id).tone === 'sage');
      check(`${String(id)}: returning tone`, phaseFeedback('returning', false, id).tone === 'accent');
      check(`${String(id)}: praise tone`, phaseFeedback('rest', true, id).tone === 'sage');
    }
  });
}
