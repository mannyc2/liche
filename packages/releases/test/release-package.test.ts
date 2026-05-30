import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { packageRelease } from '../src/index.js'
import type { CliReleaseManifestInput, PackageRecord, ReleaseRenderer, ReleaseRendererInput } from '../src/index.js'

const tmp = mkdtempSync(join(tmpdir(), 'liche-releases-package-'))
const binaryPath = join(tmp, 'workers-linux-x64')
const binaryBytes = Buffer.from('FINAL-SIGNED-BINARY-BYTES')
const binarySha256 = sha256Hex(binaryBytes)
const ZERO_HASH = '0'.repeat(64)

writeFileSync(binaryPath, binaryBytes)

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function baseManifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: {
      description: 'release package test fixture',
      license: 'MIT',
      homepage: 'https://example.test/workers',
      repository: {
        type: 'git',
        url: 'https://example.test/workers.git',
      },
    },
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
    binaries: [
      {
        id: 'workers-linux-x64',
        target: 'bun-linux-x64',
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        filename: 'workers',
        url: 'https://example.test/downloads/workers-linux-x64',
        sha256: binarySha256,
        size: binaryBytes.byteLength,
      },
    ],
  }
}

function packageRecord(bytes: Uint8Array, sha256 = sha256Hex(bytes)): PackageRecord {
  return {
    id: 'workers-npm-fixture',
    renderer: 'npm',
    ecosystem: 'npm',
    kind: 'fixture-tarball',
    name: '@acme/workers',
    version: '0.1.0',
    targetBinaryId: 'workers-linux-x64',
    artifact: {
      fileName: 'workers-0.1.0.fixture',
      sha256,
      size: bytes.byteLength,
    },
  }
}

function fixtureRenderer(
  options: {
    artifactSha256?: string
    capture?: (input: ReleaseRendererInput) => void
  } = {},
): ReleaseRenderer {
  return {
    id: 'npm',
    render: async (input) => {
      options.capture?.(input)
      const artifactBytes = Buffer.from(`fixture package for ${input.manifest.subject.id}`)
      const artifactPath = join(input.outDir, 'workers-0.1.0.fixture')
      await Bun.write(artifactPath, artifactBytes)
      return {
        packages: [packageRecord(artifactBytes, options.artifactSha256)],
        artifacts: [{ packageId: 'workers-npm-fixture', path: artifactPath }],
      }
    },
  }
}

describe('packageRelease', () => {
  test('validates manifest and binaries without renderers', async () => {
    const outDir = join(tmp, 'no-renderers')
    const result = await packageRelease({
      manifest: baseManifestInput(),
      binaryPaths: { 'workers-linux-x64': binaryPath },
      renderers: [],
      rendererRegistry: {},
      outDir,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.binaries).toEqual([
      {
        binaryId: 'workers-linux-x64',
        path: binaryPath,
        sha256: binarySha256,
        size: binaryBytes.byteLength,
      },
    ])
    expect(result.packages).toEqual([])
    expect(result.packageArtifacts).toEqual([])
    expect(existsSync(outDir)).toBe(false)
  })

  test('invokes a selected renderer with verified binary input and verifies packed output', async () => {
    const outDir = join(tmp, 'fixture-renderer')
    let capturedInput: ReleaseRendererInput | null = null
    const result = await packageRelease({
      manifest: baseManifestInput(),
      binaryPaths: { 'workers-linux-x64': binaryPath },
      renderers: ['npm'],
      rendererRegistry: {
        npm: fixtureRenderer({
          capture: (input) => {
            capturedInput = input
          },
        }),
      },
      rendererConfig: {
        npm: { packageScope: '@acme' },
      },
      outDir,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rendererInput = capturedInput as ReleaseRendererInput | null
    if (!rendererInput) throw new Error('fixture renderer was not called')
    expect(Object.keys(rendererInput).sort()).toEqual(['binaries', 'config', 'manifest', 'outDir'])
    expect(rendererInput.binaries).toEqual([
      {
        binaryId: 'workers-linux-x64',
        path: binaryPath,
        sha256: binarySha256,
        size: binaryBytes.byteLength,
      },
    ])
    expect(rendererInput.outDir).toBe(join(outDir, 'npm'))
    expect(result.packages).toHaveLength(1)
    expect(result.packageArtifacts).toEqual([
      expect.objectContaining({
        packageId: 'workers-npm-fixture',
        fileName: 'workers-0.1.0.fixture',
        renderer: 'npm',
        ecosystem: 'npm',
        name: '@acme/workers',
        version: '0.1.0',
      }),
    ])
  })

  test('unsupported selected renderers fail before staging artifacts', async () => {
    const outDir = join(tmp, 'unsupported-renderer')
    const result = await packageRelease({
      manifest: baseManifestInput(),
      binaryPaths: { 'workers-linux-x64': binaryPath },
      renderers: ['npm'],
      rendererRegistry: {},
      outDir,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: 'renderer-selection',
        code: 'RENDERER_UNKNOWN',
      }),
    ])
    expect(existsSync(outDir)).toBe(false)
  })

  test('rejects a rendered package artifact whose final bytes do not match the record', async () => {
    const result = await packageRelease({
      manifest: baseManifestInput(),
      binaryPaths: { 'workers-linux-x64': binaryPath },
      renderers: ['npm'],
      rendererRegistry: {
        npm: fixtureRenderer({ artifactSha256: ZERO_HASH }),
      },
      outDir: join(tmp, 'corrupt-artifact'),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        stage: 'package-artifact',
        code: 'PACKAGE_ARTIFACT_HASH_MISMATCH',
      }),
    ])
  })
})
