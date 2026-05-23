import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

const PUBLIC_PACKAGES = ['@lili/core', '@lili/build', '@lili/product', '@lili/releases']

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const e = error as { stderr?: Buffer | string; stdout?: Buffer | string }
    throw new Error([
      `$ ${cmd} ${args.join(' ')}`,
      e.stdout ? String(e.stdout) : '',
      e.stderr ? String(e.stderr) : '',
    ].filter(Boolean).join('\n'))
  }
}

describe('release candidate readiness gate', () => {
  test('root package exposes one local release candidate check', () => {
    const json = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'))
    expect(json.scripts.metrics).toBe('bun scripts/release-candidate-metrics.ts')
    expect(json.scripts['release:check']).toContain('bun run check')
    expect(json.scripts['release:check']).toContain('bun run test')
    expect(json.scripts['release:check']).toContain('bun run test:examples')
    expect(json.scripts['release:check']).toContain('bun run --silent metrics')
    expect(json.scripts['release:check']).toContain('git diff --check')
  })

  test('metrics command records package size, public surface, dependencies, and boundary exceptions', () => {
    const output = run('bun', ['scripts/release-candidate-metrics.ts'])
    const metrics = JSON.parse(output)
    expect(metrics.schemaVersion).toBe(1)
    expect(metrics.packages.map((pkg: { name: string }) => pkg.name)).toEqual(PUBLIC_PACKAGES)
    expect(metrics.totals.sourceLoc).toBeGreaterThan(0)
    expect(metrics.totals.testLoc).toBeGreaterThan(0)
    expect(metrics.totals.publicRootValueExports).toBeGreaterThan(0)
    expect(metrics.totals.boundaryExceptions).toBe(0)

    for (const pkg of metrics.packages) {
      expect(pkg.dir.startsWith('packages/')).toBe(true)
      expect(pkg.source.files).toBeGreaterThan(0)
      expect(pkg.source.loc).toBeGreaterThan(0)
      expect(pkg.test.files).toBeGreaterThan(0)
      expect(pkg.test.loc).toBeGreaterThan(0)
      expect(pkg.public.rootValueExports).toBe(pkg.public.rootValueExportNames.length)
      expect(pkg.public.rootValueExports).toBeGreaterThan(0)
      expect(pkg.public.subpathExports).toBe(pkg.public.subpathExportNames.length)
      expect(pkg.runtimeDependencies.count).toBe(pkg.runtimeDependencies.names.length)
      expect(pkg.boundaryExceptions).toEqual([])
    }

    const releases = metrics.packages.find((pkg: { name: string }) => pkg.name === '@lili/releases')
    expect(releases.public.subpathExportNames).toContain('./publishers')
    expect(releases.public.subpathExportNames).toContain('./renderers/all')
  })
})
