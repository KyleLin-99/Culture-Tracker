import { useState } from 'react';
import { Text } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { useDeletion } from '@/auth/deletion';
import { cancelAccountDeletion } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { Button, ErrorText, Muted, Screen, SectionTitle, styles } from '@/ui/components';

/** Shown instead of the app while a deletion is pending: keep the account, or sign out and let it go. */
export default function DeletionPending() {
  const { signOut } = useAuth();
  const { purgeAfter, refresh } = useDeletion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function keep() {
    setBusy(true);
    setError(null);
    try {
      await cancelAccountDeletion();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SectionTitle>Your account is set to be deleted</SectionTitle>
      <Text style={styles.body} testID="deletion-date">
        It will be removed on {purgeAfter?.slice(0, 10)}.
      </Text>
      <Muted>Until then you can keep it. Labs you left earlier are not restored. After that date your sign-in, your labs that nobody else uses, and their records are gone for good.</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Keep my account" onPress={keep} busy={busy} />
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
