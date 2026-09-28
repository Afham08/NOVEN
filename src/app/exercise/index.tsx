import { useRouter } from 'expo-router';

import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { SectionHeader } from '@/components/ui/section-header';
import { exercisesCatalog, formatDuration } from '@/data/exercises';

/**
 * The list of exercises you can start, reached from the Activities tab.
 *
 * Unchanged in behaviour: the same catalogue, the same cards, and the same
 * route into the session flow. Only its position in the app moved, because
 * Exercise is an activity now rather than a permanent slot in the tab bar.
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

      {exercisesCatalog.map((exercise) => (
        <ActivityCard
          key={exercise.id}
          title={exercise.name}
          description={`${exercise.target} · ${formatDuration(exercise.durationSeconds)}`}
          rightLabel="Start"
          onPress={() => router.push(`/exercise/${exercise.id}`)}
        />
      ))}
    </Screen>
  );
}
