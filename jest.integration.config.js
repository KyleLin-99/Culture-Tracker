// Integration tests: the app's sync and offline code against a real local
// Supabase (API, database, security rules). Run with `npm run test:integration`
// after `npx supabase start` (Docker Desktop). CI runs them on every PR.
// babel-preset-expo ships inside expo; resolve it from there.
const babelPresetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.int.test.ts'],
  transform: { '^.+\\.[cm]?[jt]sx?$': ['babel-jest', { presets: [babelPresetExpo] }] },
  transformIgnorePatterns: ['/node_modules/(?!(@supabase|isows|ws)/)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testTimeout: 30000,
  maxWorkers: 1,
};
