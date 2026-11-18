import { useState } from 'react';
import { Text, View } from 'react-native';

import { errorMessage, supabase } from '@/lib/supabase';
import { Button, ErrorText, Field, Muted, Screen, styles } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

// Email + 6-digit code. Works the same in Expo Go, on Android and on the web,
// with no deep-link setup. The Supabase email template must include {{ .Token }}.
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else setSentTo(address);
  }

  async function verify() {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) setError(errorMessage(err));
    // On success the auth listener updates the session and the router moves on.
  }

  return (
    <Screen>
      <View style={{ gap: space.sm, marginTop: space.xl * 2 }}>
        <Text style={{ fontSize: 32, fontWeight: '800', color: colors.primary }}>Culture Tracker</Text>
        <Text style={{ fontSize: font.body, color: colors.muted }}>Lineage records for your lab.</Text>
      </View>

      {!sentTo ? (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            onSubmitEditing={sendCode}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Email me a code" onPress={sendCode} busy={busy} />
        </>
      ) : (
        <>
          <Text style={styles.body}>We sent a sign-in code to {sentTo}.</Text>
          <Field
            label="Code"
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={8}
            onSubmitEditing={verify}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Sign in" onPress={verify} busy={busy} disabled={code.length < 6} />
          <Button
            title="Use a different email"
            variant="secondary"
            onPress={() => {
              setSentTo(null);
              setCode('');
              setError(null);
            }}
          />
          <Muted>No email? Check spam, or wait a minute and request a new code.</Muted>
        </>
      )}
    </Screen>
  );
}
