import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { refreshAlive, refreshPlan } from '@/domain/backups';
import type { Item, TreeRow } from '@/domain/types';
import { refreshBackup, refreshInfo, setItemStatus } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';

import { Button, Card, ErrorText, LinkText, Muted, styles } from './components';
import { colors, space } from './theme';

const open = (id: string) => router.push({ pathname: '/items/[id]', params: { id } });

/**
 * Backups: refresh (a new backup from the parent while it's active, else a culture
 * grown from the backup), then retire the old one once the new one is growing.
 * Any culture made as a refresh links back to the backup it replaced.
 */
export function RefreshSection({ item, parent, onChanged }: { item: Item; parent: TreeRow | null; onChanged: () => void }) {
  const info = useData(() => refreshInfo(item.id), `${item.id}:${item.status}`);
  const [confirming, setConfirming] = useState(false);
  const [made, setMade] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await info.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const of = info.data?.refreshOf;
  const by = info.data?.refreshedBy;
  const isActiveBackup = item.kind === 'backup' && item.status === 'active';
  if (!of && !isActiveBackup) return null;
  const plan = refreshPlan(item, parent);

  return (
    <View style={{ gap: space.sm }} testID="refresh-section">
      {of && <LinkText title={`Refresh of ${of.code} ›`} onPress={() => open(of.id)} />}
      <ErrorText>{info.error ?? error}</ErrorText>

      {isActiveBackup && by && refreshAlive(by) && (
        <Card>
          <View style={[styles.row, { gap: space.sm, flexWrap: 'wrap' }]}>
            <Text style={styles.body}>Refreshed by</Text>
            <LinkText title={`${by.code} ›`} onPress={() => open(by.id)} />
          </View>
          {by.checks > 0 ? (
            <Button
              title="Retire this backup"
              variant="secondary"
              busy={busy}
              onPress={() => run(async () => void (await setItemStatus(item.id, 'used')))}
            />
          ) : (
            <Muted>Keep this backup until {by.code} has a growth check showing it&apos;s growing, then retire it here.</Muted>
          )}
        </Card>
      )}

      {isActiveBackup && !(by && refreshAlive(by)) && !made && (
        <>
          {by && <Muted>The last refresh ({by.code}) was {by.status}.</Muted>}
          <Button title="Refresh backup" variant="secondary" onPress={() => setConfirming(!confirming)} />
          {confirming && (
            <Card>
              <Text style={styles.body} testID="refresh-plan">
                {plan.explain}
              </Text>
              <Muted>This backup stays until the new one is growing.</Muted>
              <Button
                title="Refresh now"
                busy={busy}
                onPress={() =>
                  run(async () => {
                    setMade(await refreshBackup(item.id));
                    setConfirming(false);
                  })
                }
              />
            </Card>
          )}
        </>
      )}

      {made && (
        <Card>
          <Muted>Write this label:</Muted>
          <Text style={[styles.codeSmall, { color: colors.text }]}>{made.code}</Text>
          <Button title="Print label" onPress={() => router.push({ pathname: '/labels', params: { ids: made.id } })} />
          <LinkText title={`Open ${made.code} ›`} onPress={() => open(made.id)} />
        </Card>
      )}
    </View>
  );
}
