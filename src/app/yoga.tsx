import { useRouter } from 'expo-router';

import { describeLength } from '@/activities/activity-format';
import { guidedCatalog } from '@/activities/catalog';
import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * The yoga routines, reached from the Activities tab.
 *
 * Each card leads to a screen that is both the routine's steps and the session
 * that runs them, so there is one tap from this list to the first pose.
 *
 * The heading is left to the stack header above, which is also the way back to
 * Activities.
 */
export default function YogaScreen() {
  const router = useRouter();
  const routines = guidedCatalog('yoga');

  return (
    <Screen>
      <SectionHeader accent title="Choose a routine" />

      {routines.map((routine) => (
        <ActivityCard
          key={routine.id}
          title={routine.name}
          description={`${describeLength(routine.durationSeconds)} · ${routine.steps.length} poses`}
          rightLabel="Start"
          onPress={() => router.push(`/yoga/${routine.id}`)}
        />
      ))}
    </Screen>
  );
}
