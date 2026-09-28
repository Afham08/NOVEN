import { defineGuidedActivity, type GuidedActivity } from './types';

/**
 * Wellness activities: small, specific things to do, that are finished in under
 * two minutes.
 *
 * This is the part of the app that is deliberately least impressive. The
 * exercise list is measured with a camera, the yoga is a sequence, the
 * meditation is a timer, and this is a checklist — "lift your heels 15 times,
 * mark it done". Small and finishable is the whole point, and it is why these
 * are the only activities with a per-day status: ticking one off today is a
 * different promise from finishing a routine, and it is kept separate.
 *
 * A note on what is NOT here: none of these are tracked by the camera. The
 * exercise app can count a repetition when it can see a joint move, and it
 * cannot count one of these without pretending to. So each is guided by its
 * timer and recorded as done, and nothing here reports a count that was not
 * observed.
 */
export const wellnessActivities: readonly GuidedActivity[] = [
  defineGuidedActivity({
    id: 'heel-raises',
    kind: 'wellness',
    name: 'Heel Raises',
    summary: 'Lift your heels while you are sitting, then mark it done',
    progressNoun: 'steps',
    steps: [
      {
        seconds: 15,
        title: 'Get Ready',
        guidance: 'Sit tall with both feet flat on the floor. Hold the sides of your chair.',
      },
      {
        seconds: 30,
        title: 'Lift and Lower',
        guidance: 'Lift both heels off the floor, hold for a moment, then lower them slowly.',
      },
      {
        seconds: 30,
        title: 'Repeat',
        guidance: 'Keep going at a steady pace, lifting and lowering both heels together.',
      },
      {
        seconds: 15,
        title: 'Done',
        guidance: 'Put both heels down and give your feet a moment before you stand up.',
      },
    ],
    safetyNote:
      'Stay seated for all of it. Keep hold of the chair, and stop if your feet or ankles start to ache.',
  }),

  defineGuidedActivity({
    id: 'ankle-pumps',
    kind: 'wellness',
    name: 'Ankle Pumps',
    summary: 'Point your feet down and draw them back, sitting down',
    progressNoun: 'steps',
    steps: [
      {
        seconds: 15,
        title: 'Get Ready',
        guidance: 'Sit with your feet a little off the floor, so your ankles are free to move.',
      },
      {
        seconds: 25,
        title: 'Point Down',
        guidance: 'Point your toes down as far as they will go, without forcing them.',
      },
      {
        seconds: 25,
        title: 'Draw Back',
        guidance: 'Now draw your toes back towards your shins, as far as is comfortable.',
      },
      {
        seconds: 25,
        title: 'Keep Going',
        guidance: 'Carry on alternating, one movement at a time, at a calm pace.',
      },
      {
        seconds: 10,
        title: 'Done',
        guidance: 'Rest your feet flat on the floor and shake your legs out gently.',
      },
    ],
    safetyNote:
      'Small movements are enough. Do not push through any pain in your ankle, and keep your leg supported by the chair.',
  }),

  defineGuidedActivity({
    id: 'posture-reset',
    kind: 'wellness',
    name: 'Posture Reset',
    summary: 'Straighten up, then mark it done',
    progressNoun: 'steps',
    steps: [
      {
        seconds: 15,
        title: 'Get Ready',
        guidance: 'Notice how you are sitting right now, without trying to change it.',
      },
      {
        seconds: 20,
        title: 'Feet and Hips',
        guidance: 'Put both feet flat on the floor and let your weight sit evenly on both hips.',
      },
      {
        seconds: 20,
        title: 'Lengthen Your Spine',
        guidance: 'Imagine the top of your head reaching gently upwards. Do not lift your chin.',
      },
      {
        seconds: 20,
        title: 'Drop Your Shoulders',
        guidance: 'Let your shoulders fall down and back, away from your ears.',
      },
      {
        seconds: 15,
        title: 'Hold It',
        guidance: 'Stay like this and breathe normally, feeling where your body meets the chair.',
      },
    ],
    safetyNote:
      'This is about position, not about how straight you can sit. Stop if holding the position causes any discomfort.',
  }),

  defineGuidedActivity({
    id: 'rest-your-eyes',
    kind: 'wellness',
    name: 'Rest Your Eyes',
    summary: 'Look into the distance and blink, then mark it done',
    progressNoun: 'steps',
    steps: [
      {
        seconds: 15,
        title: 'Look Away',
        guidance: 'Look up from the screen and find something across the room to look at.',
      },
      {
        seconds: 20,
        title: 'Blink Slowly',
        guidance: 'Blink slowly and fully, a few times, as if there were something to clear.',
      },
      {
        seconds: 20,
        title: 'Look Further',
        guidance: 'Hold your gaze on the far object and let your eyes rest there.',
      },
      {
        seconds: 15,
        title: 'Come Back',
        guidance: 'Look back at whatever you were doing, and carry on at your usual pace.',
      },
    ],
    safetyNote:
      'If your eyes are painful or your vision suddenly changes, stop and speak to someone about it rather than continuing.',
  }),
];
