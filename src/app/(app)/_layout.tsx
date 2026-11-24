import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { setCurrentLab } from '@/lib/api';
import { startSync } from '@/offline/engine';
import { HomeButton } from '@/ui/HomeButton';
import { SyncIndicator } from '@/ui/SyncIndicator';
import { colors, space } from '@/ui/theme';

// Home always sits under every other screen, so a page opened from a link or
// a refresh on web still has a way back.
export const unstable_settings = { initialRouteName: 'index' };

export default function AppLayout() {
  const { account_id, initials, role } = useMembership();
  // Set while rendering, so screens below see the right lab on their first load.
  setCurrentLab(account_id);

  // Phones keep a local copy of the lab in sync while signed in (no-op on web).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startSync(account_id, initials, role !== 'viewer').then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [account_id, initials, role]);

  return (
    <Stack
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: 'Back',
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <SyncIndicator />
            {route.name !== 'index' && <HomeButton />}
          </View>
        ),
      })}
    >
      <Stack.Screen name="index" options={{ title: 'Culture Tracker' }} />
      <Stack.Screen name="strains/index" options={{ title: 'Strains' }} />
      <Stack.Screen name="strains/[id]" options={{ title: 'Strain' }} />
      <Stack.Screen name="items/[id]/index" options={{ title: 'Culture' }} />
      <Stack.Screen name="items/[id]/transfer" options={{ title: 'Transfer' }} />
      <Stack.Screen name="batches" options={{ title: 'Batches and runs' }} />
      <Stack.Screen name="batch/[id]" options={{ title: 'Batch' }} />
      <Stack.Screen name="run/[id]" options={{ title: 'Run' }} />
      <Stack.Screen name="trace" options={{ title: 'Contamination trace' }} />
      <Stack.Screen name="labels" options={{ title: 'Print labels' }} />
      <Stack.Screen name="people" options={{ title: 'People' }} />
      <Stack.Screen name="labs" options={{ title: 'Labs' }} />
      <Stack.Screen name="stats" options={{ title: 'Stats' }} />
      <Stack.Screen name="settings" options={{ title: 'Lab settings' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan label' }} />
      <Stack.Screen name="recipes/index" options={{ title: 'Recipes' }} />
      <Stack.Screen name="recipes/[id]" options={{ title: 'Recipe' }} />
      <Stack.Screen name="recipes/edit" options={{ title: 'Recipe' }} />
    </Stack>
  );
}
