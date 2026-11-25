import { useState } from 'react';
import { Text, View } from 'react-native';

import { joinWaitlist, signupStatus } from '@/lib/api';
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
  // Set when a new person is turned away because the app is full.
  const [full, setFull] = useState(false);
  const [onList, setOnList] = useState(false);

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
    if (err) {
      // New sign-ups are refused by the database when the app is full; GoTrue
      // reports that as a generic "Database error saving new user".
      if (/database error saving new user/i.test(err.message) && (await isFull())) setFull(true);
      else setError(errorMessage(err));
    } else setSentTo(address);
  }

  async function isFull() {
    try {
      return !(await signupStatus()).open;
    } catch {
      return false;
    }
  }

  async function askForPlace() {
    setBusy(true);
    setError(null);
    try {
      await joinWaitlist(email.trim());
      setOnList(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
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

      {full ? (
        <>
          <Text style={styles.body} testID="app-full">We&apos;re full right now.</Text>
          <Muted>
            Culture Tracker is in a small early run. Join the waitlist and we&apos;ll email {email.trim()} when a place opens.
          </Muted>
          <ErrorText>{error}</ErrorText>
          {onList ? (
            <Text style={styles.body} testID="on-waitlist">You&apos;re on the waitlist. Thank you!</Text>
          ) : (
            <Button title="Join the waitlist" onPress={askForPlace} busy={busy} />
          )}
          <Button title="Back" variant="secondary" onPress={() => { setFull(false); setOnList(false); setError(null); }} />
        </>
      ) : !sentTo ? (
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
