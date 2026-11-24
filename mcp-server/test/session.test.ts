// loadConfig: which env names it reads, in which order, and the error when a value is missing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadConfig } from '../src/session';

const URL = 'https://proj.supabase.co';

describe('loadConfig', () => {
  for (const name of [
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ]) {
    it(`accepts the key as ${name}`, () => {
      assert.deepEqual(loadConfig({ SUPABASE_URL: URL, [name]: 'k' }), { url: URL, anonKey: 'k' });
    });
  }

  it('accepts the URL as EXPO_PUBLIC_SUPABASE_URL', () => {
    assert.deepEqual(loadConfig({ EXPO_PUBLIC_SUPABASE_URL: URL, SUPABASE_ANON_KEY: 'k' }), { url: URL, anonKey: 'k' });
  });

  it('prefers SUPABASE_URL over EXPO_PUBLIC_SUPABASE_URL', () => {
    const c = loadConfig({ SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_URL: 'https://other', SUPABASE_ANON_KEY: 'k' });
    assert.equal(c.url, URL);
  });

  it('picks keys in order: SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEY, EXPO_PUBLIC_..._PUBLISHABLE_KEY, EXPO_PUBLIC_..._ANON_KEY', () => {
    const all = {
      SUPABASE_URL: URL,
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_PUBLISHABLE_KEY: 'b',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'c',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'd',
    };
    assert.equal(loadConfig(all).anonKey, 'a');
    const { SUPABASE_ANON_KEY: _a, ...noA } = all;
    assert.equal(loadConfig(noA).anonKey, 'b');
    const { SUPABASE_PUBLISHABLE_KEY: _b, ...noB } = noA;
    assert.equal(loadConfig(noB).anonKey, 'c');
    const { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _c, ...noC } = noB;
    assert.equal(loadConfig(noC).anonKey, 'd');
  });

  it('throws naming the variables when the key is missing', () => {
    assert.throws(() => loadConfig({ SUPABASE_URL: URL }), /SUPABASE_ANON_KEY.*EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it('throws when the URL is missing', () => {
    assert.throws(() => loadConfig({ SUPABASE_PUBLISHABLE_KEY: 'k' }), /Set SUPABASE_URL/);
  });

  it('throws when nothing is set', () => {
    assert.throws(() => loadConfig({}), /Set SUPABASE_URL/);
  });
});
