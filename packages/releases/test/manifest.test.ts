import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  CliReleaseManifestSchema,
  parseCliReleaseManifest,
} from '../src/index.js'
import type { CliReleaseManifest } from '../src/index.js'

const FIXTURE_PATH = join(import.meta.dir, 'fixtures', 'workers.release-manifest.json')

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
}

function parseFixture(): CliReleaseManifest {
  const result = parseCliReleaseManifest(loadFixture())
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${result.error.message}`)
  }
  return result.manifest
}

describe('fixture manifest', () => {
  test('parses successfully', () => {
    const result = parseCliReleaseManifest(loadFixture())
    expect(result.ok).toBe(true)
  })

  test('records metadata and executable metadata', () => {
    const manifest = parseFixture()
    expect(manifest.metadata.description.length).toBeGreaterThan(0)
    expect(manifest.metadata.license).toBeDefined()
    expect(manifest.metadata.homepage).toBeDefined()
    expect(manifest.metadata.executable?.title).toBeDefined()
    expect(manifest.metadata.executable?.publisher).toBeDefined()
    expect(manifest.metadata.executable?.windows?.iconSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  test('records release subject and contract provenance', () => {
    const manifest = parseFixture()
    expect(manifest.subject.id).toBe('workers')
    expect(manifest.subject.name).toBe('Workers CLI')
    expect(manifest.subject.version).toBe('0.1.0')
    expect(manifest.subject.commit.length).toBeGreaterThan(0)
    expect(manifest.subject.contract).toEqual(
      expect.objectContaining({
        kind: 'product-catalog',
        digest: expect.stringMatching(/^sha256:/),
      }),
    )
  })

  test('records runtime env and config expectations', () => {
    const manifest = parseFixture()
    expect(manifest.runtime.command).toBe('workers')
    expect(manifest.runtime.env.length).toBeGreaterThan(0)
    expect(manifest.runtime.env.some((e) => e.required)).toBe(true)
    expect(manifest.runtime.config.length).toBeGreaterThan(0)
  })

  test('records at least one conformance-metadata case', () => {
    const manifest = parseFixture()
    expect(manifest.conformance).toBeDefined()
    expect(manifest.conformance?.required).toBe(true)
    expect(manifest.conformance?.reportSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.conformance?.summary?.total).toBeGreaterThan(0)
  })

  test('includes at least one glibc and one musl binary', () => {
    const manifest = parseFixture()
    const linux = manifest.binaries.filter((b) => b.platform === 'linux')
    expect(linux.some((b) => b.libc === 'glibc')).toBe(true)
    expect(linux.some((b) => b.libc === 'musl')).toBe(true)
  })

  test('includes at least one baseline x64 target', () => {
    const manifest = parseFixture()
    expect(
      manifest.binaries.some((b) => b.arch === 'x64' && b.cpuVariant === 'baseline'),
    ).toBe(true)
  })
})

describe('schema rejection', () => {
  test('rejects unknown manifestVersion', () => {
    const m = loadFixture() as { manifestVersion: number }
    m.manifestVersion = 2
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects missing required metadata.description', () => {
    const m = loadFixture() as { metadata: { description?: string } }
    delete m.metadata.description
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects malformed subject contract digest type', () => {
    const m = loadFixture() as { subject: { contract: { digest: unknown } } }
    m.subject.contract.digest = 42
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects unknown subject contract kind', () => {
    const m = loadFixture() as { subject: { contract: { kind: string } } }
    m.subject.contract.kind = 'unknown-contract'
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects an invalid release channel', () => {
    const m = loadFixture() as { release: { channel: string } }
    m.release.channel = 'beta'
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects an invalid platform value on a binary', () => {
    const m = loadFixture() as { binaries: Array<{ platform: string }> }
    m.binaries[0]!.platform = 'plan9'
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects a non-hex sha256', () => {
    const m = loadFixture() as { binaries: Array<{ sha256: string }> }
    m.binaries[0]!.sha256 = 'not-a-hash'
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects a non-url binary url', () => {
    const m = loadFixture() as { binaries: Array<{ url: string }> }
    m.binaries[0]!.url = 'not a url'
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects negative binary size', () => {
    const m = loadFixture() as { binaries: Array<{ size: number }> }
    m.binaries[0]!.size = -1
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects an unknown auth provider kind', () => {
    const m = loadFixture() as { auth?: { providers: Array<{ kind: string }> } }
    if (m.auth) m.auth.providers[0]!.kind = 'custom'
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects an unknown renderer on a package record', () => {
    const m = loadFixture() as {
      packages: Array<{ renderer: string; ecosystem: string; id: string; kind: string; name: string; version: string }>
    }
    m.packages = [
      {
        id: 'umbrella',
        renderer: 'flatpak',
        ecosystem: 'flatpak',
        kind: 'umbrella',
        name: 'workers',
        version: '0.1.0',
      },
    ]
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(false)
  })

  test('rejects a non-object payload', () => {
    const result = parseCliReleaseManifest('not an object')
    expect(result.ok).toBe(false)
  })
})

describe('schema defaults', () => {
  test('release.channel defaults to stable when omitted', () => {
    const m = loadFixture() as { release: { channel?: string } }
    delete m.release.channel
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.release.channel).toBe('stable')
  })

  test('packages defaults to empty when omitted', () => {
    const m = loadFixture() as { packages?: unknown }
    delete m.packages
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.packages).toEqual([])
  })

  test('runtime env defaults required=false when omitted on an entry', () => {
    const m = loadFixture() as {
      runtime: { env: Array<{ name: string; purpose: string; required?: boolean }> }
    }
    m.runtime.env = [{ name: 'WORKERS_API_URL', purpose: 'Remote dispatch base URL' }]
    const result = parseCliReleaseManifest(m)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.runtime.env[0]?.required).toBe(false)
  })
})

describe('exported schema', () => {
  test('CliReleaseManifestSchema accepts the fixture directly', () => {
    const parsed = CliReleaseManifestSchema.safeParse(loadFixture())
    expect(parsed.success).toBe(true)
  })
})
