import { describe, expect, test } from 'bun:test'
import { CliReleaseManifestSchema, manifestFromBuildRecord, parseCliReleaseManifest } from '../src/index.js'
import type { BuildRecord, RecordedBinary, ReleaseDistConfig } from '../src/index.js'

const SHA = '0'.repeat(64)

function binary(overrides: Partial<RecordedBinary> = {}): RecordedBinary {
  return {
    id: 'darwin-arm64',
    target: 'bun-darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    path: '/tmp/build/darwin-arm64/cli',
    filename: 'cli',
    sha256: SHA,
    size: 1024,
    compileFlagsDigest: 'sha256:flags',
    ...overrides,
  }
}

function record(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    recordVersion: 1,
    entrypoint: '/repo/src/cli.ts',
    constants: {
      releaseVersion: '1.2.3',
      contractDigest: 'sha256:contract',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      buildToolVersion: '0.0.0',
    },
    binaries: [binary()],
    ...overrides,
  }
}

function baseConfig(overrides: Partial<ReleaseDistConfig> = {}): ReleaseDistConfig {
  return {
    subject: { id: 'workers', name: 'Workers CLI' },
    metadata: { description: 'Workers CLI' },
    host: { kind: 'github-assets', repository: 'acme/workers' },
    release: { generatorVersion: '0.0.0', createdAt: '2026-05-20T00:00:00Z' },
    ...overrides,
  }
}

describe('manifestFromBuildRecord', () => {
  test('derives a manifest input that validates against the release schema', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig())
    const parsed = parseCliReleaseManifest(manifestInput)
    expect(parsed.ok).toBe(true)
  })

  test('sets subject + contract from build record constants and config', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig())
    expect(manifestInput.subject).toEqual({
      id: 'workers',
      name: 'Workers CLI',
      version: '1.2.3',
      commit: '0123456789abcdef0123456789abcdef01234567',
      contract: { kind: 'product-catalog', digest: 'sha256:contract' },
    })
  })

  test('honors a core-command-manifest contract override', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig({ contract: { kind: 'core-command-manifest' } }))
    expect(manifestInput.subject.contract.kind).toBe('core-command-manifest')
  })

  test('defaults runtime.command to subject.id', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig())
    expect(manifestInput.runtime.command).toBe('workers')
  })

  test('uses an explicit subject.command override', () => {
    const manifestInput = manifestFromBuildRecord(
      record(),
      baseConfig({ subject: { id: 'workers', name: 'Workers CLI', command: 'wk' } }),
    )
    expect(manifestInput.runtime.command).toBe('wk')
  })

  test('renames binary filenames via the default {command}-{id}{ext} template', () => {
    const manifestInput = manifestFromBuildRecord(
      record({
        binaries: [
          binary({ id: 'darwin-arm64', filename: 'cli' }),
          binary({
            id: 'windows-x64',
            target: 'bun-windows-x64',
            platform: 'windows',
            arch: 'x64',
            filename: 'cli.exe',
            path: '/tmp/build/windows-x64/cli.exe',
          }),
        ],
      }),
      baseConfig(),
    )
    expect(manifestInput.binaries.map((b) => b.filename)).toEqual(['workers-darwin-arm64', 'workers-windows-x64.exe'])
  })

  test('honors a custom filename template', () => {
    const manifestInput = manifestFromBuildRecord(
      record(),
      baseConfig({ filenameTemplate: '{command}-{platform}-{arch}{ext}' }),
    )
    expect(manifestInput.binaries[0]?.filename).toBe('workers-darwin-arm64')
  })

  test('builds a github-assets URL with the default v{version} tag', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig())
    expect(manifestInput.binaries[0]?.url).toBe(
      'https://github.com/acme/workers/releases/download/v1.2.3/workers-darwin-arm64',
    )
  })

  test('honors a custom github-assets tag template', () => {
    const manifestInput = manifestFromBuildRecord(
      record(),
      baseConfig({
        host: { kind: 'github-assets', repository: 'acme/workers', tag: 'workers-{version}' },
      }),
    )
    expect(manifestInput.binaries[0]?.url).toBe(
      'https://github.com/acme/workers/releases/download/workers-1.2.3/workers-darwin-arm64',
    )
  })

  test('builds URLs from a url-template host', () => {
    const manifestInput = manifestFromBuildRecord(
      record({
        binaries: [binary({ id: 'linux-x64', target: 'bun-linux-x64', platform: 'linux', arch: 'x64', libc: 'glibc' })],
      }),
      baseConfig({
        host: {
          kind: 'url-template',
          template: 'https://cdn.example.test/{version}/{platform}/{arch}/{filename}',
        },
      }),
    )
    expect(manifestInput.binaries[0]?.url).toBe('https://cdn.example.test/1.2.3/linux/x64/workers-linux-x64')
  })

  test('preserves libc and cpuVariant facts on each binary', () => {
    const manifestInput = manifestFromBuildRecord(
      record({
        binaries: [
          binary({
            id: 'linux-x64-musl',
            target: 'bun-linux-x64-musl',
            platform: 'linux',
            arch: 'x64',
            libc: 'musl',
            cpuVariant: 'baseline',
          }),
        ],
      }),
      baseConfig(),
    )
    expect(manifestInput.binaries[0]?.libc).toBe('musl')
    expect(manifestInput.binaries[0]?.cpuVariant).toBe('baseline')
  })

  test('propagates metadata (description, license, homepage, repository)', () => {
    const manifestInput = manifestFromBuildRecord(
      record(),
      baseConfig({
        metadata: {
          description: 'Workers CLI',
          homepage: 'https://acme.example/workers',
          license: 'MIT',
          repository: { type: 'git', url: 'https://github.com/acme/workers.git' },
        },
      }),
    )
    expect(manifestInput.metadata).toEqual({
      description: 'Workers CLI',
      homepage: 'https://acme.example/workers',
      license: 'MIT',
      repository: { type: 'git', url: 'https://github.com/acme/workers.git' },
    })
  })

  test('release.createdAt is auto-generated when not supplied', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig({ release: { generatorVersion: '0.0.0' } }))
    const parsed = CliReleaseManifestSchema.parse(manifestInput)
    expect(parsed.release.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('compileFlagsDigest is carried through to the manifest binaries', () => {
    const manifestInput = manifestFromBuildRecord(record(), baseConfig())
    expect(manifestInput.binaries[0]?.compileFlagsDigest).toBe('sha256:flags')
  })
})
