import { join } from 'node:path'
import type { VerifiedPackageArtifact } from './package/index.js'
import type { PackageRecord } from './manifest/index.js'

export type OfficialFlowNpmPackageDir = {
  packageId: string
  name: string
  role: 'platform' | 'umbrella'
  path: string
}

export type OfficialFlowArtifact = {
  packageId: string
  name: string
  path: string
  fileName: string
  sha256: string
  size: number
}

export type OfficialFlowHandoff = {
  handoffVersion: 1
  npm?: {
    packageDirs: OfficialFlowNpmPackageDir[]
  }
  pypi?: {
    packagesDir: string
    artifacts: OfficialFlowArtifact[]
  }
  homebrew?: {
    formulae: OfficialFlowArtifact[]
  }
  scoop?: {
    manifests: OfficialFlowArtifact[]
  }
}

export type CreateOfficialFlowHandoffInput = {
  packageRoot: string
  packages: readonly PackageRecord[]
  packageArtifacts: readonly VerifiedPackageArtifact[]
}

function npmPackageDirName(packageName: string): string {
  return packageName.replace(/^@/, '').replace(/\//g, '-')
}

function npmRole(record: PackageRecord): 'platform' | 'umbrella' {
  return record.kind === 'npm-umbrella' ? 'umbrella' : 'platform'
}

function artifactRecords(
  packageArtifacts: readonly VerifiedPackageArtifact[],
  ecosystem: PackageRecord['ecosystem'],
): OfficialFlowArtifact[] {
  return packageArtifacts
    .filter((artifact) => artifact.ecosystem === ecosystem)
    .map((artifact) => ({
      packageId: artifact.packageId,
      name: artifact.name,
      path: artifact.path,
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      size: artifact.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.fileName.localeCompare(b.fileName))
}

function npmPackageDirs(
  packageRoot: string,
  packages: readonly PackageRecord[],
): OfficialFlowNpmPackageDir[] {
  return packages
    .filter((record) => record.ecosystem === 'npm')
    .map((record) => ({
      packageId: record.id,
      name: record.name,
      role: npmRole(record),
      path: join(packageRoot, 'npm', 'package-dirs', npmPackageDirName(record.name)),
    }))
    .sort((a, b) =>
      a.role === b.role
        ? a.name.localeCompare(b.name)
        : a.role === 'platform'
          ? -1
          : 1
    )
}

export function createOfficialFlowHandoff(
  input: CreateOfficialFlowHandoffInput,
): OfficialFlowHandoff {
  const handoff: OfficialFlowHandoff = { handoffVersion: 1 }

  const npm = npmPackageDirs(input.packageRoot, input.packages)
  if (npm.length > 0) handoff.npm = { packageDirs: npm }

  const pypi = artifactRecords(input.packageArtifacts, 'pypi')
  if (pypi.length > 0) {
    handoff.pypi = {
      packagesDir: join(input.packageRoot, 'pypi'),
      artifacts: pypi,
    }
  }

  const homebrew = artifactRecords(input.packageArtifacts, 'homebrew')
  if (homebrew.length > 0) handoff.homebrew = { formulae: homebrew }

  const scoop = artifactRecords(input.packageArtifacts, 'scoop')
  if (scoop.length > 0) handoff.scoop = { manifests: scoop }

  return handoff
}
