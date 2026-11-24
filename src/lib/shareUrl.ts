import * as Linking from 'expo-linking';

/**
 * The address of a shared lineage page. With EXPO_PUBLIC_WEB_URL set (where the
 * web app is hosted), a normal https link anyone can open; otherwise a link into
 * this app (the web app's own address on the web).
 */
export function shareUrl(token: string): string {
  const web = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, '');
  return web ? `${web}/shared/${token}` : Linking.createURL(`/shared/${token}`);
}
