import { formatDuration, type Exercise } from './exercises';

/**
 * How the catalogue's difficulty levels are said out loud.
 *
 * The values live in the data model; the words live here, so the catalogue
 * stays pure data and no screen has to know what `beginner` looks like as a
 * sentence. An unknown value falls back to the word itself rather than hiding
 * an entry that a future catalogue edit added without updating this map.
 */
const DIFFICULTY_LABEL: Readonly<Record<Exercise['difficulty'], string>> = {
  beginner: 'Gentle',
  intermediate: 'Moderate',
  advanced: 'Challenging',
};

/** The plain-language difficulty of an exercise, as shown on a card. */
export function describeDifficulty(difficulty: Exercise['difficulty']): string {
  return DIFFICULTY_LABEL[difficulty] ?? difficulty;
}

/**
 * The one line under an exercise's name on a card: what it works, how hard,
 * how long. Every value is read from the catalogue entry, never typed here,
 * so a new exercise describes itself the moment it is added to the list.
 */
export function describeExerciseCardMeta(exercise: Exercise): string {
  return `${exercise.target} · ${describeDifficulty(exercise.difficulty)} · ${formatDuration(
    exercise.durationSeconds,
  )}`;
}
