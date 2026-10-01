import { StyleSheet, Text, View } from 'react-native';

import { ProgressChart, axisLabelFor } from '@/components/progress/progress-chart';
import { Card } from '@/components/ui/card';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildHistorySummary, describeHistorySummary } from '@/exercise/history-format';
import type { ProgressSummary } from '@/exercise/progress';
import type { SessionRecord } from '@/exercise/session-store';

export type ProgressSectionProps = {
  /** Null while the first read is in flight. */
  summary: ProgressSummary | null;
  /** Every stored session, so "nothing yet" can be told apart from "nothing recent". */
  totalSessions: number | null;
  /**
   * The same stored sessions the summary was built from, for the plain-language
   * recap of the whole history. It reuses the screen's one read rather than
   * making a second one, so the recap can never disagree with the chart above.
   */
  records?: readonly SessionRecord[] | null;
};

/**
 * The 30-day progress view.
 *
 * DESIGN INTENT
 * One idea: show how steady the movement has actually been, drawn only from
 * sessions the user really finished. The chart, the score card above it, and the
 * numbers underneath are all computed from the same read, so they always agree.
 *
 * Every state a returning user can land in is stated plainly rather than papered
 * over. There is a distinct message for "no sessions at all", "sessions exist but
 * they are older than 30 days", and "sessions exist but were too short to
 * measure" - collapsing those into one generic empty card would hide the
 * difference between someone who needs to start and someone who needs to keep
 * going. Nothing is ever drawn or averaged that the user did not do.
 */
export function ProgressSection({ summary, totalSessions, records = null }: ProgressSectionProps) {
  const theme = useTheme();

  // Still reading: render nothing rather than a "0" that is not a real score.
  if (summary === null) return null;

  const { points, sessionsInWindow, scoredInWindow } = summary;

  const body = () => {
    if (totalSessions === 0) {
      return (
        <StateCard
          title="No sessions yet"
          body="Finish an exercise session and your steadiness will start showing up here."
        />
      );
    }

    if (sessionsInWindow === 0) {
      return (
        <StateCard
          title="Nothing in the last 30 days"
          body={`Your ${totalSessions === 1 ? 'session is' : 'sessions are'} still saved. Complete one this month to start a new line.`}
        />
      );
    }

    if (scoredInWindow === 0) {
      return (
        <StateCard
          title="Not enough to measure yet"
          body={`${sessionsInWindow === 1 ? 'This session was' : 'These sessions were'} too short to measure steadiness. A session needs at least two completed repetitions, and its real value will appear here on its own.`}
        />
      );
    }

    const first = points[0];
    const last = points[points.length - 1];
    const single = points.length === 1;

    return (
      <View style={styles.body}>
        <ProgressChart
          points={points.map((point) => ({ key: point.id, score: point.score }))}
          startLabel={single ? null : axisLabelFor(first.completedAt)}
          endLabel={axisLabelFor(last.completedAt)}
        />

        {single ? (
          <Text style={[styles.singleNote, { color: theme.textSecondary }]}>
            One session so far. Your next one adds the next point.
          </Text>
        ) : null}

        <View style={styles.stats}>
          <Stat label="Average" value={summary.average} />
          <Stat label="Best" value={summary.highest} />
          <Stat
            label="Sessions"
            value={scoredInWindow}
            suffix={scoredInWindow === 1 ? 'scored' : 'scored'}
          />
        </View>

        {sessionsInWindow > scoredInWindow ? (
          <Text style={[styles.footnote, { color: theme.textSecondary }]}>
            {`${sessionsInWindow - scoredInWindow} of your ${sessionsInWindow === 1 ? 'session' : 'sessions'} in this window ${sessionsInWindow - scoredInWindow === 1 ? 'was' : 'were'} too short to measure, and ${sessionsInWindow - scoredInWindow === 1 ? 'is' : 'are'} not plotted.`}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: theme.heading }]}>30-day progress</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        How evenly your repetitions moved, over the last 30 days.
      </Text>
      <Card variant="surface" gap={Spacing.four}>
        {body()}
      </Card>
      <Text style={[styles.disclaimer, { color: theme.textSecondary }]}>
        Steady score, from your own sessions. Not a medical measurement.
      </Text>

      <HistoryRecap records={records} />
    </View>
  );
}

/**
 * The whole saved history as one plain sentence, under the 30-day view.
 *
 * The chart only ever sees the last 30 days, so a person whose sessions are
 * older, or who mostly does guided routines, could read this screen and find no
 * mention of what they have actually done. This block says it: which tracked
 * movements were done and how often, across how many days — computed by pure
 * read-side helpers from the same stored records the rest of the screen reads.
 *
 * It renders nothing while the read is in flight, and a quiet "not yet" when
 * there is genuinely nothing saved, so the block never invents a beginning.
 */
function HistoryRecap({ records }: { records: readonly SessionRecord[] | null }) {
  const theme = useTheme();

  if (records === null) return null;

  if (records.length === 0) {
    return (
      <View style={styles.recap}>
        <Text style={[styles.recapTitle, { color: theme.heading }]}>What you have been doing</Text>
        <Text style={[styles.recapBody, { color: theme.textSecondary }]}>
          Nothing saved yet. Your sessions will be listed here as you finish them.
        </Text>
      </View>
    );
  }

  const described = describeHistorySummary(buildHistorySummary(records));
  if (described === null) return null;

  return (
    <View style={styles.recap}>
      <Text style={[styles.recapTitle, { color: theme.heading }]}>What you have been doing</Text>
      <Text style={[styles.recapBody, { color: theme.textSecondary }]}>{described}</Text>
    </View>
  );
}

function StateCard({ title, body }: { title: string; body: string }) {
  const theme = useTheme();
  return (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: theme.heading }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: theme.textSecondary }]}>{body}</Text>
    </View>
  );
}

function Stat({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: theme.accentSecondary }]}>
        {value === null ? '—' : value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textSecondary }]}>
        {suffix ? `${label} ${suffix}` : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  title: {
    ...Type.subheading,
    fontSize: 20,
    lineHeight: 28,
  },
  subtitle: {
    ...Type.body,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: Spacing.two,
  },
  body: {
    gap: Spacing.four,
  },
  singleNote: {
    ...Type.small,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  stats: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  stat: {
    flex: 1,
    gap: 2,
    padding: Spacing.three,
    borderRadius: Radius.small,
    backgroundColor: 'transparent',
  },
  statValue: {
    ...Type.heading,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...Type.caption,
    fontSize: 13,
    lineHeight: 18,
  },
  footnote: {
    ...Type.small,
    fontSize: 14,
    lineHeight: 20,
  },
  disclaimer: {
    ...Type.caption,
    fontSize: 13,
    lineHeight: 18,
  },
  state: {
    gap: Spacing.two,
  },
  recap: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  recapTitle: {
    ...Type.bodyEmphasis,
    fontSize: 18,
    lineHeight: 26,
  },
  recapBody: {
    ...Type.body,
    fontSize: 16,
    lineHeight: 24,
  },
  stateTitle: {
    ...Type.bodyEmphasis,
    fontSize: 18,
    lineHeight: 26,
  },
  stateBody: {
    ...Type.body,
    fontSize: 16,
    lineHeight: 24,
  },
});
