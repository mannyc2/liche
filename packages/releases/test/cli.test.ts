import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { run } from '@liche/core'
import type { RunOptions } from '@liche/core'
import { cli } from '../src/cli.js'
import { shipRelease } from '../src/cli/ship-command.js'
import type { CliReleaseManifestInput, PackageRecord } from '../src/index.js'
import type { ReleasesConfig } from '../src/config.js'

async function runCli(
  argv: string[],
  options: Omit<RunOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await run(cli, argv, {
    ...options,
    exit: (code) => {
      exitCode = code
    },
    streams: options.streams ?? { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    stderr: (chunk) => {
      stderr += chunk
    },
    stdout: (chunk) => {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function manifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: { description: 'release cli fixture' },
    subject: {
      id: 'workers',
      name: 'Workers CLI',
      version: '0.1.0',
      commit: '0123456789abcdef0123456789abcdef01234567',
      contract: {
        kind: 'product-catalog',
        digest: 'sha256:fake-catalog',
      },
    },
    release: {
      version: '0.1.0',
      createdAt: '2026-05-19T12:00:00Z',
      generatorVersion: '0.0.0',
    },
    runtime: { command: 'workers' },
    binaries: [],
  }
}

function writeArtifact(dir: string, fileName: string, content: string) {
  const bytes = new TextEncoder().encode(content)
  const path = join(dir, fileName)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  return { path, fileName, sha256: sha256Hex(bytes), size: bytes.byteLength }
}

function pkg(
  id: string,
  ecosystem: PackageRecord['ecosystem'],
  kind: string,
  name: string,
  artifact: { fileName: string; sha256: string; size: number },
): PackageRecord {
  return {
    id,
    renderer: ecosystem,
    ecosystem,
    kind,
    name,
    version: '0.1.0',
    artifact,
  }
}

function writePublishFixture(dir: string, options: { tamperNpmSha?: boolean } = {}) {
  const npmPlatformArtifact = writeArtifact(
    join(dir, 'packages/npm/tarballs'),
    'workers-linux-x64-0.1.0.tgz',
    'npm platform',
  )
  const npmUmbrellaArtifact = writeArtifact(join(dir, 'packages/npm/tarballs'), 'workers-0.1.0.tgz', 'npm umbrella')
  const pypiArtifact = writeArtifact(join(dir, 'packages/pypi'), 'workers-0.1.0-py3-none-any.whl', 'pypi wheel')
  const homebrewArtifact = writeArtifact(join(dir, 'packages/homebrew'), 'workers.rb', 'homebrew formula')

  const wrongSha = '0'.repeat(64)
  const npmPlatformVerified = options.tamperNpmSha ? { ...npmPlatformArtifact, sha256: wrongSha } : npmPlatformArtifact

  const packages: PackageRecord[] = [
    pkg('npm:@liche/workers-linux-x64', 'npm', 'npm-platform', '@liche/workers-linux-x64', npmPlatformVerified),
    pkg('npm:@liche/workers', 'npm', 'npm-umbrella', '@liche/workers', npmUmbrellaArtifact),
    pkg('pypi:liche-workers', 'pypi', 'pypi-wheel', 'liche-workers', pypiArtifact),
    pkg('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers', homebrewArtifact),
  ]

  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifestInput(), packages }, null, 2)}\n`)
  return { manifestPath }
}

function writeBuildRecordFixture(dir: string) {
  const binaryBytes = new TextEncoder().encode('compiled cli')
  const binaryPath = join(dir, 'workers')
  writeFileSync(binaryPath, binaryBytes)
  const buildRecordPath = join(dir, 'build-record.json')
  writeFileSync(
    buildRecordPath,
    `${JSON.stringify(
      {
        recordVersion: 1,
        entrypoint: '/repo/src/cli.ts',
        constants: {
          releaseVersion: '0.1.0',
          contractDigest: 'sha256:fake-catalog',
          sourceCommit: '0123456789abcdef0123456789abcdef01234567',
          buildToolVersion: '0.0.0',
        },
        binaries: [
          {
            id: 'workers-linux-x64',
            target: 'bun-linux-x64',
            platform: 'linux',
            arch: 'x64',
            libc: 'glibc',
            path: binaryPath,
            filename: 'workers',
            sha256: sha256Hex(binaryBytes),
            size: binaryBytes.byteLength,
            compileFlagsDigest: 'sha256:compile-flags',
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  return buildRecordPath
}

function optionValue(argv: readonly string[], option: string): string {
  const index = argv.indexOf(option)
  if (index === -1) throw new Error(`missing ${option}`)
  const value = argv[index + 1]
  if (!value) throw new Error(`missing value for ${option}`)
  return value
}

describe('liche-release CLI', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liche-release-cli-'))
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  test('package writes one manifest with embedded package records', async () => {
    const buildRecordPath = writeBuildRecordFixture(dir)
    const configPath = join(dir, 'liche.releases.json')
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          subject: { id: 'workers', name: 'Workers CLI', command: 'workers' },
          metadata: { description: 'Workers CLI' },
          host: { kind: 'url-template', template: 'https://example.test/downloads/{filename}' },
        },
        null,
        2,
      )}\n`,
    )

    const outDir = join(dir, 'dist')
    const result = await runCli(['--config', configPath, 'package', buildRecordPath, '--out', outDir, '--json'])

    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout).data
    expect(body.manifest).toBe(join(outDir, 'manifest.json'))
    expect(body.packageRecords).toBeUndefined()
    expect(body.packageArtifacts).toBeUndefined()
    expect(existsSync(join(outDir, 'package-records.json'))).toBe(false)
    expect(existsSync(join(outDir, 'package-artifacts.json'))).toBe(false)
    expect(JSON.parse(readFileSync(body.manifest, 'utf8')).packages).toEqual([])
  })

  test('package command consumes explicit createConfig release config', async () => {
    const buildRecordPath = writeBuildRecordFixture(dir)
    const outDir = join(dir, 'dist-config')
    const configPath = join(dir, 'liche.releases.jsonc')
    writeFileSync(
      configPath,
      `{
      "subject": { "id": "workers", "name": "Workers CLI", "command": "workers" },
      "metadata": { "description": "Workers CLI" },
      "host": { "kind": "url-template", "template": "https://example.test/downloads/{filename}" }
    }`,
    )

    const result = await runCli(['--config', configPath, 'package', buildRecordPath, '--out', outDir, '--json'])

    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout).data
    expect(body.manifest).toBe(join(outDir, 'manifest.json'))
    const manifest = JSON.parse(readFileSync(body.manifest, 'utf8'))
    expect(manifest.subject.id).toBe('workers')
    expect(manifest.metadata.description).toBe('Workers CLI')
  })

  test('publish dry-run plans the selected publisher and does not print credentials', async () => {
    const fixture = writePublishFixture(dir)
    const result = await runCli(['publish', fixture.manifestPath, '--ecosystems', 'npm', '--dry-run', '--json'], {
      env: { NPM_TOKEN: 'npm-secret-token' },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).not.toContain('npm-secret-token')
    const body = JSON.parse(result.stdout).data
    expect(body.dryRun).toBe(true)
    expect(body.packagePublish.cleared).toEqual(['npm'])
    expect(body.packagePublish.plan.steps.map((step: { packageId: string }) => step.packageId)).toEqual([
      'npm:@liche/workers-linux-x64',
      'npm:@liche/workers',
    ])
  })

  test('publish command consumes explicit createConfig release config', async () => {
    const fixture = writePublishFixture(dir)
    const configPath = join(dir, 'liche.releases.json')
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          ecosystems: {
            homebrew: { tap: 'liche/homebrew-tap', formula: 'workers' },
          },
        },
        null,
        2,
      )}\n`,
    )
    const result = await runCli(
      ['--config', configPath, 'publish', fixture.manifestPath, '--ecosystems', 'homebrew', '--dry-run', '--json'],
      { env: { HOMEBREW_GITHUB_TOKEN: 'github-token' } },
    )

    expect(result.exitCode).toBe(0)
    const body = JSON.parse(result.stdout).data
    expect(body.packagePublish.cleared).toEqual(['homebrew'])
    expect(body.packagePublish.plan.steps).toEqual([
      expect.objectContaining({
        ecosystem: 'homebrew',
        kind: 'homebrew-write-formula',
        tap: { owner: 'liche', repo: 'homebrew-tap', branch: 'main' },
      }),
    ])
  })

  test('publish fails preflight when selected publisher credentials are missing', async () => {
    const fixture = writePublishFixture(dir)
    const result = await runCli(['publish', fixture.manifestPath, '--ecosystems', 'pypi', '--json'], { env: {} })

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stdout)
    expect(body.error.code).toBe('PUBLISH_PREFLIGHT_FAILED')
    expect(body.error.hint).toContain('pypi/CREDENTIAL_MISSING')
  })

  test('publish requires repository config for git-backed publishers', async () => {
    const fixture = writePublishFixture(dir)
    const result = await runCli(['publish', fixture.manifestPath, '--ecosystems', 'homebrew', '--json'], {
      env: { HOMEBREW_GITHUB_TOKEN: 'github-token' },
    })

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stdout)
    expect(body.error.code).toBe('PUBLISH_PLAN_FAILED')
    expect(body.error.hint).toContain('homebrew/PUBLISHER_CONFIG_MISSING')
  })

  test('publish rechecks artifact bytes before any executor can mutate', async () => {
    const fixture = writePublishFixture(dir, { tamperNpmSha: true })
    const result = await runCli(['publish', fixture.manifestPath, '--ecosystems', 'npm', '--json'], {
      env: { NPM_TOKEN: 'npm-token' },
    })

    expect(result.exitCode).toBe(1)
    const body = JSON.parse(result.stdout)
    expect(body.error.code).toBe('PUBLISH_EXECUTION_FAILED')
    expect(body.error.hint).toContain('ARTIFACT_TAMPERED')
  })

  test('ship orchestrates product generate, build, package, and dry-run publish', async () => {
    const calls: string[][] = []
    const config: ReleasesConfig = {
      subject: { id: 'workers', name: 'Workers CLI', command: 'workers' },
      metadata: { description: 'Workers CLI' },
      host: { kind: 'github-assets', repository: 'acme/workers' },
      ecosystems: {},
      publishers: {},
    }
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/product.ts'), 'export default {}\n')

    const result = await shipRelease({
      config,
      cwd: dir,
      dryRun: true,
      env: {
        GITHUB_REF_NAME: 'v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      },
      runner: async (argv) => {
        calls.push([...argv])
        if (argv[0] === 'bun' && argv[1] === 'liche-product') {
          const out = optionValue(argv, '--out')
          mkdirSync(out, { recursive: true })
          const manifestPath = join(out, 'liche.generated.manifest.json')
          const compileEntrypointPath = join(out, 'liche.compile-entry.ts')
          writeFileSync(compileEntrypointPath, '#!/usr/bin/env bun\n')
          writeFileSync(
            manifestPath,
            `${JSON.stringify(
              {
                manifestVersion: 1,
                schema: { name: 'workers', version: '0.1.0', digest: 'sha256:catalog' },
                generatorVersion: '0.0.0',
                auth: { providers: [] },
                surfaces: [],
              },
              null,
              2,
            )}\n`,
          )
          return {
            code: 0,
            stderr: '',
            stdout: `${JSON.stringify({
              compileEntrypointPath,
              generatedPath: join(out, 'liche.generated.ts'),
              manifestPath,
            })}\n`,
          }
        }
        if (argv[0] === 'bun' && argv[1] === 'liche-build') {
          const recordPath = optionValue(argv, '--record')
          mkdirSync(dirname(recordPath), { recursive: true })
          writeFileSync(
            recordPath,
            `${JSON.stringify(
              {
                recordVersion: 1,
                entrypoint: argv[3],
                constants: {
                  releaseVersion: optionValue(argv, '--release-version'),
                  contractDigest: optionValue(argv, '--contract-digest'),
                  sourceCommit: optionValue(argv, '--commit'),
                  buildToolVersion: '0.0.0',
                },
                binaries: [],
              },
              null,
              2,
            )}\n`,
          )
          return { code: 0, stderr: '', stdout: '{"record":"dist/build-record.json"}\n' }
        }
        return { code: 1, stderr: `unexpected command: ${argv.join(' ')}`, stdout: '' }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls[0]).toEqual([
      'bun',
      'liche-product',
      'generate',
      'src/product.ts',
      '--out',
      join(dir, 'dist/generated'),
      '--json',
    ])
    expect(calls[1]).toEqual([
      'bun',
      'liche-build',
      'build',
      join(dir, 'dist/generated/liche.compile-entry.ts'),
      '--targets',
      'all',
      '--release-version',
      '1.2.3',
      '--commit',
      '0123456789abcdef0123456789abcdef01234567',
      '--contract-digest',
      'sha256:catalog',
      '--out',
      join(dir, 'dist/binaries'),
      '--record',
      join(dir, 'dist/build-record.json'),
      '--json',
    ])
    expect(result.value.package.manifest).toBe(join(dir, 'dist/release/manifest.json'))
    expect(result.value.publish.dryRun).toBe(true)
    expect(result.value.publish.github).toEqual({
      ok: true,
      dryRun: true,
      assets: [join(dir, 'dist/release/manifest.json')],
    })
  })

  test('ship can build a handwritten core CLI from src/cli.ts', async () => {
    const calls: string[][] = []
    const config: ReleasesConfig = {
      subject: { id: 'shipyard', name: 'Shipyard CLI', command: 'shipyard' },
      metadata: { description: 'Shipyard CLI' },
      host: { kind: 'github-assets', repository: 'acme/shipyard-cli' },
      contract: { kind: 'core-command-manifest' },
      ecosystems: {},
      publishers: {},
    }
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/cli.ts'), '#!/usr/bin/env bun\n')

    const result = await shipRelease({
      config,
      cwd: dir,
      dryRun: true,
      env: {
        GITHUB_SHA: 'abcdef0123456789abcdef0123456789abcdef01',
      },
      runner: async (argv) => {
        calls.push([...argv])
        if (argv[0] === 'bun' && argv[1] === join(dir, 'src/cli.ts')) {
          return {
            code: 0,
            stderr: '',
            stdout: `${JSON.stringify({
              manifestVersion: 'liche.v1',
              name: 'shipyard',
              version: '0.8.1',
              commands: [{ name: 'deployments' }, { name: 'promote' }],
            })}\n`,
          }
        }
        if (argv[0] === 'git' && argv[1] === 'describe') {
          return { code: 1, stderr: 'no tags', stdout: '' }
        }
        if (argv[0] === 'bun' && argv[1] === 'liche-build') {
          const recordPath = optionValue(argv, '--record')
          mkdirSync(dirname(recordPath), { recursive: true })
          writeFileSync(
            recordPath,
            `${JSON.stringify(
              {
                recordVersion: 1,
                entrypoint: argv[3],
                constants: {
                  releaseVersion: optionValue(argv, '--release-version'),
                  contractDigest: optionValue(argv, '--contract-digest'),
                  sourceCommit: optionValue(argv, '--commit'),
                  buildToolVersion: '0.0.0',
                },
                binaries: [],
              },
              null,
              2,
            )}\n`,
          )
          return { code: 0, stderr: '', stdout: '{"record":"dist/build-record.json"}\n' }
        }
        return { code: 1, stderr: `unexpected command: ${argv.join(' ')}`, stdout: '' }
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(calls.some((call) => call[1] === 'liche-product')).toBe(false)
    expect(calls[0]).toEqual(['bun', join(dir, 'src/cli.ts'), '--llms', '--json'])
    const buildCall = calls.find((call) => call[0] === 'bun' && call[1] === 'liche-build')
    expect(buildCall).toBeDefined()
    expect(buildCall![3]).toBe(join(dir, 'src/cli.ts'))
    expect(optionValue(buildCall!, '--release-version')).toBe('0.8.1')
    expect(optionValue(buildCall!, '--contract-digest').startsWith('sha256:')).toBe(true)
    expect(result.value.generated.manifest).toBe(join(dir, 'dist/generated/liche.command-manifest.json'))

    const manifest = JSON.parse(readFileSync(result.value.package.manifest, 'utf8'))
    expect(manifest.subject.contract.kind).toBe('core-command-manifest')
    expect(manifest.subject.contract.digest).toBe(optionValue(buildCall!, '--contract-digest'))
  })
})
