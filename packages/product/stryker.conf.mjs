import os from 'node:os'

export default {
  mutate: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/cli.ts',
    '!src/skill.ts',
    '!src/types.ts',
    '!src/**/__fixtures__/**',
    '!src/**/*.test.ts',
  ],
  testRunner: 'bun',
  coverageAnalysis: 'perTest',
  plugins: ['@stryker-mutator/typescript-checker', '@hughescr/stryker-bun-runner'],
  bun: { timeout: 30000 },
  checkers: ['typescript'],
  disableTypeChecks: 'src/**/*.ts',
  reporters: ['clear-text', 'html', 'json'],
  concurrency: Math.max(2, os.availableParallelism() - 2),
  dryRunTimeoutMinutes: 5,
  incremental: true,
  // Ratcheted floor copied from the former @lili/build product suite (2026-05-19):
  // 80.63 total / 88.34 covered after
  // focused tests against digest, manifest, vocabulary, and the lints surface.
  // Remaining gap is in generate-cli/generate-openapi/catalog (fixture-bound).
  thresholds: {
    high: 90,
    low: 85,
    break: 75,
  },
  timeoutMS: 10000,
  timeoutFactor: 2,
}
