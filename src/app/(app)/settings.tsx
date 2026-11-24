import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { BACKUP_MEDIA, type BackupMedium, DEFAULT_REFRESH_DAYS, DUE_SOON_DAYS } from '@/domain/backups';
import { MEDIUM_LABEL } from '@/domain/cultureCode';
import { backupRefreshDays, saveBackupRefreshDays } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { Button, ErrorText, Field, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { space } from '@/ui/theme';

/** Lab settings. For now: how often each kind of backup needs refreshing. */
export default function Settings() {
  const { account_id, role } = useMembership();
  const isOwner = role === 'owner';
  const [days, setDays] = useState<Record<BackupMedium, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    backupRefreshDays()
      .then((d) => live && setDays(Object.fromEntries(BACKUP_MEDIA.map((m) => [m, String(d[m])])) as Record<BackupMedium, string>))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    if (!days) return;
    const parsed = BACKUP_MEDIA.map((m) => [m, Number(days[m])] as const);
    if (parsed.some(([, n]) => !Number.isInteger(n) || n < 1 || n > 3650)) {
      return setError('Refresh ages are whole days from 1 to 3650.');
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveBackupRefreshDays(account_id, Object.fromEntries(parsed));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SectionTitle>Backup refresh ages</SectionTitle>
      <Muted>
        Days a backup keeps before it should be refreshed. Backups past this age show under “Backups due” on the home
        screen, starting {DUE_SOON_DAYS} days early.
      </Muted>
      <ErrorText>{error}</ErrorText>
      {days && (
        <View style={{ gap: space.sm }}>
          {BACKUP_MEDIA.map((m) => (
            <View key={m} style={[styles.row, { alignItems: 'flex-end' }]}>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${MEDIUM_LABEL[m]} (days)`}
                  value={days[m]}
                  onChangeText={(t) => {
                    setSaved(false);
                    setDays({ ...days, [m]: t.replace(/[^0-9]/g, '') });
                  }}
                  keyboardType="number-pad"
                  placeholder={String(DEFAULT_REFRESH_DAYS[m])}
                />
              </View>
            </View>
          ))}
          {isOwner ? (
            <Button title="Save" busy={busy} onPress={save} />
          ) : (
            <Muted>Only the lab&apos;s owners can change these.</Muted>
          )}
          {saved && <Muted>Saved.</Muted>}
        </View>
      )}
    </Screen>
  );
}
