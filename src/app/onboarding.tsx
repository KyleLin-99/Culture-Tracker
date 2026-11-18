import { useState } from 'react';
import { Text } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { createAccount } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { Button, ErrorText, Field, Muted, Screen, styles } from '@/ui/components';

export default function Onboarding() {
  const { reloadMembership, signOut } = useAuth();
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError('Give your lab a name.');
    if (!/^[A-Z]{1,4}$/.test(initials)) return setError('Initials are 1–4 letters.');
    setBusy(true);
    setError(null);
    try {
      await createAccount(name.trim(), initials);
      await reloadMembership(); // the router moves to the home screen
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.body}>One-time setup. Your initials go on every label next to the date and culture code.</Text>
      <Field label="Lab name" value={name} onChangeText={setName} placeholder="Kyle's Lab" />
      <Field
        label="Your initials"
        value={initials}
        onChangeText={(t) => setInitials(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
        autoCapitalize="characters"
        placeholder="KL"
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Create lab" onPress={submit} busy={busy} />
      <Button title="Sign out" variant="secondary" onPress={signOut} />
      <Muted>You can rename the lab later.</Muted>
    </Screen>
  );
}
