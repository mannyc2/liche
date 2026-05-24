import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { VerifiedPackageArtifact } from './artifacts.js'
import type { ReleaseDistConfig, ReleaseHost } from './manifest-from-build-record.js'
import type { CliReleaseManifest, PackageEcosystem, PackageRecord } from './manifest.js'
import type { GitRepoTarget, PublisherConfigMap, PublishSelection } from './publishers/index.js'
import { PACKAGE_ECOSYSTEMS } from './renderers/index.js'
import type { RendererConfigMap, RendererSelection } from './renderers/index.js'

const GitHubRepository = z.string().regex(/^[^/\s]+\/[^/\s]+$/)

const EcosystemsSchema = z.object({
  npm: z.object({
    package: z.string(),
    scope: z.string().optional(),
  }).strict().optional(),
  pypi: z.object({
    distribution: z.string(),
  }).strict().optional(),
  homebrew: z.object({
    tap: GitHubRepository,
    formula: z.string().optional(),
    branch: z.string().optional(),
  }).strict().optional(),
  scoop: z.object({
    bucket: GitHubRepository,
    manifest: z.string().optional(),
    branch: z.string().optional(),
  }).strict().optional(),
}).strict().default({})

const PublishersSchema = z.object({
  npm: z.object({
    registry: z.string().optional(),
    tag: z.string().optional(),
    access: z.enum(['public', 'restricted']).optional(),
  }).strict().optional(),
  pypi: z.object({
    repositoryUrl: z.string().optional(),
  }).strict().optional(),
  homebrew: z.object({
    tap: GitHubRepository.optional(),
    branch: z.string().optional(),
    formulaPath: z.string().optional(),
  }).strict().optional(),
  scoop: z.object({
    bucket: GitHubRepository.optional(),
    branch: z.string().optional(),
    manifestPath: z.string().optional(),
  }).strict().optional(),
  github: z.object({
    repository: GitHubRepository.optional(),
    tag: z.string().optional(),
  }).strict().optional(),
}).strict().default({})

const ContractSchema = z.object({
  kind: z.enum(['product-catalog', 'core-command-manifest']),
}).strict()

export const ReleasesConfigSchema = z.object({
  subject: z.object({
    id: z.string(),
    name: z.string().optional(),
    command: z.string().optional(),
  }).strict().optional(),
  metadata: z.object({
    description: z.string(),
    homepage: z.string().url().optional(),
    license: z.string().optional(),
    repository: z.string().optional(),
  }).strict().optional(),
  host: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('github-assets'),
      repository: GitHubRepository,
      tag: z.string().optional(),
    }).strict(),
    z.object({
      kind: z.literal('url-template'),
      template: z.string(),
    }).strict(),
  ]).optional(),
  filenameTemplate: z.string().optional(),
  contract: ContractSchema.optional(),
  ecosystems: EcosystemsSchema,
  publishers: PublishersSchema,
}).strict()

export type ReleasesConfig = z.infer<typeof ReleasesConfigSchema>
export type ReleasesConfigInput = z.input<typeof ReleasesConfigSchema>

export type CliPublishSelection = {
  packageSelection: PublishSelection
  github: boolean
}

export function defineReleasesConfig(config: ReleasesConfigInput): ReleasesConfigInput {
  return config
}

const PACKAGE_ECOSYSTEM_SET = new Set<string>(PACKAGE_ECOSYSTEMS)

function repoMetadata(repository: string | undefined): ReleaseDistConfig['metadata']['repository'] | undefined {
  if (!repository) return undefined
  return {
    type: 'git',
    url: repository.startsWith('http') ? repository : `https://github.com/${repository}.git`,
  }
}

function requireSection<T>(value: T | undefined, name: string): T {
  if (value !== undefined) return value
  throw new Error(`liche.releases.json is missing '${name}'`)
}

export function distConfigFromReleasesConfig(config: ReleasesConfig): ReleaseDistConfig {
  const subject = requireSection(config.subject, 'subject')
  const metadata = requireSection(config.metadata, 'metadata')
  const host = requireSection(config.host, 'host') as ReleaseHost
  const distMetadata: ReleaseDistConfig['metadata'] = {
    description: metadata.description,
    ...(metadata.homepage ? { homepage: metadata.homepage } : {}),
    ...(metadata.license ? { license: metadata.license } : {}),
  }
  const repository = repoMetadata(metadata.repository)
  if (repository) distMetadata.repository = repository
  const out: ReleaseDistConfig = {
    subject: {
      id: subject.id,
      name: subject.name ?? subject.id,
      ...(subject.command ? { command: subject.command } : {}),
    },
    metadata: distMetadata,
    host,
    release: { generatorVersion: '0.2.0' },
  }
  if (config.contract) out.contract = config.contract
  if (config.filenameTemplate) out.filenameTemplate = config.filenameTemplate
  return out
}

