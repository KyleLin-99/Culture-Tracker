import { useState } from 'react';
import { Share, Text, View } from 'react-native';

import { createShareLink, listShareLinks, revokeShareLink } from '@/lib/api';
import { shareUrl } from '@/lib/shareUrl';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';

import { Button, Card, ErrorText, LinkText, Muted, SectionTitle, styles } from './components';
import { space } from './theme';

/**
 * Share a read-only link to this strain's tree (for when a culture changes hands):
 * codes, media, dates and status only; no notes or initials; works for 30 days.
 */
export function ShareLineage({ strainId, strainName, canWrite }: { strainId: string; strainName: string; canWrite: boolean }) {
  const links = useData(() => listShareLinks(strainId), strainId);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await links.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const active = links.data ?? [];
  if (!canWrite && !active.length) return null;

  return (
    <View style={{ gap: space.sm }} testID="share-lineage">
      <SectionTitle>Share lineage</SectionTitle>
      <Muted>
        A read-only link to {strainName}&apos;s family tree: codes, media, dates and status. No notes or initials. Works for
        30 days.
      </Muted>
      <ErrorText>{links.error ?? error}</ErrorText>
      {canWrite && (
        <Button
          title="Make a link"
          variant="secondary"
          busy={busy}
          onPress={() => run(async () => setMade(shareUrl((await createShareLink(strainId)).token)))}
        />
      )}
      {made && (
        <Card>
          <Text style={styles.body} selectable testID="share-url">
            {made}
          </Text>
          <Button
            title="Share link"
            variant="secondary"
            onPress={() => Share.share({ message: `${strainName} lineage: ${made}` }).catch(() => {})}
          />
        </Card>
      )}
      {active.map((l) => (
        <Card key={l.id}>
          <Text style={styles.body} testID="share-link-row">
            Link made {new Date(l.created_at).toLocaleDateString()} · works until {new Date(l.expires_at).toLocaleDateString()}
          </Text>
          {canWrite && <LinkText title="Turn off" onPress={() => run(() => revokeShareLink(l.id))} />}
        </Card>
      ))}
    </View>
  );
}
