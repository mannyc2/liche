import type { CliReleaseManifest, PackageArtifact, PackageRecord } from './manifest/index.js'

export type YankPackagePlan = {
  packageId: string
  renderer: PackageRecord['renderer']
  ecosystem: PackageRecord['ecosystem']
  kind: string
  name: string
  version: string
  artifact?: PackageArtifact
  publish?: PackageRecord['publish']
}

export type ReleaseYankPlan = {
  dryRun: true
  manifestVersion: CliReleaseManifest['manifestVersion']
  releaseVersion: string
  subject: {
    id: string
    name: string
    version: string
  }
  packages: YankPackagePlan[]
}

function yankPackage(record: PackageRecord): YankPackagePlan {
  const plan: YankPackagePlan = {
    packageId: record.id,
    renderer: record.renderer,
    ecosystem: record.ecosystem,
    kind: record.kind,
    name: record.name,
    version: record.version,
  }
  if (record.artifact) plan.artifact = record.artifact
  if (record.publish) plan.publish = record.publish
  return plan
}

export function planReleaseYank(manifest: CliReleaseManifest): ReleaseYankPlan {
  return {
    dryRun: true,
    manifestVersion: manifest.manifestVersion,
    releaseVersion: manifest.release.version,
    subject: {
      id: manifest.subject.id,
      name: manifest.subject.name,
      version: manifest.subject.version,
    },
    packages: manifest.packages.map(yankPackage),
  }
}
