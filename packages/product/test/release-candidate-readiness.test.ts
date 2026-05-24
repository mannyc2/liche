import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

const PUBLIC_PACKAGES = ['@liche/core', '@liche/extensions', '@liche/build', '@liche/product', '@liche/releases']

function expectedPackageFiles(packageName: string): string[] {
  return packageName === '@liche/core'
    ? ['src', 'README.md', 'SKILL.md', 'LICENSE']
    : ['src', 'README.md', 'LICENSE']
}

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
    expect(json.scripts['release:metadata']).toBe('bun scripts/release-metadata-check.ts')
    expect(json.scripts['release:names']).toBe('bun scripts/check-npm-package-availability.ts')
    expect(json.scripts['release:check']).toContain('bun run check')
    expect(json.scripts['release:check']).toContain('bun run test')
    expect(json.scripts['release:check']).toContain('bun run test:examples')
    expect(json.scripts['release:check']).toContain('bun run --silent metrics')
    expect(json.scripts['release:check']).toContain('bun run --silent release:metadata')
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

    const releases = metrics.packages.find((pkg: { name: string }) => pkg.name === '@liche/releases')
    expect(releases.public.subpathExportNames).toContain('./publishers')
    expect(releases.public.subpathExportNames).toContain('./renderers/all')
  })

  test('metadata gate locks public release support files and package metadata rules', () => {
    const output = run('bun', ['scripts/release-metadata-check.ts'])
    const report = JSON.parse(output)
    expect(report.schemaVersion).toBe(1)
    expect(report.ok).toBe(true)
    expect(report.remainingHumanGates).toContain(
      'Confirm npm organization ownership and package publish rights for the final scope before each manual publish.',
    )
    expect(report.remainingHumanGates).toContain(
      'Configure or verify npm trusted publishers for .github/workflows/publish.yml and npm-production before relying on CI publishing.',
    )

    for (const pkg of report.packages) {
      expect(PUBLIC_PACKAGES).toContain(pkg.name)
      expect(pkg.license).toBe('MIT')
      expect(pkg.files).toEqual(expectedPackageFiles(pkg.name))
      expect(pkg.repository).toBeNull()
      expect(pkg.homepage).toBeNull()
      expect(pkg.bugs).toBeNull()
      expect(pkg.funding).toBeNull()
    }
  })
})
