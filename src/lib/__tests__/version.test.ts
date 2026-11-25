import { describe, expect, it, jest } from '@jest/globals';

import { compareVersions, formatVersion, getVersionInfo } from '../version';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3', nativeBuildVersion: '45' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));
jest.mock('expo-updates', () => ({ channel: 'staging', isEnabled: true, isEmbeddedLaunch: false }));

describe('formatVersion', () => {
  it('shows version, build and channel', () => {
    expect(formatVersion({ version: '1.2.3', build: '45', channel: 'staging', isUpdate: false })).toBe(
      'v1.2.3 (build 45) · staging',
    );
  });
  it('leaves out the build on web and says when there is no channel', () => {
    expect(formatVersion({ version: '1.0.0', build: null, channel: null, isUpdate: false })).toBe('v1.0.0 · no channel');
  });
});

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });
});

describe('getVersionInfo', () => {
  it('reads the native version, build, channel and whether an update is running', () => {
    expect(getVersionInfo()).toEqual({ version: '1.2.3', build: '45', channel: 'staging', isUpdate: true });
  });
});
