import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { parseScan } from '@/domain/labels';
import { lookupCode } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { Button, ErrorText, LinkText, Muted, Screen } from '@/ui/components';
import { colors, space } from '@/ui/theme';

/** Point the camera at a culture label to open it. */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  // The camera reports the same code many times a second; handle one at a time.
  const handling = useRef(false);
  const lastIgnored = useRef('');

  async function onScanned({ data }: BarcodeScanningResult) {
    if (handling.current || data === lastIgnored.current) return;
    handling.current = true;
    try {
      const scan = parseScan(data);
      if (!scan) {
        lastIgnored.current = data;
        setMessage('That QR code isn’t a culture label.');
        return;
      }
      if (scan.kind === 'item') {
        router.replace({ pathname: '/items/[id]', params: { id: scan.id } });
        return;
      }
      const exact = (await lookupCode(scan.code)).filter((r) => r.exact);
      if (exact.length === 1) {
        router.replace({ pathname: '/items/[id]', params: { id: exact[0].id } });
        return;
      }
      lastIgnored.current = data;
      setMessage(
        exact.length
          ? `${scan.code} is in more than one strain. Type it on the home screen to pick one.`
          : `No culture with code ${scan.code}.`,
      );
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      handling.current = false;
    }
  }

  if (!permission) return <Screen>{null}</Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Muted>The camera reads the QR code on a culture label and opens that culture.</Muted>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <ErrorText>Camera access is off for this app. Turn it on in your phone’s settings to scan labels.</ErrorText>
        )}
        <LinkText title="Type the code instead" onPress={() => router.dismissTo('/')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, gap: space.md }}>
        <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', minHeight: 320 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
          {/* Aiming square */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '20%',
              left: '20%',
              right: '20%',
              aspectRatio: 1,
              borderWidth: 3,
              borderColor: colors.primaryText,
              borderRadius: 12,
            }}
          />
        </View>
        {message ? <ErrorText>{message}</ErrorText> : <Muted>Hold the label inside the square.</Muted>}
        <LinkText title="Type the code instead" onPress={() => router.dismissTo('/')} />
      </View>
    </Screen>
  );
}
