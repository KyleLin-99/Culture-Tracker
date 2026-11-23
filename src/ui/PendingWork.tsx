import { useState } from 'react';
import { Text, View } from 'react-native';

import { dismissFailedChange, listFailedChanges, listRelabels, resolveRelabel } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { useSyncStatus } from '@/offline/status';

import { Button, Card, ErrorText, Muted, SectionTitle, styles } from './components';
import { colors, font, space } from './theme';

/**
 * Home-screen to-dos from offline work: plates to relabel after a code
 * conflict, and changes the server refused. Shows nothing when there are none.
 */
export function PendingWork() {
  const sync = useSyncStatus();
  const key = `${sync.lastSyncedAt}|${sync.pending}|${sync.failed}`;
  const relabels = useData(listRelabels, key);
  const failed = useData(listFailedChanges, key);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      await Promise.all([relabels.reload(), failed.reload()]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const toRelabel = relabels.data ?? [];
  const refused = failed.data ?? [];
  if (!toRelabel.length && !refused.length) return null;

  return (
    <View style={{ gap: space.sm }}>
      <ErrorText>{error}</ErrorText>

      {toRelabel.length > 0 && (
        <>
          <SectionTitle>Relabel these plates</SectionTitle>
          <Muted>Another device used these codes first, so the server renumbered yours.</Muted>
          {toRelabel.map((r) => (
            <Card key={r.id}>
              <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
                <Text style={styles.codeSmall}>
                  {r.old_code} <Text style={{ color: colors.muted }}>→</Text> {r.new_code}
                </Text>
                <Button title="Done" variant="secondary" onPress={() => act(() => resolveRelabel(r.id))} />
              </View>
            </Card>
          ))}
        </>
      )}

      {refused.length > 0 && (
        <>
          <SectionTitle>Couldn&apos;t save</SectionTitle>
          <Muted>These were undone on this phone.</Muted>
          {refused.map((f) => (
            <Card key={f.seq}>
              <Text style={styles.body}>{f.summary}</Text>
              <Text style={{ color: colors.danger, fontSize: font.small }}>{f.error}</Text>
              <Button title="Dismiss" variant="secondary" onPress={() => act(() => dismissFailedChange(f.seq))} />
            </Card>
          ))}
        </>
      )}
    </View>
  );
}
