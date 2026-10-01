import { useRouter } from 'expo-router';

import { describeRoutineMeta } from '@/activities/activity-format';
import { guidedCatalog } from '@/activities/catalog';
import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * The yoga routines, reached from the Activities tab.
 *
 * Each card says what the routine actually is: its own summary sentence, plus a
 * factual meta line (length · number of poses) derived from the catalogue entry
 * rather than typed on the screen, so a routine edited in one place cannot go on
 * promising a length it no longer has.
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

      {routines.length === 0 ? (
        /*
         * The catalogue is imported, never awaited, so this cannot appear on a
         * working build. It is here for the same reason the catalogue assertion
         * is: if the yoga catalogue is ever emptied by an edit, the screen says
         * so plainly instead of leaving a page with a heading and nothing
         * under it.
         */
        <Card variant="surface">
          <SectionHeader
            title="No routines yet"
            subtitle="The yoga library is empty right now. Please check back soon."
          />
        </Card>
      ) : (
        routines.map((routine) => (
          <ActivityCard
            key={routine.id}
            title={routine.name}
            description={routine.summary}
            meta={describeRoutineMeta(routine)}
            rightLabel="Start"
            onPress={() => router.push(`/yoga/${routine.id}`)}
          />
        ))
      )}
    </Screen>
  );
}
