/** Minimal Jest config: TypeScript via ts-jest, scoped to unit tests under lib/. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/lib/**/*.test.ts'],
  // lib/orchestrator is dormant Idea Heist code with long-broken tests; the
  // active suites are nightly/, baselines/, extension/
  testPathIgnorePatterns: ['<rootDir>/lib/orchestrator/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true } }],
  },
};
