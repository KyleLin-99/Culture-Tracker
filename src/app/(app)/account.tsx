import { useState } from 'react';
import { Text } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { useDeletion } from '@/auth/deletion';
import { culturesCsv, exportFileName, type LabExport } from '@/domain/export';
import { todayLocal } from '@/domain/cultureCode';
import { exportLab, requestAccountDeletion } from '@/lib/api';
import { saveTextFile } from '@/lib/saveFile';
import { errorMessage } from '@/lib/supabase';
import { Button, ErrorText, Muted, Screen, SectionTitle, styles } from '@/ui/components';

/** Your data and your account: export the lab, or delete your account. */
export default function Account() {
  const { account_id, accounts } = useMembership();
  const { refresh } = useDeletion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function download(kind: 'json' | 'csv') {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const data = await exportLab(account_id);
      const name = exportFileName(accounts?.name ?? 'lab', todayLocal(), kind);
      await saveTextFile(name, kind === 'json' ? JSON.stringify(data, null, 2) : culturesCsv(data as unknown as LabExport));
      setDone(name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await requestAccountDeletion();
      await refresh(); // the app then shows the "keep or delete" screen
    } catch (e) {
      setError(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SectionTitle>Export {accounts?.name ?? 'this lab'}</SectionTitle>
      <Muted>Everything in this lab, including removed items: all records as JSON, or the cultures as a spreadsheet (CSV).</Muted>
      <Button title="Export everything (JSON)" variant="secondary" busy={busy} onPress={() => void download('json')} />
      <Button title="Export cultures (CSV)" variant="secondary" busy={busy} onPress={() => void download('csv')} />
      {done && <Text style={styles.body} testID="export-done">Saved {done}</Text>}

      <SectionTitle>Delete my account</SectionTitle>
      <Muted>
        You leave every lab you share right away; what you recorded stays there with your initials. Labs only you use are kept for
        30 days, then deleted with your account. Export first if you want a copy. If you are the only owner of a lab with other
        people, make someone else an owner first.
      </Muted>
      <ErrorText>{error}</ErrorText>
      {confirming ? (
        <>
          <Text style={styles.body}>Delete your account? You can change your mind for 30 days.</Text>
          <Button title="Yes, delete my account" busy={busy} onPress={deleteAccount} />
          <Button title="Cancel" variant="secondary" onPress={() => setConfirming(false)} />
        </>
      ) : (
        <Button title="Delete my account…" variant="secondary" onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}
