import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { type AdminOverview, adminOverview, adminSetFlag, adminSetSetting, listFlags } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, ErrorText, Field, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { space } from '@/ui/theme';

/** Back office home: numbers, app-wide settings, feature flags, and links to the lists. */
export default function Admin() {
  const overview = useData(adminOverview);
  const flags = useData(listFlags);
  const [newFlag, setNewFlag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const o = overview.data;
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([overview.reload(), flags.reload()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ErrorText>{overview.error ?? flags.error ?? error}</ErrorText>
      {o && (
        <Card>
          <Text style={styles.body} testID="admin-users">
            {o.users} of {o.max_users} people · {o.labs} labs · {o.waitlist_pending} waiting
          </Text>
          <Muted>
            {Object.entries(o.by_tier)
              .map(([t, n]) => `${t}: ${n}`)
              .join(' · ')}
          </Muted>
        </Card>
      )}

      <View style={{ gap: space.sm }}>
        <Button title="Users" variant="secondary" onPress={() => router.push('/admin/users')} />
        <Button title="Waitlist" variant="secondary" onPress={() => router.push('/admin/waitlist')} />
        <Button title="Audit log" variant="secondary" onPress={() => router.push('/admin/audit')} />
      </View>

      <SectionTitle>App settings</SectionTitle>
      {o && <SettingsForm o={o} busy={busy} run={run} />}

      <SectionTitle>Feature flags</SectionTitle>
      <Muted>On means the feature is live for early-access people; “everyone” opens it to all.</Muted>
      {flags.data?.map((f) => (
        <Card key={f.key}>
          <Text style={styles.body} testID="flag-row">
            {f.key} · {f.enabled ? (f.early_access_only ? 'early access' : 'everyone') : 'off'}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Button title="Off" variant="secondary" busy={busy} onPress={() => void run(() => adminSetFlag(f.key, false, true))} />
            <Button title="Early access" variant="secondary" busy={busy} onPress={() => void run(() => adminSetFlag(f.key, true, true))} />
            <Button title="Everyone" variant="secondary" busy={busy} onPress={() => void run(() => adminSetFlag(f.key, true, false))} />
          </View>
        </Card>
      ))}
      <Field label="New flag name" value={newFlag} onChangeText={setNewFlag} autoCapitalize="none" placeholder="photo_timeline" />
      <Button title="Add flag (off)" variant="secondary" busy={busy} disabled={!newFlag.trim()} onPress={() => void run(() => adminSetFlag(newFlag.trim(), false, true)).then(() => setNewFlag(''))} />
    </Screen>
  );
}

/** Fields start from what the server has; each Save sends just that setting. */
function SettingsForm({ o, busy, run }: { o: AdminOverview; busy: boolean; run: (action: () => Promise<unknown>) => Promise<void> }) {
  const [max, setMax] = useState(String(o.max_users));
  const [minVersion, setMinVersion] = useState(o.min_app_version);
  const [message, setMessage] = useState(o.message);
  return (
    <View style={{ gap: space.sm }}>
          <Button
            title={o.signups_open ? 'New sign-ups are open (tap to close)' : 'New sign-ups are closed (tap to open)'}
            variant="secondary"
            busy={busy}
            onPress={() => void run(() => adminSetSetting('signups_open', !o.signups_open))}
          />
          <Field label="Most people" value={max} onChangeText={setMax} keyboardType="number-pad" />
          <Button title="Save most people" variant="secondary" busy={busy} onPress={() => void run(() => adminSetSetting('max_users', Number(max)))} />
          <Field label="Oldest app version allowed" value={minVersion} onChangeText={setMinVersion} autoCapitalize="none" placeholder="1.0.0" />
          <Button title="Save oldest version" variant="secondary" busy={busy} onPress={() => void run(() => adminSetSetting('min_app_version', minVersion.trim()))} />
          <Field label="Notice shown to everyone" value={message} onChangeText={setMessage} placeholder="Leave empty for none" />
          <Button title="Save notice" variant="secondary" busy={busy} onPress={() => void run(() => adminSetSetting('maintenance_message', message.trim()))} />
        </View>
  );
}
