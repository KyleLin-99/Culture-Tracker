import { useState } from 'react';

import { acceptInvite } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';

import { Button, ErrorText, Field } from './components';

/** Join a lab with the code its owner sent (ABCD-EFGH) and your initials for labels. */
export function JoinLabForm({ onJoined }: { onJoined: (accountId: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  const [initials, setInitials] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (code.replace(/[^A-Za-z0-9]/g, '').length !== 8) return setError('The code is 8 letters and numbers, like ABCD-EFGH.');
    if (!/^[A-Z]{1,4}$/.test(initials)) return setError('Initials are 1–4 letters.');
    setBusy(true);
    setError(null);
    try {
      await onJoined(await acceptInvite(code, initials));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Field
        label="Invite code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-EFGH"
      />
      <Field
        label="Your initials in that lab"
        value={initials}
        onChangeText={(t) => setInitials(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
        autoCapitalize="characters"
        placeholder="KL"
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Join lab" busy={busy} onPress={join} />
    </>
  );
}
