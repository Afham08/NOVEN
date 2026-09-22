import { useRouter } from 'expo-router';

import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { Header } from '@/components/ui/header';
import { exercisesCatalog, formatDuration } from '@/data/exercises';

export default function ExerciseScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Header title="Exercise" />

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