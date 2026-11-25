import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Text } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { type FeedbackKind, sendFeedback } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { formatVersion, getVersionInfo } from '@/lib/version';
import { Button, Choices, ErrorText, Field, Muted, Screen, SectionTitle, styles } from '@/ui/components';

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'bug', label: 'Something broke' },
  { value: 'idea', label: 'An idea' },
  { value: 'question', label: 'A question' },
];

/** Send the app's owner a message. Optionally includes the app version and platform (never lab data). */
export default function Feedback() {
  const { role } = useMembership();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [withInfo, setWithInfo] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const diagnostics = { app: formatVersion(getVersionInfo()), platform: Platform.OS, role };

  async function send() {
    if (!message.trim()) return setError('Write a message first.');
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(kind, message.trim(), withInfo === 'yes' ? diagnostics : {});
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen>
        <SectionTitle>Thank you</SectionTitle>
        <Text style={styles.body} testID="feedback-sent">Your message was sent.</Text>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Choices<FeedbackKind> label="What is it?" value={kind} options={KINDS} onChange={setKind} />
      <Field label="Message" value={message} onChangeText={setMessage} multiline numberOfLines={6} maxLength={4000} placeholder="Tell me what happened or what you'd like" />
      <Choices<'yes' | 'no'>
        label="Include app version and device type?"
        value={withInfo}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        onChange={setWithInfo}
      />
      {withInfo === 'yes' && <Muted>Sends: {Object.values(diagnostics).join(' · ')}. No lab records.</Muted>}
      <ErrorText>{error}</ErrorText>
      <Button title="Send feedback" onPress={send} busy={busy} />
    </Screen>
  );
}
