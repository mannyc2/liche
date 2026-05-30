import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { CliReleaseManifestSchema, verifyReleaseBinaries } from '../src/index.js'
import type { BinaryTarget, CliReleaseManifest, CliReleaseManifestInput } from '../src/index.js'

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const ZERO_HASH = '0'.repeat(64)

function baseManifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: { description: 'binary verifier test fixture' },
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

function parseManifest(input: CliReleaseManifestInput): CliReleaseManifest {
  const parsed = CliReleaseManifestSchema.safeParse(input)
  if (!parsed.success) throw new Error(`failed to parse manifest: ${parsed.error.message}`)
  return parsed.data
}

function makeBinaryEntry(
  overrides: Partial<BinaryTarget> & {
    id: string
    url: string
    sha256: string
    size: number
  },
): BinaryTarget {
  return {
    target: 'bun-linux-x64',
    platform: 'linux',
    arch: 'x64',
    libc: 'glibc',
    filename: 'workers',
    signed: false,
    notarized: false,
    ...overrides,
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'liche-releases-binary-'))
const paths = {
  signed: join(tmp, 'workers-signed'),
  corrupt: join(tmp, 'workers-corrupt'),
  drifted: join(tmp, 'workers-drifted'),
  missing: join(tmp, 'workers-missing'),
}

let signedHash: string
let signedSize: number
let corruptHash: string
let corruptSize: number
let driftedHash: string
let driftedSize: number

beforeAll(() => {
  // simulate a "signed" mutation BEFORE hashing — manifest records the
  // post-signing bytes, so a verifier that hashed pre-signing bytes would
  // mismatch when reading the final on-disk artifact.
  const unsignedBytes = Buffer.concat([Buffer.from('UNSIGNED-MACHO-HEADER'), randomBytes(2048)])
  const signedBytes = Buffer.concat([
    Buffer.from('SIGNED-MACHO-HEADER--'),
    unsignedBytes.subarray(Buffer.byteLength('UNSIGNED-MACHO-HEADER')),
    Buffer.from('LC_CODE_SIGNATURE-PAYLOAD'),
  ])
  // sanity: bytes really did change
  if (sha256Hex(unsignedBytes) === sha256Hex(signedBytes)) {
    throw new Error('signed mutation did not actually change bytes')
  }
  writeFileSync(paths.signed, signedBytes)
  signedHash = sha256Hex(signedBytes)
  signedSize = signedBytes.byteLength

  const corruptOnDisk = Buffer.concat([signedBytes, Buffer.from('CORRUPTION-TRAILER')])
  writeFileSync(paths.corrupt, corruptOnDisk)
  // manifest will record the *pre-corruption* (signed) hash/size so that
  // the on-disk corrupt artifact fails verification.
  corruptHash = signedHash
  corruptSize = signedSize

  const driftedOnDisk = Buffer.concat([signedBytes, Buffer.from('DRIFT')])
  writeFileSync(paths.drifted, driftedOnDisk)
  // manifest will record the on-disk size but the wrong hash to prove size
  // and hash checks are independent.
  driftedHash = ZERO_HASH
  driftedSize = driftedOnDisk.byteLength
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('verifyReleaseBinaries', () => {
  test('verifies a signed final binary against the manifest', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-darwin-arm64',
          target: 'bun-darwin-arm64',
          platform: 'darwin',
          arch: 'arm64',
          libc: undefined,
          url: 'https://example.test/workers-darwin-arm64',
          sha256: signedHash,
          size: signedSize,
          signed: true,
          notarized: true,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-darwin-arm64': paths.signed },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.verified).toEqual([
      {
        binaryId: 'workers-darwin-arm64',
        path: paths.signed,
        sha256: signedHash,
        size: signedSize,
      },
    ])
  })

  test('rejects corrupted bytes with BINARY_SIZE_MISMATCH when file size changes', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64',
          target: 'bun-linux-x64',
          platform: 'linux',
          arch: 'x64',
          libc: 'glibc',
          url: 'https://example.test/workers-linux-x64',
          sha256: corruptHash,
          size: corruptSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64': paths.corrupt },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    // The manifest records the pre-corruption size, so this should fail at the
    // size step. The separate "drift" scenario below keeps the hash-only path covered.
    expect(result.failures).toEqual([
      expect.objectContaining({
        binaryId: 'workers-linux-x64',
        code: 'BINARY_SIZE_MISMATCH',
      }),
    ])
  })

  test('rejects drifted bytes with BINARY_HASH_MISMATCH when manifest size matches the on-disk file', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64',
          target: 'bun-linux-x64',
          platform: 'linux',
          arch: 'x64',
          libc: 'glibc',
          url: 'https://example.test/workers-linux-x64',
          sha256: driftedHash,
          size: driftedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64': paths.drifted },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        binaryId: 'workers-linux-x64',
        code: 'BINARY_HASH_MISMATCH',
      }),
    ])
  })

  test('a pre-signing hash never agrees with the post-signing file bytes', async () => {
    // Demonstrates that a hypothetical implementation that hashed bytes
    // before the simulated signing step would have recorded a different
    // hash; the verifier reading the post-signing file bytes must
    // disagree with that hash.
    const fakePreSigningHash = sha256Hex(Buffer.from('UNSIGNED-MACHO-HEADER-WHATEVER-PRE-SIGNING-BYTES'))
    expect(fakePreSigningHash).not.toBe(signedHash)
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-darwin-arm64',
          target: 'bun-darwin-arm64',
          platform: 'darwin',
          arch: 'arm64',
          libc: undefined,
          url: 'https://example.test/workers-darwin-arm64',
          sha256: fakePreSigningHash,
          size: signedSize,
          signed: true,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-darwin-arm64': paths.signed },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_HASH_MISMATCH')
  })

  test('reports BINARY_READ_FAILED when the path does not exist', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64',
          url: 'https://example.test/workers-linux-x64',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64': paths.missing },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_READ_FAILED')
  })

  test('reports BINARY_PATH_MISSING when manifest has a binary with no provided path', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64',
          url: 'https://example.test/workers-linux-x64',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({ manifest, binaryPaths: {} })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_PATH_MISSING')
  })

  test('reports BINARY_PATH_UNKNOWN when a path is supplied for an unknown binary id', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64',
          url: 'https://example.test/workers-linux-x64',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: {
        'workers-linux-x64': paths.signed,
        'workers-unknown': paths.signed,
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.some((f) => f.code === 'BINARY_PATH_UNKNOWN')).toBe(true)
  })
})

