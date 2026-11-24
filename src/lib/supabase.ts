import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { friendlyError } from '@/domain/errors';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env and fill them in.',
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // Phones keep the session in AsyncStorage; the web build uses localStorage.
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Only refresh tokens while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Turns a Supabase/Postgres error into a sentence for the screen. */
export function errorMessage(error: unknown): string {
  const raw = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
  if (/network request failed|failed to fetch|fetch failed|network error|load failed/i.test(raw)) {
    return 'No connection. On your phone, changes save offline once your lab has synced once; on the web, try again when you are back online.';
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const code = 'code' in error ? String((error as { code: unknown }).code) : undefined;
    return friendlyError(String((error as { message: unknown }).message), code);
  }
  return 'Something went wrong. Please try again.';
}
