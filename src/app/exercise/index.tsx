import { useRouter } from 'expo-router';

import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { describeExerciseCardMeta } from '@/data/exercise-format';
import { exercisesCatalog } from '@/data/exercises';

/**
 * The Exercise Library, reached from the Activities tab.
 *
 * The catalogue under this screen is the whole library: a new exercise is added
 * by appending one entry to `src/data/exercises.ts` (with a camera config beside
 * it), and it appears here — name, description, target, difficulty, and length
 * all read from that entry — with its detail screen, session, and result already
 * working, because every exercise runs the one shared camera session pipeline.
 * Nothing on this screen knows an exercise's name, and that is the point.
 *
 * Each card leads to the exercise's own detail screen, which is the same route
 * that has always led into the session flow. Unchanged in behaviour: the same
 * catalogue, the same navigation, and the same cards that were here before —
 * they now say what each movement actually is and who it asks something of.
 *
 * The heading is left to the stack header above this screen, which is also the
 * way back to Activities.
 */
export default function ExerciseScreen() {
  const router = useRouter();

  return (
    <Screen>
      <SectionHeader
        accent
        title="Choose an exercise"
        subtitle="Each one guides you through the movement at your own pace."
      />

      {exercisesCatalog.length === 0 ? (
        /*
         * The catalogue is imported, never awaited, so this cannot appear on a
         * working build. It is here for the same reason the catalogue assertion
         * is: if the library is ever emptied by an edit, the screen says so
         * plainly instead of leaving a page with a heading and nothing under it.
         */
        <Card variant="surface">
          <SectionHeader
            title="No exercises yet"
            subtitle="The exercise library is empty right now. Please check back soon."
          />
        </Card>
      ) : (
        exercisesCatalog.map((exercise) => (
          <ActivityCard
            key={exercise.id}
            title={exercise.name}
            description={exercise.description}
            meta={describeExerciseCardMeta(exercise)}
            rightLabel="Start"
            onPress={() => router.push(`/exercise/${exercise.id}`)}
          />
        ))
      )}
    </Screen>
  );
}
