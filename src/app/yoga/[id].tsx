import { useLocalSearchParams } from 'expo-router';

import { findGuidedActivityInKind } from '@/activities/catalog';
import { GuidedActivityScreen } from '@/components/guided/guided-activity-screen';
import { GuidedNotFound } from '@/components/guided/guided-not-found';

/**
 * One yoga routine.
 *
 * A route file with no wording of its own, which is the point: the screen, its
 * steps, and its safety note live in one component that all three kinds share, so
 * the Yoga, Meditation and Wellness sessions cannot drift apart by being edited
 * one at a time.
 */
export default function YogaRoutineScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const activity = findGuidedActivityInKind('yoga', id);

  if (!activity) return <GuidedNotFound kind="yoga" />;
  return <GuidedActivityScreen activity={activity} />;
}
