import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SessionHistoryLoadIssue } from '@/exercise/session-store';

export function SessionHistoryLoadNotice({
  issue,
  onRetry,
}: {
  issue: SessionHistoryLoadIssue;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const message =
    issue.kind === 'storage'
      ? 'Your session history could not be loaded from this device. Stored data has not been changed.'
      : issue.partial
        ? 'Some saved session data could not be read. Readable sessions are shown; stored data has not been changed.'
        : 'Your stored session history could not be read. The data has not been changed.';

  return (
    <Card
      variant="surface"
      gap={Spacing.two}
      style={{ backgroundColor: theme.dangerSoft, borderColor: theme.danger }}>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={[styles.message, { color: theme.danger }]}>
        {message}
      </Text>
      <Button variant="secondary" title="Try again" onPress={onRetry} />
    </Card>
  );
}

const styles = StyleSheet.create({
  message: {
    ...Type.body,
    fontSize: 16,
    lineHeight: 24,
  },
});
