/** Default unit-test config. Database and external-service suites require an explicit run. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/lib/**/*.test.ts'],
  // lib/orchestrator is dormant Idea Heist code with long-broken tests. Keep
  // integration tests out of the default command: some intentionally read or
  // refresh derived production state and must be targeted with an explicit opt-in.
  testPathIgnorePatterns: [
    '<rootDir>/lib/orchestrator/',
    '\\.integration\\.test\\.ts$',
    '\\.db\\.test\\.ts$',
    '<rootDir>/lib/ingest/is-short-trigger.test.ts',
    '<rootDir>/lib/ingest/no-db-shorts-rule.test.ts',
  ],
  // The app's '@/…' alias, so a test can import a route handler the way the route itself
  // imports lib code.
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true } }],
  },
};
