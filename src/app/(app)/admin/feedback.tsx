import { useState } from 'react';
import { Text } from 'react-native';

import { adminListFeedback, adminSetFeedbackStatus } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, ErrorText, Muted, Screen, styles } from '@/ui/components';

/** Feedback inbox: newest first; mark as done once handled. */
export default function FeedbackInbox() {
  const inbox = useData(() => adminListFeedback());
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string, status: 'new' | 'done') {
    setError(null);
    try {
      await adminSetFeedbackStatus(id, status === 'new' ? 'done' : 'new');
      await inbox.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Screen>
      <ErrorText>{inbox.error ?? error}</ErrorText>
      {inbox.data?.length === 0 && <Muted>No feedback yet.</Muted>}
      {inbox.data?.map((f) => (
        <Card key={f.id}>
          <Text style={styles.body} testID="feedback-row">
            [{f.kind}] {f.message}
          </Text>
          <Muted>
            {f.email ?? 'unknown'} · {f.created_at.slice(0, 10)} · {f.status}
            {f.emailed ? '' : ' · not emailed'}
            {Object.keys(f.diagnostics).length ? ` · ${Object.values(f.diagnostics).join(' · ')}` : ''}
          </Muted>
          <Button title={f.status === 'new' ? 'Mark done' : 'Mark new'} variant="secondary" onPress={() => void toggle(f.id, f.status)} />
        </Card>
      ))}
    </Screen>
  );
}
