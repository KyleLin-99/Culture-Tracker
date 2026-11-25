import { useState } from 'react';
import { Text, View } from 'react-native';

import { type AdminUser, adminListUsers, adminSetEarlyAccess, adminSetTier, type Tier } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, Muted, Screen, styles } from '@/ui/components';
import { space } from '@/ui/theme';

const TIERS: { value: Tier; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'paid1', label: 'Paid 1' },
  { value: 'paid2', label: 'Paid 2' },
  { value: 'special', label: 'Special' },
];

/** Everyone with an account: plan, early access, last sign-in and lab counts (never lab records). */
export default function Users() {
  const [search, setSearch] = useState('');
  const users = useData(() => adminListUsers(search.trim()), search.trim());
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await users.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const when = (iso: string | null) => (iso ? iso.slice(0, 10) : 'never');

  return (
    <Screen>
      <Field label="Search by email" value={search} onChangeText={setSearch} autoCapitalize="none" />
      <ErrorText>{users.error ?? error}</ErrorText>
      {users.data?.map((u: AdminUser) => (
        <Card key={u.user_id} onPress={() => setOpen(open === u.user_id ? null : u.user_id)}>
          <Text style={styles.body} testID="user-row">
            {u.email} · {TIERS.find((t) => t.value === u.tier)?.label}
            {u.early_access ? ' · early access' : ''}
            {u.is_admin ? ' · admin' : ''}
          </Text>
          <Muted>
            Joined {when(u.created_at)} · last in {when(u.last_sign_in_at)} · owns {u.labs_owned}, joined {u.labs_joined}
          </Muted>
          {open === u.user_id && (
            <View style={{ gap: space.sm }}>
              <Choices<Tier> label="Plan" value={u.tier} options={TIERS} onChange={(t) => void run(() => adminSetTier(u.user_id, t))} />
              <Button
                title={u.early_access ? 'Remove early access' : 'Give early access'}
                variant="secondary"
                onPress={() => void run(() => adminSetEarlyAccess(u.user_id, !u.early_access))}
              />
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
