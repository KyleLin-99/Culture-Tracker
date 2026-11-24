import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { shareUrl } from '../shareUrl';

// Hoisted above the import by babel-jest.
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `culturetracker://${path.replace(/^\//, '')}`,
}));

const original = process.env.EXPO_PUBLIC_WEB_URL;

afterEach(() => {
  if (original === undefined) delete process.env.EXPO_PUBLIC_WEB_URL;
  else process.env.EXPO_PUBLIC_WEB_URL = original;
});

describe('shareUrl', () => {
  it('builds an https link on the hosted web app when EXPO_PUBLIC_WEB_URL is set', () => {
    process.env.EXPO_PUBLIC_WEB_URL = 'https://lab.example.org';
    expect(shareUrl('tok123')).toBe('https://lab.example.org/shared/tok123');
  });

  it('drops trailing slashes from EXPO_PUBLIC_WEB_URL', () => {
    process.env.EXPO_PUBLIC_WEB_URL = 'https://lab.example.org///';
    expect(shareUrl('tok123')).toBe('https://lab.example.org/shared/tok123');
  });

  it('keeps a path prefix on EXPO_PUBLIC_WEB_URL', () => {
    process.env.EXPO_PUBLIC_WEB_URL = 'https://example.org/cultures/';
    expect(shareUrl('abc')).toBe('https://example.org/cultures/shared/abc');
  });

  it('falls back to an app link when EXPO_PUBLIC_WEB_URL is unset', () => {
    delete process.env.EXPO_PUBLIC_WEB_URL;
    expect(shareUrl('tok123')).toBe('culturetracker://shared/tok123');
  });

  it('falls back to an app link when EXPO_PUBLIC_WEB_URL is empty or only slashes', () => {
    process.env.EXPO_PUBLIC_WEB_URL = '';
    expect(shareUrl('t')).toBe('culturetracker://shared/t');
    process.env.EXPO_PUBLIC_WEB_URL = '/';
    expect(shareUrl('t')).toBe('culturetracker://shared/t');
  });
});
