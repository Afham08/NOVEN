import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { buildProgress, type ProgressSummary } from '@/exercise/progress';
import type { SessionStore } from '@/exercise/session-store';

export type ProgressState = {
  /** Null until the first read finishes, so nothing false is shown while loading. */
  summary: ProgressSummary | null;
  /** Every stored session, including any older than the 30-day window. */
  totalSessions: number | null;
};

/**
 * The single source of progress data for the home screen.
 *
 * Read on focus rather than on mount: a user finishes a session, comes back to
 * home, and the chart must show it. Reading on mount alone left the screen
 * showing whatever was true the first time it was opened.
 *
 * Returns the same read to the chart and the score card, so the number in the
 * card and the last dot on the line can never disagree.
 */
export function useProgress(store: SessionStore): ProgressState {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [totalSessions, setTotalSessions] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      // A read failure resolves to an empty list inside the store, so there is
      // no error branch to handle here: the empty state is the honest answer.
      let active = true;
      void store.getSessions().then((records) => {
        if (!active) return;
        setSummary(buildProgress(records));
        setTotalSessions(records.length);
      });
      return () => {
        active = false;
      };
    }, [store]),
  );

  return { summary, totalSessions };
}
