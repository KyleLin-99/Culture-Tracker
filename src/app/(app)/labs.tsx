import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth, useMembership } from '@/auth/AuthProvider';
import { createAccount } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { Button, Card, ErrorText, Field, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { JoinLabForm } from '@/ui/JoinLabForm';
import { space } from '@/ui/theme';

import { ROLE_LABEL } from '@/ui/roles';

/** Your labs: switch between them, join another with a code, or start a new one. */
export default function Labs() {
  const current = useMembership();
  const { memberships, switchLab, reloadMembership } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(accountId: string) {
    setError(null);
    try {
      await switchLab(accountId);
      router.dismissTo('/');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function create() {
    if (!name.trim()) return setError('Give the lab a name.');
    setBusy(true);
    setError(null);
    try {
      const id = await createAccount(name.trim(), current.initials);
      await reloadMembership(id);
      router.dismissTo('/');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      <SectionTitle>Your labs</SectionTitle>
      <View style={{ gap: space.sm }}>
        {memberships.map((m) => (
          <Card key={m.account_id} onPress={m.account_id === current.account_id ? undefined : () => void go(m.account_id)}>
            <Text style={styles.codeSmall}>{m.accounts?.name ?? 'Lab'}</Text>
            <Text style={styles.body} testID="lab-row">
              {ROLE_LABEL[m.role]} · {m.initials}
              {m.account_id === current.account_id ? ' · working in this lab' : ' · tap to switch'}
            </Text>
          </Card>
        ))}
      </View>
      <Muted>On a phone, switching replaces the lab copy kept for offline use.</Muted>

      <SectionTitle>Join a lab</SectionTitle>
      <JoinLabForm
        onJoined={async (id) => {
          await reloadMembership(id);
          router.dismissTo('/');
        }}
      />

      <SectionTitle>Start another lab</SectionTitle>
      <Field label="Lab name" value={name} onChangeText={setName} placeholder="Community lab" />
      <Button title="Create lab" variant="secondary" busy={busy} onPress={create} />
    </Screen>
  );
}
