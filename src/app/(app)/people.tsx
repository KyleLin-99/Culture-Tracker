import { router } from 'expo-router';
import { useState } from 'react';
import { Share, Text, View } from 'react-native';

import { useAuth, useMembership } from '@/auth/AuthProvider';
import type { Role } from '@/domain/types';
import { inviteMember, listInvites, listMembers, removeMember, revokeInvite, setMemberRole } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, LinkText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { ROLE_LABEL } from '@/ui/roles';
import { space } from '@/ui/theme';

const ROLE_HINT: Record<Role, string> = {
  owner: 'Everything, including lab settings and people.',
  tech: 'Records work: transfers, notes, checks, batches, recipes.',
  viewer: 'Sees everything, changes nothing.',
};
const ROLES: Role[] = ['owner', 'tech', 'viewer'];

/** Who's in the lab. Owners invite people, change roles and remove them; anyone can leave. */
export default function People() {
  const me = useMembership();
  const { reloadMembership, session } = useAuth();
  const isOwner = me.role === 'owner';
  const members = useData(() => listMembers(me.account_id), me.account_id);
  const invites = useData(() => (isOwner ? listInvites(me.account_id) : Promise.resolve([])), `${me.account_id}:${isOwner}`);

  const [inviteRole, setInviteRole] = useState<Role>('tech');
  const [newCode, setNewCode] = useState<{ code: string; role: Role } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await Promise.all([members.reload(), invites.reload()]);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const myId = session?.user.id;
  const share = (code: string) =>
    Share.share({
      message: `Join ${me.accounts?.name ?? 'my lab'} on Culture Tracker: sign in, choose "Join a lab", and enter ${code}. The code works once, for 7 days.`,
    }).catch(() => {});

  return (
    <Screen>
      <ErrorText>{members.error ?? invites.error ?? error}</ErrorText>

      <SectionTitle>People in {me.accounts?.name ?? 'this lab'}</SectionTitle>
      <View style={{ gap: space.sm }}>
        {members.data?.map((m) => {
          const isMe = m.user_id === myId;
          return (
            <Card key={m.user_id}>
              <Text style={styles.body} testID="member-row">
                <Text style={{ fontWeight: '700' }}>{m.initials}</Text> · {ROLE_LABEL[m.role]}
                {isMe ? ' · you' : ''}
              </Text>
              {isOwner && editing === m.user_id && (
                <Choices<Role>
                  label="Role"
                  value={m.role}
                  onChange={(role) => void run(() => setMemberRole(me.account_id, m.user_id, role)).then((ok) => ok && setEditing(null))}
                  options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                />
              )}
              {confirmRemove === m.user_id ? (
                <View style={{ gap: space.sm }}>
                  <Muted>
                    {isMe
                      ? 'Leave this lab? You will need a new invite to come back.'
                      : `Remove ${m.initials}? What they recorded stays, with their initials.`}
                  </Muted>
                  <Button
                    title={isMe ? 'Leave lab' : 'Remove'}
                    variant="danger"
                    busy={busy}
                    onPress={() =>
                      void run(() => removeMember(me.account_id, m.user_id)).then(async (ok) => {
                        if (ok && isMe) {
                          await reloadMembership();
                          router.dismissTo('/');
                        }
                        setConfirmRemove(null);
                      })
                    }
                  />
                  <Button title="Cancel" variant="secondary" onPress={() => setConfirmRemove(null)} />
                </View>
              ) : (
                <View style={[styles.row, { gap: space.lg }]}>
                  {isOwner && <LinkText title="Change role" onPress={() => setEditing(editing === m.user_id ? null : m.user_id)} />}
                  {(isOwner || isMe) && <LinkText title={isMe ? 'Leave' : 'Remove'} onPress={() => setConfirmRemove(m.user_id)} />}
                </View>
              )}
            </Card>
          );
        })}
      </View>

      {isOwner && (
        <>
          <SectionTitle>Invite someone</SectionTitle>
          <Choices<Role> label="As" value={inviteRole} onChange={setInviteRole} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          <Muted>{ROLE_HINT[inviteRole]}</Muted>
          <Button
            title="Make invite code"
            busy={busy}
            onPress={() => void run(async () => setNewCode({ ...(await inviteMember(me.account_id, inviteRole)), role: inviteRole }))}
          />
          {newCode && (
            <Card>
              <Muted>Send this code ({ROLE_LABEL[newCode.role].toLowerCase()}). It works once, for 7 days, and won&apos;t be shown again:</Muted>
              <Text style={styles.code} selectable testID="invite-code">
                {newCode.code}
              </Text>
              <Button title="Share code" variant="secondary" onPress={() => share(newCode.code)} />
            </Card>
          )}

          {!!invites.data?.length && (
            <>
              <SectionTitle>Unused invites</SectionTitle>
              {invites.data.map((i) => (
                <Card key={i.id}>
                  <Text style={styles.body} testID="invite-row">
                    {ROLE_LABEL[i.role]} · expires {new Date(i.expires_at).toLocaleDateString()}
                  </Text>
                  <LinkText title="Cancel invite" onPress={() => void run(() => revokeInvite(i.id))} />
                </Card>
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
