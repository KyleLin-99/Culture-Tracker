import { Stack } from 'expo-router';

import { colors } from '@/ui/theme';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: 'Back',
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
