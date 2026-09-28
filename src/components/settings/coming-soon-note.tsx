import { StyleSheet, Text } from 'react-native';

import { Card } from '@/components/ui/card';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ComingSoonNoteProps = {
  /** Short, plain heading. Says plainly that the thing is not available yet. */
  title: string;
  /**
   * One or two short sentences, and only when the heading is not already the
   * whole honest answer. Most screens do not need it: if the rows above already
   * say what is and is not available, a second paragraph restating it just makes
   * the page longer to read. Never implies the feature already works.
   */
  message?: string;
};

/**
 * The one honest way NOVEN shows a setting that does not exist yet.
 *
 * It exists because a screen full of rows that do nothing is worse than an
 * empty app: a greyed-out control with no explanation reads as a fault, and a
 * live-looking control that silently does nothing reads as a lie. This says in
 * plain words that the feature is on its way, and — just as importantly — that
 * nothing has been set up, saved, or connected in the meantime.
 *
 * Copy rules for anything using this, which are the whole point of it:
 *   - never imply the feature is partially working
 *   - never say anything was stored, connected, or turned on
 *   - never use a word like "soon" without also saying what a person can do now
 */
export function ComingSoonNote({ title, message }: ComingSoonNoteProps) {
  const theme = useTheme();

  return (
    <Card variant="tint" gap={Spacing.two}>
      <Text style={[styles.title, { color: theme.heading }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    ...Type.subheading,
  },
  message: {
    ...Type.body,
  },
});
