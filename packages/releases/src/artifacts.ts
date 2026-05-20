import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { PackageRecord } from './manifest.js'
import type { RenderPackageArtifact } from './renderers/index.js'

export type VerifiedPackageArtifact = {
  packageId: string
  path: string
  fileName: string
  sha256: string
  size: number
  renderer: PackageRecord['renderer']
  ecosystem: PackageRecord['ecosystem']
  kind: string
  name: string
  version: string
}

export type PackageArtifactVerificationFailureCode =
  | 'PACKAGE_RECORD_DUPLICATE'
  | 'PACKAGE_ARTIFACT_DUPLICATE'
  | 'PACKAGE_ARTIFACT_UNKNOWN'
  | 'PACKAGE_ARTIFACT_MISSING'
  | 'PACKAGE_ARTIFACT_METADATA_MISSING'
  | 'PACKAGE_ARTIFACT_READ_FAILED'
  | 'PACKAGE_ARTIFACT_FILENAME_MISMATCH'
  | 'PACKAGE_ARTIFACT_SIZE_MISMATCH'
  | 'PACKAGE_ARTIFACT_HASH_MISMATCH'

export type PackageArtifactVerificationFailure = {
  packageId: string
  code: PackageArtifactVerificationFailureCode
  message: string
  details?: Record<string, unknown>
}

export type VerifyPackageArtifactsInput = {
  packages: readonly PackageRecord[]
  artifacts: readonly RenderPackageArtifact[]
}

export type VerifyPackageArtifactsResult =
  | { ok: true; verified: VerifiedPackageArtifact[] }
  | { ok: false; failures: PackageArtifactVerificationFailure[] }

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

function indexPackageRecords(
  packages: readonly PackageRecord[],
  failures: PackageArtifactVerificationFailure[],
): Map<string, PackageRecord> {
  const records = new Map<string, PackageRecord>()
  for (const record of packages) {
    if (records.has(record.id)) {
      failures.push({
        packageId: record.id,
        code: 'PACKAGE_RECORD_DUPLICATE',
        message: `package record '${record.id}' appears more than once`,
      })
      continue
    }
    records.set(record.id, record)
  }
  return records
}

function indexArtifacts(
  artifacts: readonly RenderPackageArtifact[],
  records: Map<string, PackageRecord>,
  failures: PackageArtifactVerificationFailure[],
): Map<string, RenderPackageArtifact> {
  const byPackageId = new Map<string, RenderPackageArtifact>()
  for (const artifact of artifacts) {
    if (byPackageId.has(artifact.packageId)) {
      failures.push({
        packageId: artifact.packageId,
        code: 'PACKAGE_ARTIFACT_DUPLICATE',
        message: `package artifact '${artifact.packageId}' appears more than once`,
      })
      continue
    }

    const record = records.get(artifact.packageId)
    if (!record) {
      failures.push({
        packageId: artifact.packageId,
        code: 'PACKAGE_ARTIFACT_UNKNOWN',
        message: `package artifact '${artifact.packageId}' has no matching package record`,
      })
      continue
    }
    if (!record.artifact) {
      failures.push({
        packageId: artifact.packageId,
        code: 'PACKAGE_ARTIFACT_METADATA_MISSING',
        message: `package record '${artifact.packageId}' does not include artifact metadata`,
      })
      continue
    }

    byPackageId.set(artifact.packageId, artifact)
  }
  return byPackageId
}

function missingArtifactFailures(
  records: Map<string, PackageRecord>,
  artifacts: Map<string, RenderPackageArtifact>,
): PackageArtifactVerificationFailure[] {
  const failures: PackageArtifactVerificationFailure[] = []
  for (const record of records.values()) {
    if (!record.artifact) continue
    if (artifacts.has(record.id)) continue
    failures.push({
      packageId: record.id,
      code: 'PACKAGE_ARTIFACT_MISSING',
      message: `package record '${record.id}' has artifact metadata but no rendered artifact path`,
    })
  }
  return failures
}

export async function verifyPackageArtifacts(
  input: VerifyPackageArtifactsInput,
): Promise<VerifyPackageArtifactsResult> {
  const failures: PackageArtifactVerificationFailure[] = []
  const records = indexPackageRecords(input.packages, failures)
  const artifacts = indexArtifacts(input.artifacts, records, failures)
  failures.push(...missingArtifactFailures(records, artifacts))
  if (failures.length > 0) return { ok: false, failures }

  const verified: VerifiedPackageArtifact[] = []
  for (const [packageId, rendered] of artifacts) {
    const record = records.get(packageId)
    const expected = record?.artifact
    if (!record || !expected) continue

    const actualFileName = basename(rendered.path)
    if (actualFileName !== expected.fileName) {
      failures.push({
        packageId,
        code: 'PACKAGE_ARTIFACT_FILENAME_MISMATCH',
        message: `package artifact '${packageId}' filename '${actualFileName}' does not match manifest filename '${expected.fileName}'`,
        details: { manifestFileName: expected.fileName, actualFileName },
      })
      continue
    }

    const bytes = await readBytes(rendered.path)
    if (!bytes) {
      failures.push({
        packageId,
        code: 'PACKAGE_ARTIFACT_READ_FAILED',
        message: `could not read package artifact '${packageId}' from '${rendered.path}'`,
        details: { path: rendered.path },
      })
      continue
    }

    const size = bytes.byteLength
    if (size !== expected.size) {
      failures.push({
        packageId,
        code: 'PACKAGE_ARTIFACT_SIZE_MISMATCH',
        message: `package artifact '${packageId}' size ${size} does not match manifest size ${expected.size}`,
        details: { manifestSize: expected.size, actualSize: size },
      })
      continue
    }

    const sha256 = sha256Hex(bytes)
    if (sha256 !== expected.sha256) {
      failures.push({
        packageId,
        code: 'PACKAGE_ARTIFACT_HASH_MISMATCH',
        message: `package artifact '${packageId}' sha256 mismatch`,
        details: { manifestSha256: expected.sha256, actualSha256: sha256 },
      })
      continue
    }

    verified.push({
      packageId,
      path: rendered.path,
      fileName: expected.fileName,
      sha256,
      size,
      renderer: record.renderer,
      ecosystem: record.ecosystem,
      kind: record.kind,
      name: record.name,
      version: record.version,
    })
  }

  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, verified }
}
