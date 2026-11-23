import { Text, View } from 'react-native';

import { ago, useSyncStatus } from '@/offline/status';

import { colors, font } from './theme';

/** Header badge: says so when the phone is offline or sync is failing; quiet otherwise. */
export function SyncIndicator() {
  const { state } = useSyncStatus();
  if (state !== 'offline' && state !== 'error') return null;
  const offline = state === 'offline';
  return (
    <View
      accessibilityRole="text"
      style={{
        backgroundColor: offline ? colors.warnBg : colors.dangerBg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: offline ? colors.warn : colors.danger, fontSize: font.small, fontWeight: '600' }}>
        {offline ? 'Offline' : 'Sync issue'}
      </Text>
    </View>
  );
}

/** One line for the home screen: where the phone's copy stands. Empty on web. */
export function SyncSummary() {
  const { state, lastSyncedAt, message, pending } = useSyncStatus();
  if (state === 'off') return null;
  const waiting = pending ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting to sync` : '';
  const text =
    state === 'syncing' && !lastSyncedAt
      ? 'Copying your lab to this phone…'
      : state === 'syncing'
        ? `Syncing…${waiting}`
        : state === 'offline'
          ? `Offline · showing your lab as of ${ago(lastSyncedAt)}${waiting}`
          : state === 'error'
            ? `Sync issue: ${message ?? 'unknown error'} · last synced ${ago(lastSyncedAt)}${waiting}`
            : `Synced ${ago(lastSyncedAt)} · works offline${waiting}`;
  return <Text style={{ color: state === 'error' ? colors.danger : colors.muted, fontSize: font.small }}>{text}</Text>;
}
