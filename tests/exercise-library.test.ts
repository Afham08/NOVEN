import { check, suite } from './harness';

import { describeDifficulty, describeExerciseCardMeta } from '../src/data/exercise-format';
import { exercisesCatalog, formatDuration, type Exercise } from '../src/data/exercises';

/*
 * The exercise library's wording, and the fact that it is generated from the
 * catalogue rather than typed onto the screens. Pure data behaviour only: the
 * screens themselves are React Native components and stay out of this build.
 */
export function run(): void {
  suite('exercise library: difficulty is said in plain words', () => {
    check('beginner is called Gentle', describeDifficulty('beginner') === 'Gentle');
    check('intermediate is called Moderate', describeDifficulty('intermediate') === 'Moderate');
    check('advanced is called Challenging', describeDifficulty('advanced') === 'Challenging');
  });

  suite('exercise library: every catalogue entry describes itself', () => {
    for (const exercise of exercisesCatalog) {
      const meta = describeExerciseCardMeta(exercise);
      check(
        `${exercise.id} card meta names its target`,
        meta.includes(exercise.target),
        meta,
      );
      check(
        `${exercise.id} card meta says its difficulty in words`,
        meta.includes(describeDifficulty(exercise.difficulty)),
        meta,
      );
      check(
        `${exercise.id} card meta says its length`,
        meta.includes(formatDuration(exercise.durationSeconds)),
        meta,
      );
      check(
        `${exercise.id} card meta is separated by middots`,
        meta.split('·').length === 3,
        meta,
      );
    }

    check(
      'an unknown difficulty falls back to the word itself',
      describeDifficulty('expert' as unknown as Exercise['difficulty']) === 'expert',
    );
  });

  suite('exercise library: the meta line is built, not typed', () => {
    const sample: Exercise = {
      id: 'sample',
      name: 'Sample Movement',
      category: 'Exercise',
      target: 'Hips',
      difficulty: 'intermediate',
      durationSeconds: 90,
      description: 'A movement used only by this test.',
      instructions: ['Sit', 'Move', 'Rest'],
      safetyNote: 'Stop if it hurts.',
    };

    const meta = describeExerciseCardMeta(sample);
    check('a new entry needs no screen edit to describe itself', meta === 'Hips · Moderate · 2 min', meta);
    check('length rounding comes from the one shared formatter', formatDuration(90) === '2 min');
  });
}
