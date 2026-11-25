import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AppGate } from '@/ui/AppGate';
import { Loading } from '@/ui/components';
import { colors } from '@/ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <AppGate>
          <RootStack />
        </AppGate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootStack() {
  const { loading, session, membership } = useAuth();
  if (loading) return <Loading />;

  const signedIn = !!session;
  const hasLab = !!membership;

  // Each group is reachable only when its guard is true; otherwise Expo Router
  // redirects to the first screen whose guard passes.
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Shared lineage links open for anyone, signed in or not. */}
      <Stack.Screen name="shared/[token]" options={{ title: 'Shared lineage' }} />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasLab}>
        <Stack.Screen name="onboarding" options={{ title: 'Set up your lab' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasLab}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
