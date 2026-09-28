import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { ComingSoonNote } from '@/components/settings/coming-soon-note';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The Family page, shared by the Family tab and the Family row in Settings.
 *
 * Both entry points render this one component, so there is a single Family
 * screen in the app rather than two that can drift apart. It is deliberately
 * written without any navigation or header chrome of its own, so it looks the
 * same whether it arrives as a bottom tab or as a Settings row.
 *
 * Empty for now, and the state is the point.
 *
 * NOVEN has no account system, no sign-in, and no family records anywhere in
 * the codebase — there is nothing to list and no backend to add somebody to.
 * Rather than show invented relatives, this page shows an empty list that is
 * honestly empty.
 *
 * There is deliberately no paragraph explaining what family members are for.
 * The title, the Add button and the empty state already say what this page is
 * and what it does not have yet, and a paragraph of reassurance underneath them
 * only made the screen longer to read.
 *
 * The empty list is written so that filling it later is a one-line change: when
 * real family members exist, render them above the empty state and return early
 * when there is at least one. The rest of the page does not move.
 */
export type FamilyScreenProps = {
  /**
   * Whether to draw the in-screen Family heading.
   *
   * The Family tab needs it, because a tab sits inside a headerless navigator.
   * The Settings route does not, because the stack header above it already says
   * "Family" and would otherwise be repeated directly underneath.
   */
  showHeader?: boolean;
};

export function FamilyScreen({ showHeader = true }: FamilyScreenProps) {
  const theme = useTheme();
  const [showAddNote, setShowAddNote] = useState(false);

  return (
    <Screen>
      {showHeader ? <Header title="Family" /> : null}

      {/*
        The button is enabled on purpose. A greyed-out button gives no reason and
        reads as something broken, and a button that silently does nothing is
        worse. Pressing it explains the situation, which is the only honest thing
        it can do right now. It sets local state only — no account is created, no
        record is written, and nothing is sent anywhere.
      */}
      <Button
        variant="primary"
        title="Add family member"
        accessibilityHint="Explains whether adding a family member is available"
        onPress={() => setShowAddNote(true)}
      />

      {showAddNote ? (
        <ComingSoonNote
          title="Adding a family member is not available yet"
          message="NOVEN has no family accounts, so nothing was added."
        />
      ) : null}

      <SectionHeader accent title="Your family" />

      {/*
        The honest empty state. It states the absence plainly instead of implying
        a fault or inviting a retry that cannot succeed yet.
      */}
      <Card gap={Spacing.two}>
        <Text style={[styles.emptyTitle, { color: theme.heading }]}>No family members yet</Text>
        <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
          Anyone you add will be listed here.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyTitle: {
    ...Type.subheading,
  },
  emptyBody: {
    ...Type.body,
  },
});
