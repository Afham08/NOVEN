import { useLocalSearchParams } from 'expo-router';

import { findGuidedActivityInKind } from '@/activities/catalog';
import { GuidedActivityScreen } from '@/components/guided/guided-activity-screen';
import { GuidedNotFound } from '@/components/guided/guided-not-found';

/**
 * One wellness activity.
 *
 * A route file with no wording of its own: the screen is the one every guided
 * activity runs on, and the timer, the steps, and the result all come from it.
 */
export default function WellnessActivityScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const activity = findGuidedActivityInKind('wellness', id);

  if (!activity) return <GuidedNotFound kind="wellness" />;
  return <GuidedActivityScreen activity={activity} />;
}
