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