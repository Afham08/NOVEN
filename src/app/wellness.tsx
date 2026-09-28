import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { describeLength } from '@/activities/activity-format';
import { guidedCatalog } from '@/activities/catalog';
import { countDoneToday, todayStatus, type TodayActivityStatus } from '@/activities/today';
import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing, Type } from '@/constants/theme';
import { sessionStore } from '@/exercise/session-storage';
import { useTheme } from '@/hooks/use-theme';

/**
 * The wellness activities, reached from the Activities tab.
 *
 * These are the small ones — under two minutes each — and the page is built around
 * the fact that they are done ONCE and then not again until tomorrow. So the thing
 * on screen is today's list with today's state on it, read from the sessions that
 * were actually finished.
 *
 * WHY THE STATE IS DERIVED RATHER THAN TICKED OFF BY HAND
 * A separate tick that someone could set without doing anything would be a
 * checkbox, and a checkbox in a health app is a thing people tick and lie to. The
 * tick here is a fact about a real finished session, which means it can only
 * appear by having been earned. It also means there is nothing to un-tick by
 * hand, and nothing that can disagree with the Progress tab about what happened.
 */
export default function WellnessScreen() {
  const router = useRouter();
  const theme = useTheme();
  const activities = guidedCatalog('wellness');

  const [status, setStatus] = useState<TodayActivityStatus[] | null>(null);

  /**
   * Read on focus rather than on mount, for the same reason the session history
   * does: finishing one of these and coming straight back has to show it as done,
   * or the list contradicts the history sitting on the next tab.
   *
   * A read failure resolves to an empty list inside the store, so there is no
   * error branch here — "nothing done yet" is the honest answer to a history that
   * cannot be read.
   */
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void sessionStore.getSessions().then((records) => {
        if (active) setStatus(todayStatus(records, activities, 'wellness'));
      });
      return () => {
        active = false;
      };
    }, [activities]),
  );

  const counts = status === null ? null : countDoneToday(status);

  return (
    <Screen>
      <SectionHeader accent title="Today" />

      <Card variant="sage" gap={Spacing.two}>
        {/*
          Nothing is claimed until the history has actually been read. Rendering
          "none done yet" during the read would be a real risk of being wrong for
          a person who had already done two of these this morning.
        */}
        {counts === null ? null : (
          <Text style={[styles.summary, { color: theme.text }]}>
            {counts.done === 0
              ? `None of these done today. There are ${counts.total} to choose from.`
              : counts.done === counts.total
                ? `All ${counts.total} done today.`
                : `${counts.done} of ${counts.total} done today.`}
          </Text>
        )}
      </Card>

      {activities.map((activity) => {
        const entry = status?.find((candidate) => candidate.activityId === activity.id);
        return (
          <ActivityCard
            key={activity.id}
            title={activity.name}
            description={activity.summary}
            rightLabel={entry?.done ? 'Done today' : describeLength(activity.durationSeconds)}
            onPress={() => router.push(`/wellness/${activity.id}`)}
          />
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    ...Type.body,
    fontSize: 18,
    lineHeight: 27,
  },
});
