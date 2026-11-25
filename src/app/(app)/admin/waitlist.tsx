import { useState } from 'react';
import { Text } from 'react-native';

import { adminApproveWaitlist, adminListWaitlist } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, ErrorText, Muted, Screen, styles } from '@/ui/components';

/** People waiting for a place. Approving lets that email sign up even when the app is full. */
export default function Waitlist() {
  const list = useData(adminListWaitlist);
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setError(null);
    try {
      await adminApproveWaitlist(id);
      await list.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen>
      <ErrorText>{list.error ?? error}</ErrorText>
      {list.data?.length === 0 && <Muted>Nobody is waiting.</Muted>}
      {list.data?.map((w) => (
        <Card key={w.id}>
          <Text style={styles.body} testID="waitlist-row">
            {w.email} · asked {w.created_at.slice(0, 10)}
            {w.approved_at ? ' · approved' : ''}
          </Text>
          {!w.approved_at && <Button title={`Approve ${w.email}`} variant="secondary" onPress={() => void approve(w.id)} />}
        </Card>
      ))}
    </Screen>
  );
}