export function rendererConfigFromReleasesConfig(config: ReleasesConfig): RendererConfigMap | undefined {
  const renderers: RendererConfigMap = {}
  if (config.ecosystems.npm) {
    renderers.npm = {
      packageName: config.ecosystems.npm.package,
      ...(config.ecosystems.npm.scope ? { packageScope: config.ecosystems.npm.scope } : {}),
    }
  }
  if (config.ecosystems.pypi) {
    renderers.pypi = { distribution: config.ecosystems.pypi.distribution }
  }
  if (config.ecosystems.homebrew) {
    renderers.homebrew = config.ecosystems.homebrew.formula
      ? { formulaName: config.ecosystems.homebrew.formula }
      : {}
  }
  if (config.ecosystems.scoop) {
    renderers.scoop = config.ecosystems.scoop.manifest
      ? { manifestName: config.ecosystems.scoop.manifest }
      : {}
  }
  return Object.keys(renderers).length > 0 ? renderers : undefined
}

export function rendererSelectionFromReleasesConfig(config: ReleasesConfig): RendererSelection {
  return PACKAGE_ECOSYSTEMS.filter((ecosystem) => config.ecosystems[ecosystem] !== undefined)
}

function gitRepoTarget(value: string, branch: string | undefined): GitRepoTarget {
  const [owner, repo] = value.split('/')
  if (!owner || !repo) throw new Error(`repository target expects '<owner>/<repo>', got '${value}'`)
  return { owner, repo, ...(branch ? { branch } : {}) }
}

export function publisherConfigFromReleasesConfig(config: ReleasesConfig): PublisherConfigMap | undefined {
  const publishers: PublisherConfigMap = {}
  if (config.publishers.npm) {
    publishers.npm = {
      ...(config.publishers.npm.registry ? { registry: config.publishers.npm.registry } : {}),
      ...(config.publishers.npm.tag ? { tag: config.publishers.npm.tag } : {}),
      ...(config.publishers.npm.access ? { access: config.publishers.npm.access } : {}),
    }
  }
  if (config.publishers.pypi) {
    publishers.pypi = {
      ...(config.publishers.pypi.repositoryUrl ? { repositoryUrl: config.publishers.pypi.repositoryUrl } : {}),
    }
  }

  const homebrewTap = config.publishers.homebrew?.tap ?? config.ecosystems.homebrew?.tap
  if (homebrewTap) {
    publishers.homebrew = {
      tap: gitRepoTarget(homebrewTap, config.publishers.homebrew?.branch ?? config.ecosystems.homebrew?.branch),
      ...(config.publishers.homebrew?.formulaPath ? { formulaPath: config.publishers.homebrew.formulaPath } : {}),
    }
  }

  const scoopBucket = config.publishers.scoop?.bucket ?? config.ecosystems.scoop?.bucket
  if (scoopBucket) {
    publishers.scoop = {
      bucket: gitRepoTarget(scoopBucket, config.publishers.scoop?.branch ?? config.ecosystems.scoop?.branch),
      ...(config.publishers.scoop?.manifestPath ? { manifestPath: config.publishers.scoop.manifestPath } : {}),
    }
  }

  return Object.keys(publishers).length > 0 ? publishers : undefined
}

export function parsePublishSelection(value: string): CliPublishSelection {
  const trimmed = value.trim()
  if (trimmed === 'all') return { packageSelection: 'all', github: false }

  const seen = new Set<string>()
  const packageSelection: PackageEcosystem[] = []
  let github = false
  for (const part of trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    if (seen.has(part)) throw new Error(`ecosystem '${part}' was selected more than once`)
    seen.add(part)
    if (part === 'github') {
      github = true
      continue
    }
    if (!PACKAGE_ECOSYSTEM_SET.has(part)) throw new Error(`unknown ecosystem '${part}'`)
    packageSelection.push(part as PackageEcosystem)
  }
  if (seen.size === 0) throw new Error(`--ecosystems must be 'all' or a comma-separated list`)
  return { packageSelection, github }
}

function artifactPath(manifestPath: string, record: PackageRecord): string {
  const artifact = record.artifact
  if (!artifact) return ''
  const root = dirname(manifestPath)
  if (record.ecosystem === 'npm') return join(root, 'packages', 'npm', 'tarballs', artifact.fileName)
  return join(root, 'packages', record.ecosystem, artifact.fileName)
}

export function artifactsFromManifest(
  manifest: CliReleaseManifest,
  manifestPath: string,
): VerifiedPackageArtifact[] {
  return manifest.packages
    .filter((record) => record.artifact !== undefined)
    .map((record) => ({
      packageId: record.id,
      path: artifactPath(manifestPath, record),
      fileName: record.artifact!.fileName,
      sha256: record.artifact!.sha256,
      size: record.artifact!.size,
      renderer: record.renderer,
      ecosystem: record.ecosystem,
      kind: record.kind,
      name: record.name,
      version: record.version,
    }))
}

function applyTemplate(template: string, manifest: CliReleaseManifest): string {
  return template.replace(/\{version\}/g, manifest.release.version)
}

export function githubReleaseTarget(
  config: ReleasesConfig,
  manifest: CliReleaseManifest,
): { repository: string; tag: string } | undefined {
  if (config.publishers.github?.repository) {
    return {
      repository: config.publishers.github.repository,
      tag: applyTemplate(config.publishers.github.tag ?? `v{version}`, manifest),
    }
  }
  if (config.host?.kind === 'github-assets') {
    return {
      repository: config.host.repository,
      tag: applyTemplate(config.host.tag ?? `v{version}`, manifest),
    }
  }
  const url = manifest.binaries[0]?.url
  const match = url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\//)
  return match ? { repository: match[1]!, tag: match[2]! } : undefined
}
