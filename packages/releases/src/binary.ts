import { createHash } from 'node:crypto'
import type { BinaryTarget, CliReleaseManifest } from './manifest.js'

export type VerifyBinaryInput = {
  manifest: CliReleaseManifest
  binaryPaths: Record<string, string>
}

export type VerifiedBinary = {
  binaryId: string
  path: string
  sha256: string
  size: number
}

export type BinaryVerificationFailureCode =
  | 'BINARY_PATH_MISSING'
  | 'BINARY_PATH_UNKNOWN'
  | 'BINARY_TARGET_UNPARSEABLE'
  | 'BINARY_TARGET_MISMATCH'
  | 'BINARY_READ_FAILED'
  | 'BINARY_SIZE_MISMATCH'
  | 'BINARY_HASH_MISMATCH'

export type BinaryVerificationFailure = {
  binaryId: string
  code: BinaryVerificationFailureCode
  message: string
  details?: Record<string, unknown>
}

export type VerifyBinaryResult =
  | { ok: true; verified: VerifiedBinary[] }
  | { ok: false; failures: BinaryVerificationFailure[] }

type ParsedTarget = {
  platform: BinaryTarget['platform']
  arch: BinaryTarget['arch']
  libc?: 'glibc' | 'musl'
  cpuVariant?: 'baseline' | 'modern'
}

// Closed set of Bun --target values supported by the release verifier.
// Each row is the canonical platform/arch/libc/cpuVariant the manifest
// must agree with. Add a row when Bun ships a new target variant.
// Reference: https://bun.sh/docs/bundler/executables
const BUN_TARGETS: Record<string, ParsedTarget> = {
  'bun-linux-x64': { platform: 'linux', arch: 'x64', libc: 'glibc' },
  'bun-linux-x64-baseline': { platform: 'linux', arch: 'x64', libc: 'glibc', cpuVariant: 'baseline' },
  'bun-linux-x64-musl': { platform: 'linux', arch: 'x64', libc: 'musl' },
  'bun-linux-x64-musl-baseline': { platform: 'linux', arch: 'x64', libc: 'musl', cpuVariant: 'baseline' },
  'bun-linux-arm64': { platform: 'linux', arch: 'arm64', libc: 'glibc' },
  'bun-linux-arm64-musl': { platform: 'linux', arch: 'arm64', libc: 'musl' },
  'bun-darwin-x64': { platform: 'darwin', arch: 'x64' },
  'bun-darwin-x64-baseline': { platform: 'darwin', arch: 'x64', cpuVariant: 'baseline' },
  'bun-darwin-arm64': { platform: 'darwin', arch: 'arm64' },
  'bun-windows-x64': { platform: 'windows', arch: 'x64' },
  'bun-windows-x64-baseline': { platform: 'windows', arch: 'x64', cpuVariant: 'baseline' },
}

function parseBunTarget(target: string): ParsedTarget | null {
  return BUN_TARGETS[target] ?? null
}

function checkTargetNormalization(binary: BinaryTarget): BinaryVerificationFailure | null {
  const parsed = parseBunTarget(binary.target)
  if (!parsed) {
    return {
      binaryId: binary.id,
      code: 'BINARY_TARGET_UNPARSEABLE',
      message: `binary '${binary.id}' has unparseable target '${binary.target}'`,
      details: { target: binary.target },
    }
  }
  const mismatches: Record<string, { manifest: unknown; target: unknown }> = {}
  if (parsed.platform !== binary.platform) {
    mismatches['platform'] = { manifest: binary.platform, target: parsed.platform }
  }
  if (parsed.arch !== binary.arch) {
    mismatches['arch'] = { manifest: binary.arch, target: parsed.arch }
  }
  const manifestLibc = binary.libc
  const parsedLibc = parsed.libc
  if (manifestLibc !== parsedLibc) {
    mismatches['libc'] = { manifest: manifestLibc, target: parsedLibc }
  }
  const manifestVariant = binary.cpuVariant
  const parsedVariant = parsed.cpuVariant
  if (manifestVariant !== parsedVariant) {
    mismatches['cpuVariant'] = { manifest: manifestVariant, target: parsedVariant }
  }
  if (Object.keys(mismatches).length === 0) return null
  return {
    binaryId: binary.id,
    code: 'BINARY_TARGET_MISMATCH',
    message: `binary '${binary.id}' target '${binary.target}' does not agree with platform/arch/libc/cpuVariant`,
    details: { target: binary.target, mismatches },
  }
}

async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function verifyReleaseBinaries(
  input: VerifyBinaryInput,
): Promise<VerifyBinaryResult> {
  const failures: BinaryVerificationFailure[] = []
  const verified: VerifiedBinary[] = []
  const manifestIds = new Set(input.manifest.binaries.map((b) => b.id))

  for (const providedId of Object.keys(input.binaryPaths)) {
    if (!manifestIds.has(providedId)) {
      failures.push({
        binaryId: providedId,
        code: 'BINARY_PATH_UNKNOWN',
        message: `binary path provided for '${providedId}' but no manifest entry exists`,
      })
    }
  }

  const targetFailures: BinaryVerificationFailure[] = []
  for (const binary of input.manifest.binaries) {
    const targetFailure = checkTargetNormalization(binary)
    if (targetFailure) targetFailures.push(targetFailure)
  }
  if (targetFailures.length > 0) {
    return { ok: false, failures: [...failures, ...targetFailures] }
  }

  if (failures.length > 0) {
    return { ok: false, failures }
  }

  for (const binary of input.manifest.binaries) {
    const path = input.binaryPaths[binary.id]
    if (!path) {
      failures.push({
        binaryId: binary.id,
        code: 'BINARY_PATH_MISSING',
        message: `no path provided for manifest binary '${binary.id}'`,
      })
      continue
    }
    const bytes = await readBytes(path)
    if (!bytes) {
      failures.push({
        binaryId: binary.id,
        code: 'BINARY_READ_FAILED',
        message: `could not read binary '${binary.id}' from '${path}'`,
        details: { path },
      })
      continue
    }
    const size = bytes.byteLength
    if (size !== binary.size) {
      failures.push({
        binaryId: binary.id,
        code: 'BINARY_SIZE_MISMATCH',
        message: `binary '${binary.id}' size ${size} does not match manifest size ${binary.size}`,
        details: { manifestSize: binary.size, actualSize: size },
      })
      continue
    }
    const sha256 = sha256Hex(bytes)
    if (sha256 !== binary.sha256) {
      failures.push({
        binaryId: binary.id,
        code: 'BINARY_HASH_MISMATCH',
        message: `binary '${binary.id}' sha256 mismatch`,
        details: { manifestSha256: binary.sha256, actualSha256: sha256 },
      })
      continue
    }
    verified.push({ binaryId: binary.id, path, sha256, size })
  }

  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, verified }
}
