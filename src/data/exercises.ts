export type ExerciseDifficulty = 'beginner' | 'intermediate' | 'advanced';

export type Exercise = {
  id: string;
  name: string;
  category: string;
  target: string;
  difficulty: ExerciseDifficulty;
  /** Suggested duration in seconds. */
  durationSeconds: number;
  /** Elder-friendly plain-language description. */
  description: string;
  instructions: string[];
  safetyNote: string;
};

export const exercisesCatalog: readonly Exercise[] = [
  {
    id: 'seated-knee-extension',
    name: 'Seated Knee Extension',
    category: 'Exercise',
    target: 'Legs',
    difficulty: 'beginner',
    durationSeconds: 180,
    description:
      'A gentle seated movement that works the muscles at the front of your thigh. It helps keep your knees strong and your legs moving easily.',
    instructions: [
      'Sit tall in a stable chair with both feet flat on the floor.',
      'Brace yourself by holding the sides of the chair.',
      'Slowly straighten one leg until it is level with your knee.',
      'Pause for a moment, then lower the leg slowly.',
      'Repeat with the other leg. Alternate sides at a calm, steady pace.',
    ],
    safetyNote:
      'Stop immediately if you feel pain, discomfort, or shortness of breath. Keep every movement slow and gentle.',
  },
  {
    id: 'seated-arm-raise',
    name: 'Seated Arm Raise',
    category: 'Exercise',
    target: 'Shoulders',
    difficulty: 'beginner',
    durationSeconds: 180,
    description:
      'A gentle seated movement that lifts both arms up and lowers them again. It gives your shoulders and upper back some easy movement.',
    instructions: [
      'Sit tall in a stable chair with your feet flat on the floor.',
      'Rest your arms down by your sides and relax your shoulders.',
      'Breathe out and raise both arms forward and up, as far as is comfortable.',
      'Pause for a moment, then lower your arms slowly.',
      'Repeat at a calm, steady pace.',
    ],
    safetyNote:
      'Keep the movement within what feels comfortable. Stop immediately if you feel pain, discomfort, or shortness of breath.',
  },
  {
    id: 'sit-to-stand',
    name: 'Sit-to-Stand',
    category: 'Exercise',
    target: 'Legs and hips',
    difficulty: 'beginner',
    durationSeconds: 180,
    description:
      'A supported standing movement from a chair. It works the muscles of your thighs and hips and makes everyday standing and sitting easier.',
    instructions: [
      'Sit towards the front of a stable chair, with your feet a little back and flat on the floor.',
      'Lean your chest forward slightly and place your hands on your thighs.',
      'Stand up slowly, without pushing off hard with your arms.',
      'Pause while standing, then lower yourself back into the chair slowly.',
      'Repeat at a calm, steady pace.',
    ],
    safetyNote:
      'Use a sturdy chair without wheels. Turn your head to the side if you become dizzy, and sit back down straight away.',
  },
];

export function getExerciseById(id?: string | string[] | null): Exercise | undefined {
  const key = Array.isArray(id) ? id[0] : id;
  if (!key) return undefined;
  return exercisesCatalog.find((exercise) => exercise.id === key);
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  return `${totalMinutes} min`;
}