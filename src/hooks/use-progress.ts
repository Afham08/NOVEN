import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { buildProgress, type ProgressSummary } from '@/exercise/progress';
import type { SessionHistoryLoadIssue, SessionRecord, SessionStore } from '@/exercise/session-store';

export type ProgressState = {
  /** Null until the first read finishes, so nothing false is shown while loading. */
  summary: ProgressSummary | null;
  /** Every stored session, including any older than the 30-day window. */
  totalSessions: number | null;
  /**
   * The same stored sessions the summary was built from, null until the read
   * lands. Presentational summaries (which exercises, which days) read this
   * rather than making a second store read, so everything on the screen keeps
   * agreeing with everything else.
   */
  records: SessionRecord[] | null;
  /** Null on a complete read, otherwise identifies the unavailable/corrupt history. */
  issue: SessionHistoryLoadIssue | null;
  /** Repeats the detailed read while this screen is focused. */
  retry: () => void;
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
  const [records, setRecords] = useState<SessionRecord[] | null>(null);
  const [issue, setIssue] = useState<SessionHistoryLoadIssue | null>(null);
  const retryLoader = useRef<(() => void) | null>(null);
  const retry = useCallback(() => retryLoader.current?.(), []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let request = 0;
      const load = () => {
        const currentRequest = ++request;
        void Promise.resolve()
          .then(() => store.getSessionsResult())
          .then((result) => {
            if (!active || currentRequest !== request) return;
            if (result.status === 'error') {
              setRecords(null);
              setSummary(null);
              setTotalSessions(null);
              setIssue(result.issue);
              return;
            }
            setRecords(result.records);
            setSummary(buildProgress(result.records));
            setTotalSessions(result.records.length);
            setIssue(result.status === 'partial' ? result.issue : null);
          })
          .catch(() => {
            if (!active || currentRequest !== request) return;
            setRecords(null);
            setSummary(null);
            setTotalSessions(null);
            setIssue({ kind: 'storage', partial: false });
          });
      };
      retryLoader.current = load;
      load();
      return () => {
        active = false;
        if (retryLoader.current === load) retryLoader.current = null;
      };
    }, [store]),
  );

  return { summary, totalSessions, records, issue, retry };
}
