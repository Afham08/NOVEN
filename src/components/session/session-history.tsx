import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { describeSessionOutcome } from '@/activities/activity-format';
import { Card } from '@/components/ui/card';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDurationLabel, formatPaceLabel } from '@/exercise/metrics';
import { dayLabel, type SessionRecord, type SessionStore } from '@/exercise/session-store';

export type SessionHistoryProps = {
  store: SessionStore;
  /**
   * Called with a stored session the user tapped. The default navigates to the
   * existing result screen, reusing it unchanged.
   */
  onOpenSession?: (record: SessionRecord) => void;
  /** How many sessions to show. The full list stays in storage. */
  limit?: number;
};

/** Most recent sessions shown before the list is cut off. */
const DEFAULT_LIMIT = 10;

/**
 * "5 exercises completed" / "1 exercise completed" — the same plain phrasing the
 * Result screen's hero uses, so the two never disagree about the same session.
 *
 * Kept for the camera sessions, which are the ones that have a count. A guided
 * session counted no repetitions, so `describeSessionOutcome` is what phrases
 * those, and it phrases them by what they actually did.
 */
export function describeCompletedCount(reps: number): string {
  return `${reps} ${reps === 1 ? 'exercise' : 'exercises'} completed`;
}

/**
 * Recent activity: the sessions the user actually finished, newest first.
 *
 * DESIGN INTENT
 * Ordered by what the reader wants first — what they did, how many, and when —
 * with duration as a quiet fourth detail. Everything shown is a number the
 * session really produced; nothing is scored, rated, or described in clinical
 * language, and a metric the engine could not measure is simply not shown rather
 * than shown as a zero.
 *
 * The list holds every kind of session, not only camera ones, because they all
 * end up in the same history and a list that quietly hid half of them would be
 * the wrong list. Each row is described by what that session actually did, so a
 * finished yoga routine reads as poses rather than as zero repetitions.
 *
 * A row is a whole pressable target, because the audience may be tapping with a
 * finger that is not precise.
 */
export function SessionHistory({ store, onOpenSession, limit = DEFAULT_LIMIT }: SessionHistoryProps) {
  const theme = useTheme();
  const [records, setRecords] = useState<SessionRecord[] | null>(null);

  /**
   * Read the history whenever the screen regains focus, not only on mount:
   * finishing a session and coming back has to show the new session here, or the
   * list would sit next to the progress chart and contradict it. A read failure
   * resolves to an empty list inside the store, so this needs no error branch:
   * the empty state is the correct thing to show when the history cannot be read.
   */
  useFocusEffect(
    useCallback(() => {
      // Cancellation is not needed for correctness — a late resolve only replaces
      // the list with a still-valid read of the same store — but the flag keeps
      // an unmounted screen from setting state.
      let active = true;
      void store.getSessions().then((next) => {
        if (active) setRecords(next);
      });
      return () => {
        active = false;
      };
    }, [store]),
  );

  // Not yet read: render nothing rather than a misleading "no sessions yet".
  if (records === null) return null;

  const visible = records.slice(0, Math.max(0, limit));

  if (visible.length === 0) {
    return (
      <Card variant="surface" gap={Spacing.two}>
        <Text style={[styles.emptyTitle, { color: theme.heading }]}>No sessions yet</Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
          Finish an exercise, a yoga routine, or a calm moment, and it will appear
          here.
        </Text>
      </Card>
    );
  }

  return (
    <View style={styles.list}>
      {visible.map((record) => (
        <HistoryRow
          key={record.id}
          record={record}
          onPress={onOpenSession ? () => onOpenSession(record) : undefined}
        />
      ))}
    </View>
  );
}

function HistoryRow({
  record,
  onPress,
}: {
  record: SessionRecord;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const day = dayLabel(record.completedAt);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}>
      <Card variant="surface" gap={Spacing.two}>
        {/*
          The day label comes first because "when did I do this" is the question a
          returning user opens the list to answer, and it is the one piece of
          context a row cannot supply for itself once rows are stacked.
        */}
        {day !== null ? (
          <Text style={[styles.day, { color: theme.textSecondary }]}>{day}</Text>
        ) : null}

        <Text style={[styles.name, { color: theme.heading }]}>{record.exerciseName}</Text>

        <View style={styles.statRow}>
          {/* The count is the headline number, matching the Result screen. */}
          <Text style={[styles.count, { color: theme.accent }]}>
            {describeSessionOutcome(record)}
          </Text>
          <Text style={[styles.duration, { color: theme.textSecondary }]}>
            {formatDurationLabel(record.durationSeconds)}
          </Text>
        </View>

        {/*
          Pace is only shown when the engine actually measured it. A session too
          short to produce a pace simply does not display one, instead of showing
          a placeholder that reads as a real reading.
        */}
        {record.paceRpm !== null ? (
          <Text style={[styles.detail, { color: theme.textSecondary }]}>
            {`Pace ${formatPaceLabel(record.paceRpm)} per minute`}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  day: {
    ...Type.label,
    fontSize: 15,
    lineHeight: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  name: {
    ...Type.subheading,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  count: {
    ...Type.bodyEmphasis,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    flexShrink: 1,
  },
  duration: {
    ...Type.label,
    fontSize: 18,
    lineHeight: 26,
    fontVariant: ['tabular-nums'],
  },
  detail: {
    ...Type.small,
    fontSize: 16,
    lineHeight: 22,
  },
  emptyTitle: {
    ...Type.subheading,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  emptyBody: {
    ...Type.body,
    fontSize: 17,
    lineHeight: 24,
  },
});
