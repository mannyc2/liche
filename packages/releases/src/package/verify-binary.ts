import { verifyBytesAt } from '../internal/verify.js'
import type { BinaryTarget, CliReleaseManifest } from '../manifest/index.js'

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

const TARGET_FIELDS = ['platform', 'arch', 'libc', 'cpuVariant'] as const

function targetMismatches(
  binary: BinaryTarget,
  parsed: ParsedTarget,
): Partial<Record<(typeof TARGET_FIELDS)[number], { manifest: unknown; target: unknown }>> {
  const mismatches: Partial<Record<(typeof TARGET_FIELDS)[number], { manifest: unknown; target: unknown }>> = {}
  for (const field of TARGET_FIELDS) {
    if (binary[field] !== parsed[field]) {
      mismatches[field] = { manifest: binary[field], target: parsed[field] }
    }
  }
  return mismatches
}

function checkTargetNormalization(binary: BinaryTarget): BinaryVerificationFailure | null {
  const parsed = BUN_TARGETS[binary.target]
  if (!parsed) {
    return {
      binaryId: binary.id,
      code: 'BINARY_TARGET_UNPARSEABLE',
      message: `binary '${binary.id}' has unparseable target '${binary.target}'`,
      details: { target: binary.target },
    }
  }
  const mismatches = targetMismatches(binary, parsed)
  if (Object.keys(mismatches).length === 0) return null
  return {
    binaryId: binary.id,
    code: 'BINARY_TARGET_MISMATCH',
    message: `binary '${binary.id}' target '${binary.target}' does not agree with platform/arch/libc/cpuVariant`,
    details: { target: binary.target, mismatches },
  }
}

function unknownBinaryPathFailures(input: VerifyBinaryInput): BinaryVerificationFailure[] {
  const manifestIds = new Set(input.manifest.binaries.map((binary) => binary.id))
  return Object.keys(input.binaryPaths)
    .filter((providedId) => !manifestIds.has(providedId))
    .map((providedId) => ({
      binaryId: providedId,
      code: 'BINARY_PATH_UNKNOWN',
      message: `binary path provided for '${providedId}' but no manifest entry exists`,
    }))
}

function preflightFailures(input: VerifyBinaryInput): BinaryVerificationFailure[] {
  return [
    ...unknownBinaryPathFailures(input),
    ...input.manifest.binaries.map(checkTargetNormalization).filter((f): f is BinaryVerificationFailure => f !== null),
  ]
}

function bytesFailure(
  binary: BinaryTarget,
  path: string,
  kind: 'read' | 'size' | 'sha256',
  actual?: { size?: number; sha256?: string },
): BinaryVerificationFailure {
  if (kind === 'read') {
    return {
      binaryId: binary.id,
      code: 'BINARY_READ_FAILED',
      message: `could not read binary '${binary.id}' from '${path}'`,
      details: { path },
    }
  }
  if (kind === 'size') {
    return {
      binaryId: binary.id,
      code: 'BINARY_SIZE_MISMATCH',
      message: `binary '${binary.id}' size ${actual!.size} does not match manifest size ${binary.size}`,
      details: { manifestSize: binary.size, actualSize: actual!.size },
    }
  }
  return {
    binaryId: binary.id,
    code: 'BINARY_HASH_MISMATCH',
    message: `binary '${binary.id}' sha256 mismatch`,
    details: { manifestSha256: binary.sha256, actualSha256: actual!.sha256 },
  }
}

export async function verifyReleaseBinaries(input: VerifyBinaryInput): Promise<VerifyBinaryResult> {
  const pre = preflightFailures(input)
  if (pre.length > 0) return { ok: false, failures: pre }

  const failures: BinaryVerificationFailure[] = []
  const verified: VerifiedBinary[] = []
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
    const result = await verifyBytesAt(path, { sha256: binary.sha256, size: binary.size })
    if (!result.ok) {
      failures.push(
        bytesFailure(
          binary,
          path,
          result.kind,
          result.kind === 'size'
            ? { size: result.size }
            : result.kind === 'sha256'
              ? { sha256: result.sha256 }
              : undefined,
        ),
      )
      continue
    }
    verified.push({ binaryId: binary.id, path, sha256: result.sha256, size: result.size })
  }

  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, verified }
}