describe('target normalization', () => {
  test('platform mismatch with target fails before any bytes are read', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-darwin-arm64',
          target: 'bun-linux-arm64', // platform says linux
          platform: 'darwin', // manifest says darwin
          arch: 'arm64',
          libc: undefined,
          url: 'https://example.test/workers-darwin-arm64',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      // path intentionally points at the wrong file so any byte read
      // would also fail — but target check should come first.
      binaryPaths: { 'workers-darwin-arm64': paths.missing },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        binaryId: 'workers-darwin-arm64',
        code: 'BINARY_TARGET_MISMATCH',
      }),
    ])
  })

  test('arch mismatch with target fails before any bytes are read', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64',
          target: 'bun-linux-arm64',
          platform: 'linux',
          arch: 'x64',
          libc: 'glibc',
          url: 'https://example.test/workers-linux-x64',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64': paths.missing },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_TARGET_MISMATCH')
  })

  test('libc mismatch with target fails before any bytes are read', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64-musl',
          target: 'bun-linux-x64-musl',
          platform: 'linux',
          arch: 'x64',
          libc: 'glibc', // disagrees with target's -musl
          url: 'https://example.test/workers-linux-x64-musl',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64-musl': paths.missing },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_TARGET_MISMATCH')
  })

  test('cpuVariant mismatch with target fails before any bytes are read', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64-baseline',
          target: 'bun-linux-x64-baseline',
          platform: 'linux',
          arch: 'x64',
          libc: 'glibc',
          cpuVariant: 'modern', // disagrees with target -baseline
          url: 'https://example.test/workers-linux-x64-baseline',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64-baseline': paths.missing },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_TARGET_MISMATCH')
  })

  test('unparseable target string fails before any bytes are read', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-mystery',
          target: 'totally-bogus-target',
          platform: 'linux',
          arch: 'x64',
          libc: 'glibc',
          url: 'https://example.test/workers-mystery',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-mystery': paths.missing },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('BINARY_TARGET_UNPARSEABLE')
  })

  test('agreeing target normalizes through without mismatch', async () => {
    const manifest = parseManifest({
      ...baseManifestInput(),
      binaries: [
        makeBinaryEntry({
          id: 'workers-linux-x64-musl',
          target: 'bun-linux-x64-musl',
          platform: 'linux',
          arch: 'x64',
          libc: 'musl',
          url: 'https://example.test/workers-linux-x64-musl',
          sha256: signedHash,
          size: signedSize,
        }),
      ],
    })

    const result = await verifyReleaseBinaries({
      manifest,
      binaryPaths: { 'workers-linux-x64-musl': paths.signed },
    })

    expect(result.ok).toBe(true)
  })
})
