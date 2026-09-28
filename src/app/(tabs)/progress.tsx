import { useRouter } from 'expo-router';

import { ScoreCard } from '@/components/cards/score-card';
import { Screen } from '@/components/layout/screen';
import { ProgressSection } from '@/components/progress/progress-section';
import { SessionHistory } from '@/components/session/session-history';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { useProgress } from '@/hooks/use-progress';
import { formatConsistencyLabel, formatDurationLabel, formatPaceLabel, formatRangeLabel } from '@/exercise/metrics';
import { progressHint } from '@/exercise/progress';
import type { SessionRecord } from '@/exercise/session-store';
import { sessionStore } from '@/exercise/session-storage';

/**
 * Everything NOVEN knows about how the user has been moving, on one screen.
 *
 * This screen owns no scoring of its own. The number in the card, the line on
 * the chart, and the list below are all the same stored sessions, read once
 * through `useProgress`, so the three can never disagree. Home shows the same
 * card as a summary; this is where the detail behind it lives.
 */
export default function ProgressScreen() {
  const router = useRouter();
  const { summary, totalSessions } = useProgress(sessionStore);

  /**
   * Reopening a past session reuses the existing result screens exactly as they
   * are: the stored numbers are formatted with the same helpers the live sessions
   * used to build their route params, and those screens' own validation re-checks
   * them on the way in.
   *
   * A guided session goes to the guided result rather than the exercise one. Both
   * screens draw from the same stored numbers, but the exercise result leads with
   * a repetition count and then asks for a pace, a pose range and a steadiness —
   * four figures a breathing session has no observation behind, and four
   * "not enough data" rows on somebody's finished routine.
   */
  const openSession = (record: SessionRecord) => {
    if (record.activityKind !== undefined && record.activityKind !== 'exercise') {
      router.push({
        pathname: '/activity-result',
        params: {
          id: record.exerciseId,
          steps: String(record.stepsCompleted ?? 0),
          seconds: String(record.durationSeconds),
        },
      });
      return;
    }

    router.push({
      pathname: '/exercise/result',
      params: {
        id: record.exerciseId,
        reps: String(record.reps),
        duration: formatDurationLabel(record.durationSeconds),
        pace: formatPaceLabel(record.paceRpm),
        range: formatRangeLabel(record.rangeMinDeg, record.rangeMaxDeg),
        consistency: formatConsistencyLabel(record.consistencyPct),
      },
    });
  };

  return (
    <Screen>
      {/*
        No subtitle. The title and the progress card underneath already say whose
        progress this is, and the card's own hint says where the number came from.
        A line above them restating "from your own sessions" read as reassurance
        rather than information.
      */}
      <Header eyebrow="NOVEN" title="Your progress" />

      <ScoreCard
        variant="inverse"
        emphasis="sage"
        score={summary?.latest?.score}
        label="Progress score"
        hint={progressHint(summary, totalSessions)}
      />

      <ProgressSection summary={summary} totalSessions={totalSessions} />

      {/*
        The full list of real sessions, newest first, directly under the chart
        that summarises them, so any point on the line can be traced to the
        session behind it.
      */}
      {/* No subtitle: the list's own empty state already explains itself. */}
      <SectionHeader accent title="All your sessions" />
      <SessionHistory store={sessionStore} onOpenSession={openSession} />
    </Screen>
  );
}
