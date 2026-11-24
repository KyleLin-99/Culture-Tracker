import { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';

import { qrSvg } from '@/domain/qr';

export function QrCode({ value, size }: { value: string; size: number }) {
  const xml = useMemo(() => qrSvg(value), [value]);
  return <SvgXml xml={xml} width={size} height={size} />;
}
