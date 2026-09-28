import { defineGuidedActivity, type GuidedActivity } from './types';

/**
 * Yoga routines: a short sequence of positions, each held for a stated time.
 *
 * Every position is one an older person can hold while sitting in a stable
 * chair, or standing beside one, and every routine has a settle step at the front
 * and a rest step at the back. The rests are not decoration: a person who has
 * been told to stretch and then never told to stop will keep going.
 *
 * The wording is written as an instruction to one person doing the movement
 * ("raise your right arm"), not as a description of yoga, and it never claims
 * what a routine will do for anyone. The app is guiding a movement, not making a
 * promise about a body.
 */
export const yogaRoutines: readonly GuidedActivity[] = [
  defineGuidedActivity({
    id: 'seated-morning-stretch',
    kind: 'yoga',
    name: 'Seated Morning Stretch',
    summary: 'Four minutes of easy movement, sitting in a chair',
    progressNoun: 'poses',
    steps: [
      {
        seconds: 30,
        title: 'Settle',
        guidance: 'Sit tall with both feet flat on the floor. Let your hands rest on your thighs.',
      },
      {
        seconds: 40,
        title: 'Look Up',
        guidance: 'Lift your chin a little and look gently upwards. Breathe normally.',
        cameraConfigId: 'yoga-neck-extension',
      },
      {
        seconds: 40,
        title: 'Shoulder Rolls',
        guidance: 'Lift both shoulders towards your ears, roll them back, and let them drop.',
      },
      {
        seconds: 50,
        title: 'Side Bend',
        guidance: 'Hold the side of your chair. Lean slowly towards that hand, then come back up.',
        cameraConfigId: 'yoga-trunk-lateral-flexion',
      },
      {
        seconds: 50,
        title: 'Forward Fold',
        guidance: 'Slide your hands down your legs as you lean forward. Let your head hang heavy.',
        cameraConfigId: 'yoga-trunk-forward-flexion',
      },
      {
        seconds: 30,
        title: 'Rest',
        guidance: 'Sit tall again and shake your arms out. Breathe slowly a few times.',
      },
    ],
    safetyNote:
      'Move within what feels comfortable, and stay in your chair for the whole routine. Stop if you feel pain or dizziness.',
  }),

  defineGuidedActivity({
    id: 'neck-and-shoulders',
    kind: 'yoga',
    name: 'Neck and Shoulders',
    summary: 'Four minutes of gentle movement for a stiff neck and shoulders',
    progressNoun: 'poses',
    steps: [
      {
        seconds: 30,
        title: 'Settle',
        guidance: 'Sit tall and let your shoulders drop away from your ears.',
      },
      {
        seconds: 45,
        title: 'Turn Your Head',
        guidance: 'Turn your head slowly to look over one shoulder, then to the other.',
      },
      {
        seconds: 45,
        title: 'Tilt Your Ear',
        guidance: 'Tilt your head gently towards one shoulder. Hold the other side the same way.',
        cameraConfigId: 'yoga-neck-extension',
      },
      {
        seconds: 45,
        title: 'Shoulder Rolls',
        guidance: 'Roll both shoulders backwards slowly, then forwards slowly.',
      },
      {
        seconds: 45,
        title: 'Open Your Arms',
        guidance: 'Reach both arms forward and draw your shoulders back. Breathe out as you do.',
        cameraConfigId: 'yoga-shoulder-flexion',
      },
      {
        seconds: 30,
        title: 'Rest',
        guidance: 'Let your arms fall to your sides and breathe slowly a few times.',
      },
    ],
    safetyNote:
      'Keep every movement small and slow. If your neck already aches, make the turn smaller rather than skipping the pause.',
  }),

  defineGuidedActivity({
    id: 'chair-yoga-flow',
    kind: 'yoga',
    name: 'Chair Yoga Flow',
    summary: 'Five minutes moving from your hands to your feet',
    progressNoun: 'poses',
    steps: [
      {
        seconds: 30,
        title: 'Settle',
        guidance: 'Sit towards the front of a stable chair, feet flat and a little back.',
      },
      {
        seconds: 45,
        title: 'Hands to Feet',
        guidance: 'Slide both hands down your legs towards your feet. Sit back up without rushing.',
        cameraConfigId: 'yoga-trunk-forward-flexion',
      },
      {
        seconds: 45,
        title: 'Reach Up',
        guidance: 'Reach both arms up above your head, then lower them slowly.',
        cameraConfigId: 'yoga-shoulder-flexion',
      },
      {
        seconds: 45,
        title: 'Turn and Twist',
        guidance: 'Sit tall and turn your upper body gently to one side, then the other.',
      },
      {
        seconds: 45,
        title: 'Stand and Sit',
        guidance: 'Stand up in front of your chair, then lower yourself back down. Hold the chair if you need to.',
        cameraConfigId: 'sit-to-stand',
      },
      {
        seconds: 45,
        title: 'March on the Spot',
        guidance: 'While seated, lift one foot a little off the floor, then the other.',
        cameraConfigId: 'yoga-seated-hip-flexion',
      },
      {
        seconds: 45,
        title: 'Rest',
        guidance: 'Sit back, let your hands rest on your thighs, and breathe slowly.',
      },
    ],
    safetyNote:
      'Use a sturdy chair without wheels and keep it against a wall. Stand only if it feels safe, and sit back down straight away if you feel unsteady.',
  }),
];
