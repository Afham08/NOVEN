import { defineGuidedActivity, type GuidedActivity } from './types';

/**
 * Meditation sessions: a timer, a few stages, and nothing else.
 *
 * There is no audio, because NOVEN has none, and there is no breathing counter,
 * because NOVEN cannot see the user and would be guessing. What it does have is a
 * clock, a sequence of stages that move at a sensible rate, and words telling
 * the person where their attention is supposed to be. That is enough for a
 * session to be worth starting and worth recording.
 *
 * A few opening stages also carry `cameraConfigId`, which turns the camera on for
 * that stage alone so the settling-in can be helped along. What the camera is
 * allowed to say there is set by `postureExpectation` and nothing more: it can
 * tell somebody they are not in frame, and on the stages that ask to be seated it
 * can tell them their back is not upright. It says nothing about calm, focus,
 * breathing, or whether they are meditating, because nothing in the frame
 * supports any of those. See `meditation-guidance.ts`.
 *
 * Every session is a multiple of a short first stage, so "one minute" really is
 * one minute and not a one-minute session with a long sit in the middle. The
 * longest is ten minutes, because the audience is older and a beginner's first
 * attempt at anything should be easy to finish.
 */
export const meditationSessions: readonly GuidedActivity[] = [
  defineGuidedActivity({
    id: 'one-minute-calm',
    kind: 'meditation',
    name: 'One Minute of Calm',
    summary: 'A single minute, for a first try or a short break',
    progressNoun: 'stages',
    steps: [
      {
        seconds: 10,
        title: 'Settle',
        guidance: 'Sit comfortably. Let your hands rest, and let your shoulders drop.',
        cameraConfigId: 'meditation-posture',
        postureExpectation: 'seated-upright',
      },
      {
        seconds: 30,
        title: 'Breathe',
        guidance: 'Breathe in slowly through your nose, and out slowly through your mouth.',
      },
      {
        seconds: 20,
        title: 'Rest',
        guidance: 'Stop trying to do anything in particular. Just sit until this ends.',
      },
    ],
    safetyNote:
      'Open your eyes and sit normally at any point. If you feel unwell, stop and take a break.',
  }),

  defineGuidedActivity({
    id: 'five-minute-breathing',
    kind: 'meditation',
    name: 'Five Minute Breathing',
    summary: 'Five minutes focused on the breath',
    progressNoun: 'stages',
    steps: [
      {
        seconds: 20,
        title: 'Settle',
        guidance: 'Sit comfortably and close your eyes, or soften your gaze.',
        cameraConfigId: 'meditation-posture',
        postureExpectation: 'seated-upright',
      },
      {
        seconds: 20,
        title: 'Notice',
        guidance: 'Notice the weight of your body in the chair, and your feet on the floor.',
      },
      {
        seconds: 120,
        title: 'Breathe',
        guidance:
          'Breathe in slowly, and out slowly. If your mind wanders, that is fine, and noticing it is the practice.',
      },
      {
        seconds: 60,
        title: 'Widen Out',
        guidance: 'Bring your attention back to the whole room, including the sounds around you.',
      },
      {
        seconds: 80,
        title: 'Rest',
        guidance: 'Stay still. Let the last moments pass without trying to hold onto them.',
      },
    ],
    safetyNote:
      'Keep this seated and somewhere safe. Stop if you feel light-headed, and return to normal breathing straight away.',
  }),

  defineGuidedActivity({
    id: 'ten-minute-body-scan',
    kind: 'meditation',
    name: 'Ten Minute Body Scan',
    summary: 'Ten minutes of attention, from your feet upwards',
    progressNoun: 'stages',
    steps: [
      {
        seconds: 30,
        title: 'Settle',
        guidance: 'Lie down or sit back, whichever is more comfortable. Loosen anything tight.',
        cameraConfigId: 'meditation-posture',
        // This step invites the person to lie down, so the camera may confirm
        // they are in frame and must not comment on how upright they are. See
        // `MeditationPostureExpectation`.
        postureExpectation: 'in-frame',
      },
      {
        seconds: 150,
        title: 'Feet and Legs',
        guidance: 'Feel your feet against the floor, then move your attention slowly up your legs.',
      },
      {
        seconds: 150,
        title: 'Body and Stomach',
        guidance: 'Notice your back, your stomach, and your breathing, without changing any of them.',
      },
      {
        seconds: 150,
        title: 'Hands and Arms',
        guidance: 'Feel your hands, then your arms and shoulders. Let them be heavy.',
      },
      {
        seconds: 120,
        title: 'Head and Face',
        guidance: 'Relax your jaw and your forehead. Unclench your teeth.',
      },
    ],
    safetyNote:
      'Lying down on your back is fine, but not on a bed if you would be unable to turn over. Stop at any point.',
  }),
];
