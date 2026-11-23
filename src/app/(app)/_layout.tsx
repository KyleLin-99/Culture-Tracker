import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useMembership } from '@/auth/AuthProvider';
import { startSync } from '@/offline/engine';
import { SyncIndicator } from '@/ui/SyncIndicator';
import { colors } from '@/ui/theme';

export default function AppLayout() {
  const { account_id } = useMembership();

  // Phones keep a local copy of the lab in sync while signed in (no-op on web).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startSync(account_id).then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [account_id]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: 'Back',
        headerRight: () => <SyncIndicator />,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Culture Tracker' }} />
      <Stack.Screen name="strains/index" options={{ title: 'Strains' }} />
      <Stack.Screen name="strains/[id]" options={{ title: 'Strain' }} />
      <Stack.Screen name="items/[id]/index" options={{ title: 'Culture' }} />
      <Stack.Screen name="items/[id]/transfer" options={{ title: 'Transfer' }} />
      <Stack.Screen name="batches" options={{ title: 'Batches and runs' }} />
      <Stack.Screen name="trace" options={{ title: 'Contamination trace' }} />
    </Stack>
  );
}
