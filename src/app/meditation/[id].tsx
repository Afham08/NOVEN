import { useLocalSearchParams } from 'expo-router';

import { findGuidedActivityInKind } from '@/activities/catalog';
import { GuidedActivityScreen } from '@/components/guided/guided-activity-screen';
import { GuidedNotFound } from '@/components/guided/guided-not-found';

/**
 * One meditation session.
 *
 * A route file with no wording of its own: the screen is the one every guided
 * activity runs on, and the timer, the stages, and the result all come from it.
 */
export default function MeditationSessionScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const activity = findGuidedActivityInKind('meditation', id);

  if (!activity) return <GuidedNotFound kind="meditation" />;
  return <GuidedActivityScreen activity={activity} />;
}
