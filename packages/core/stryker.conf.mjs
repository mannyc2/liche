import os from 'node:os'

export default {
  mutate: ['src/**/*.ts', '!src/index.ts', '!src/bin.ts', '!src/**/__fixtures__/**', '!src/**/*.test.ts'],
  testRunner: 'bun',
  coverageAnalysis: 'perTest',
  plugins: ['@stryker-mutator/typescript-checker', '@hughescr/stryker-bun-runner'],
  bun: { timeout: 30000 },
  checkers: ['typescript'],
  reporters: ['clear-text', 'html', 'json'],
  concurrency: Math.max(2, os.availableParallelism() - 2),
  dryRunTimeoutMinutes: 5,
  incremental: true,
  thresholds: {
    high: 90,
    low: 85,
    break: 80,
  },
  timeoutMS: 10000,
  timeoutFactor: 2,
}
