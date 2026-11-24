import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { labelDate, MAX_CODE_LENGTH, MEDIUM_LABEL, roomLeft, STATUS_LABEL } from '@/domain/cultureCode';
import type { Item, ItemStatus, Medium } from '@/domain/types';
import { addNote, changeNote, createBackups, getItem, itemEvents, itemLineage, setItemStatus } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, LinkText, Muted, Screen, SectionTitle, StatusPill, Stepper, styles } from '@/ui/components';
import { GrowthSection } from '@/ui/GrowthSection';
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
  const item = useData(() => getItem(id), id);
  const lineage = useData(() => itemLineage(id, 'both'), id);
  const events = useData(() => itemEvents(id), id);

  const [panel, setPanel] = useState<Panel>(null);
  const [backupMedium, setBackupMedium] = useState<Medium>('slant');
  const [backupCount, setBackupCount] = useState(1);
  const [newBackups, setNewBackups] = useState<Item[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // Note being edited (with its draft text) or waiting for "remove?" confirmation.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const i = item.data;

  async function run(action: () => Promise<unknown>, after?: () => void, keepPanel = false) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (!keepPanel) setPanel(null);
      setText('');
      setEditing(null);
      setRemoving(null);
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
    setNewBackups(null);
    setBackupCount(1);
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
      {i.strains?.name ? (
        <LinkText
          title={`‹ ${i.strains.name}`}
          onPress={() => router.dismissTo({ pathname: '/strains/[id]', params: { id: i.strain_id } })}
        />
      ) : null}

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
            {i.media_batches ? ` · ${i.media_batches.code}` : ''}
            {i.media_batches?.sterilization_runs ? ` (${i.media_batches.sterilization_runs.code})` : ''}
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
          <Button title="Make backups" variant="secondary" onPress={() => open('backup')} />
          {panel === 'backup' && (
            <Card>
              {newBackups ? (
                <>
                  <Muted>Write these labels:</Muted>
                  {newBackups.map((b) => (
                    <Text key={b.id} style={styles.codeSmall}>
                      {b.code}
                    </Text>
                  ))}
                  <Muted>
                    {i.strains?.name} · {labelDate(newBackups[0].made_on)} · {newBackups[0].initials}
                  </Muted>
                  <Button
                    title={newBackups.length === 1 ? 'Print label' : `Print ${newBackups.length} labels`}
                    onPress={() => router.push({ pathname: '/labels', params: { ids: newBackups.map((b) => b.id).join(',') } })}
                  />
                  <Button title="Done" variant="secondary" onPress={() => open(null)} />
                </>
              ) : (
                <>
                  <Stepper label="How many" value={backupCount} onChange={setBackupCount} min={1} max={100} />
                  <Choices<Medium> label="Backup on" value={backupMedium} onChange={setBackupMedium} options={BACKUP_MEDIA} />
                  <Muted>They will be labeled {i.code}(1), {i.code}(2)… continuing from any existing backups.</Muted>
                  <Button
                    title={backupCount === 1 ? 'Create backup' : `Create ${backupCount} backups`}
                    busy={busy}
                    onPress={() =>
                      run(
                        async () => setNewBackups(await createBackups({ parentId: i.id, count: backupCount, medium: backupMedium })),
                        undefined,
                        true,
                      )
                    }
                  />
                </>
              )}
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
      {i.status === 'contaminated' && (
        <Button title="Trace likely cause" onPress={() => router.push('/trace')} />
      )}
      {!active && (
        <Button title="Mark active again" variant="secondary" busy={busy} onPress={() => run(() => setItemStatus(i.id, 'active'))} />
      )}

      <Button
        title="Print label"
        variant="secondary"
        onPress={() => router.push({ pathname: '/labels', params: { ids: i.id } })}
      />
      <Button title="Add note" variant="secondary" onPress={() => open('note')} />
      {panel === 'note' && (
        <Card>
          <Field label="Note" value={text} onChangeText={setText} multiline placeholder="Fast, rhizomorphic growth" />
          <Button title="Save note" busy={busy} disabled={!text.trim()} onPress={() => run(() => addNote(account_id, i.id, text))} />
        </Card>
      )}

      {lineage.data && (
        <GrowthSection
          culture={i}
          ancestors={lineage.data.filter((r) => r.depth < 0).sort((a, b) => a.depth - b.depth)}
          canLog={active}
        />
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
            {editing?.id === e.id ? (
              <>
                <Field
                  label="Edit note"
                  value={editing.text}
                  onChangeText={(t) => setEditing({ id: e.id, text: t })}
                  multiline
                  autoFocus
                />
                <View style={[styles.row, { gap: space.sm }]}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Save"
                      busy={busy}
                      disabled={!editing.text.trim()}
                      onPress={() => run(() => changeNote(e.id, editing.text))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Cancel" variant="secondary" onPress={() => setEditing(null)} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.body}>{e.note ?? e.type}</Text>
                <Muted>
                  {new Date(e.occurred_at).toLocaleString()}
                  {e.contam_type ? ` · ${e.contam_type}` : ''}
                </Muted>
              </>
            )}

            {/* Only notes can change; transfers, backups and status changes are a fixed record. */}
            {e.type === 'note' && editing?.id !== e.id && removing !== e.id && (
              <View style={[styles.row, { gap: space.lg }]}>
                <LinkText
                  title="Edit"
                  onPress={() => {
                    setError(null);
                    setRemoving(null);
                    setEditing({ id: e.id, text: e.note ?? '' });
                  }}
                />
                <LinkText
                  title="Remove"
                  onPress={() => {
                    setError(null);
                    setEditing(null);
                    setRemoving(e.id);
                  }}
                />
              </View>
            )}
            {removing === e.id && (
              <View style={{ gap: space.sm }}>
                <Muted>Remove this note?</Muted>
                <View style={[styles.row, { gap: space.sm }]}>
                  <View style={{ flex: 1 }}>
                    <Button title="Remove note" variant="danger" busy={busy} onPress={() => run(() => changeNote(e.id, null))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Keep" variant="secondary" onPress={() => setRemoving(null)} />
                  </View>
                </View>
              </View>
            )}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
