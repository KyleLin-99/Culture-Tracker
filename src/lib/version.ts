import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export type VersionInfo = {
  /** User-facing semver, the same on iOS, Android and web. */
  version: string;
  /** Store build number; null on web and in Expo Go. */
  build: string | null;
  /** Update channel (`staging`, `production`); null when the build has none. */
  channel: string | null;
  /** True when running code downloaded by an over-the-air update. */
  isUpdate: boolean;
};

/** Pure formatting, so it is easy to test: `v1.2.3 (build 45) · staging`. */
export function formatVersion(v: VersionInfo): string {
  const parts = [`v${v.version}`];
  if (v.build) parts[0] += ` (build ${v.build})`;
  parts.push(v.channel ?? 'no channel');
  return parts.join(' · ');
}

/** Compares dotted versions: negative when a < b. Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * What is running right now. Every native lookup is guarded: web and Expo Go
 * have no store build number, and expo-updates is inert in development.
 */
export function getVersionInfo(): VersionInfo {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
  let channel: string | null = null;
  let isUpdate = false;
  try {
    channel = Updates.channel || null;
    isUpdate = Updates.isEnabled && !Updates.isEmbeddedLaunch;
  } catch {
    // not available on this platform
  }
  return { version, build: Application.nativeBuildVersion ?? null, channel, isUpdate };
}
