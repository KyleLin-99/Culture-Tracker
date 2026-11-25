import { type ReactNode, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { type SignupStatus, signupStatus } from '@/lib/api';
import { getVersionInfo, needsUpdate } from '@/lib/version';
import { Muted, SectionTitle, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

/**
 * Asks the server (signed out is fine) whether this app version is still allowed
 * and whether there is a notice to show. If it can't be reached, the app opens
 * as normal: being offline must never lock anyone out.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SignupStatus | null>(null);
  useEffect(() => {
    let live = true;
    signupStatus()
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (status && needsUpdate(getVersionInfo().version, status.min_app_version)) {
    return (
      <View style={{ flex: 1, padding: space.lg, justifyContent: 'center', gap: space.md, backgroundColor: colors.bg }} testID="update-required">
        <SectionTitle>Please update Culture Tracker</SectionTitle>
        <Muted>This version is too old to talk to your lab safely. Update from the app store (or reload the page) and come back.</Muted>
        {status.message ? <Text style={styles.body}>{status.message}</Text> : null}
      </View>
    );
  }
  return (
    <>
      {status?.message ? (
        <View style={{ backgroundColor: colors.bg, padding: space.sm }} testID="app-notice">
          <Text style={styles.body}>{status.message}</Text>
        </View>
      ) : null}
      {children}
    </>
  );
}
