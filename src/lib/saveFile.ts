import { Share } from 'react-native';

/** Phones: hand the text to the share sheet (save to Files, email, Drive...). */
export async function saveTextFile(name: string, text: string): Promise<void> {
  await Share.share({ title: name, message: text });
}
