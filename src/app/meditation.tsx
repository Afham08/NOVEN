import { useRouter } from 'expo-router';

import { describeLength } from '@/activities/activity-format';
import { guidedCatalog } from '@/activities/catalog';
import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * The meditation sessions, reached from the Activities tab.
 *
 * The shortest is first on purpose. Someone who has never meditated should be
 * able to tap the first thing they see and finish it, rather than being asked to
 * commit to ten minutes before they know whether the app is for them.
 */
export default function MeditationScreen() {
  const router = useRouter();
  const sessions = guidedCatalog('meditation');

  return (
    <Screen>
      <SectionHeader accent title="Choose a time" />

      {sessions.map((session) => (
        <ActivityCard
          key={session.id}
          title={session.name}
          description={session.summary}
          rightLabel={describeLength(session.durationSeconds)}
          onPress={() => router.push(`/meditation/${session.id}`)}
        />
      ))}
    </Screen>
  );
}
