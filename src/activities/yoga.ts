import { defineGuidedActivity, type GuidedActivity } from './types';
import { YOGA_POSE_RULES } from './yoga-poses';

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

  /*
   * The first routine made of POSE STEPS rather than movement steps.
   *
   * The three above are counted repetitions and can be done sitting down. These
   * three poses are held still, and the camera is checking the shape rather than
   * counting anything - which is why each step here carries a `poseRuleId` and not
   * a `cameraConfigId`. Nothing about the existing routines changes; this is a
   * fourth one alongside them.
   *
   * Each pose step's `guidance` is the RULE'S OWN sentence, taken straight from
   * `YOGA_POSE_RULES` rather than retyped. Two poses here have to be done from a
   * particular direction for the camera to measure them honestly, and that
   * instruction lives with the rule that depends on it. A copy in this file would be
   * free to drift away from the rule without anything failing - which would leave
   * the person being judged from an angle nobody told them about.
   *
   * `seconds` on a pose step is deliberately LONGER than the pose's own hold. The
   * hold only starts once the shape has been steady for a moment, and it restarts
   * from zero if the pose is broken, so a step whose clock equalled the hold would
   * run out while the person was still finding the position. The extra time is
   * room to settle in, not a second hold.
   *
   * AND THESE ARE STANDING POSES, which is a real change from the seated
   * routines above. The summary and the safety note both say so plainly rather
   * than letting a person who has only ever done the seated routines find out from
   * the middle of a squat.
   */
  defineGuidedActivity({
    id: 'standing-pose-holds',
    kind: 'yoga',
    name: 'Standing Pose Holds',
    summary: 'Three standing poses held still, with the camera watching your position',
    progressNoun: 'poses',
    steps: [
      {
        seconds: 30,
        title: 'Settle',
        guidance:
          'Stand up and place a sturdy chair behind you or beside you, so you can hold it if you need to.',
      },
      {
        seconds: 35,
        title: 'Mountain Pose',
        guidance: YOGA_POSE_RULES.mountain.guidance,
        poseRuleId: 'mountain',
      },
      {
        seconds: 30,
        title: 'Chair Pose',
        guidance: YOGA_POSE_RULES.chair.guidance,
        poseRuleId: 'chair',
      },
      {
        seconds: 35,
        title: 'Warrior II',
        guidance: YOGA_POSE_RULES['warrior-ii'].guidance,
        poseRuleId: 'warrior-ii',
      },
      {
        seconds: 30,
        title: 'Rest',
        guidance: 'Come back to standing and shake out your arms. Breathe slowly a few times.',
      },
    ],
    safetyNote:
      'These poses are done standing. Do this routine only if standing feels safe today, keep a chair or wall within reach, and sit down or stop if you feel unsteady, tired or unwell. The camera checks the position only - it cannot see your balance or tell you whether a pose is right for you.',
  }),
];
