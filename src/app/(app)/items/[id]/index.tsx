import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { labelDate, MAX_CODE_LENGTH, MEDIUM_LABEL, roomLeft, STATUS_LABEL } from '@/domain/cultureCode';
import type { ItemStatus, Medium } from '@/domain/types';
import { addNote, createBackup, getItem, itemEvents, itemLineage, setItemStatus } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, Muted, Screen, SectionTitle, StatusPill, styles } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';
import { TreeList } from '@/ui/TreeList';

type Panel = null | 'backup' | 'contaminated' | 'retire' | 'note';

const BACKUP_MEDIA: { value: Medium; label: string }[] = [
  { value: 'slant', label: 'Slant' },
  { value: 'lc', label: 'Liquid culture' },
  { value: 'agar', label: 'Agar' },
  { value: 'other', label: 'Other' },
];

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account_id } = useMembership();
  const item = useData(() => getItem(id), [id]);
  const lineage = useData(() => itemLineage(id, 'both'), [id]);
  const events = useData(() => itemEvents(id), [id]);

  const [panel, setPanel] = useState<Panel>(null);
  const [backupMedium, setBackupMedium] = useState<Medium>('slant');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const i = item.data;

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPanel(null);
      setText('');
      await Promise.all([item.reload(), lineage.reload(), events.reload()]);
      after?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function open(p: Panel) {
    setError(null);
    setText('');
    setPanel(panel === p ? null : p);
  }

  if (!i) {
    return (
      <Screen>
        <ErrorText>{item.error}</ErrorText>
      </Screen>
    );
  }

  const room = roomLeft(i.code);
  const active = i.status === 'active';

  return (
    <Screen>
      <Stack.Screen options={{ title: i.code }} />

      {/* What goes on the label */}
      <Card>
        <Text style={styles.code}>{i.code}</Text>
        <Text style={styles.body}>
          {i.strains?.name} · {labelDate(i.made_on)} · {i.initials}
        </Text>
        <View style={[styles.row, { marginTop: space.xs, flexWrap: 'wrap' }]}>
          <StatusPill status={i.status} label={STATUS_LABEL[i.status]} />
          <Muted>
            {MEDIUM_LABEL[i.medium]} · Gen {i.generation}
            {i.location ? ` · ${i.location}` : ''}
          </Muted>
        </View>
      </Card>

      {room <= 2 && (
        <View style={{ backgroundColor: colors.warnBg, borderRadius: 12, padding: space.md }}>
          <Text style={{ color: colors.warn, fontSize: font.body }}>
            {room <= 0
              ? `This code is at the ${MAX_CODE_LENGTH}-character limit, so it can't be transferred further.`
              : `${room} character${room === 1 ? '' : 's'} left before the ${MAX_CODE_LENGTH}-character limit.`}
          </Text>
        </View>
      )}

      <ErrorText>{error}</ErrorText>

      {/* One-tap actions */}
      {active && (
        <View style={{ gap: space.sm }}>
          <Button
            title="Transfer"
            onPress={() => router.push({ pathname: '/items/[id]/transfer', params: { id: i.id } })}
            disabled={room <= 0}
          />
          <Button title="Make a backup" variant="secondary" onPress={() => open('backup')} />
          {panel === 'backup' && (
            <Card>
              <Choices<Medium> label="Backup on" value={backupMedium} onChange={setBackupMedium} options={BACKUP_MEDIA} />
              <Muted>It will be labeled {i.code}(n).</Muted>
              <Button title="Create backup" busy={busy} onPress={() => run(() => createBackup(i.id, backupMedium))} />
            </Card>
          )}

          <Button title="Mark contaminated" variant="danger" onPress={() => open('contaminated')} />
          {panel === 'contaminated' && (
            <Card>
              <Field label="Contaminant (optional)" value={text} onChangeText={setText} placeholder="Trich, cobweb, bacteria…" />
              <Button
                title="Confirm contaminated"
                variant="danger"
                busy={busy}
                onPress={() => run(() => setItemStatus(i.id, 'contaminated', undefined, text))}
              />
            </Card>
          )}

          <Button title="Retire" variant="secondary" onPress={() => open('retire')} />
          {panel === 'retire' && (
            <Card>
              {(['used', 'archived', 'discarded'] as ItemStatus[]).map((s) => (
                <Button
                  key={s}
                  title={STATUS_LABEL[s]}
                  variant="secondary"
                  busy={busy}
                  onPress={() => run(() => setItemStatus(i.id, s))}
                />
              ))}
            </Card>
          )}
        </View>
      )}
      {!active && (
        <Button title="Mark active again" variant="secondary" busy={busy} onPress={() => run(() => setItemStatus(i.id, 'active'))} />
      )}

      <Button title="Add note" variant="secondary" onPress={() => open('note')} />
      {panel === 'note' && (
        <Card>
          <Field label="Note" value={text} onChangeText={setText} multiline placeholder="Fast, rhizomorphic growth" />
          <Button title="Save note" busy={busy} disabled={!text.trim()} onPress={() => run(() => addNote(account_id, i.id, text))} />
        </Card>
      )}

      <SectionTitle>Lineage</SectionTitle>
      <ErrorText>{lineage.error}</ErrorText>
      <TreeList rows={lineage.data ?? []} highlightId={i.id} />

      <SectionTitle>History</SectionTitle>
      <ErrorText>{events.error}</ErrorText>
      {events.data?.length === 0 && <Muted>No events yet.</Muted>}
      <View style={{ gap: space.sm }}>
        {events.data?.map((e) => (
          <Card key={e.id}>
            <Text style={styles.body}>{e.note ?? e.type}</Text>
            <Muted>
              {new Date(e.occurred_at).toLocaleString()}
              {e.contam_type ? ` · ${e.contam_type}` : ''}
            </Muted>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
