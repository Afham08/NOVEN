import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { formatDurationLabel } from '@/exercise/metrics';
import { useTheme } from '@/hooks/use-theme';

export type SessionTimerProps = {
  /** Elapsed seconds. */
  seconds: number;
  /** Whether the timer is currently counting up. */
  running: boolean;
  /** Suggested duration; used for the progress bar. */
  suggestedSeconds?: number;
};

export function SessionTimer({ seconds, running, suggestedSeconds }: SessionTimerProps) {
  const theme = useTheme();
  const progress = suggestedSeconds ? Math.min(100, (seconds / suggestedSeconds) * 100) : 0;
  // Shared with the result screen so the live timer and the final duration can
  // never disagree in format.
  const label = formatDurationLabel(seconds);

  return (
    <View style={styles.container}>
      <Text
        style={[styles.time, { color: theme.heading }]}
        accessibilityLabel={`Session time ${label}`}>
        {label}
      </Text>
      <Text style={[styles.caption, { color: theme.textSecondary }]}>
        {running ? 'Session in progress' : 'Session paused'}
      </Text>
      {suggestedSeconds ? (
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[styles.fill, { backgroundColor: theme.accentSecondary, width: `${progress}%` }]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  time: {
    ...Type.headingLarge,
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  caption: {
    ...Type.label,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  track: {
    height: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});