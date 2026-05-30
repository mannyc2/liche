import type { BuildRecord, RecordedBinary } from './build-record.js'
import type { CliReleaseManifestInput } from './schema.js'

export type ReleaseHost =
  | { kind: 'github-assets'; repository: string; tag?: string }
  | { kind: 'url-template'; template: string }

export type ReleaseSubject = {
  id: string
  name: string
  command?: string
}

export type ReleaseMetadata = {
  description: string
  homepage?: string
  license?: string
  repository?: { type: string; url: string }
}

export type ReleaseEnvelope = {
  channel?: 'stable' | 'next' | 'canary'
  createdAt?: string
  generatorVersion: string
  buildId?: string
}

export type ReleaseDistConfig = {
  subject: ReleaseSubject
  metadata: ReleaseMetadata
  host: ReleaseHost
  release: ReleaseEnvelope
  contract?: { kind: 'product-catalog' | 'core-command-manifest' }
  filenameTemplate?: string
}

const DEFAULT_FILENAME_TEMPLATE = '{command}-{id}{ext}'
const DEFAULT_GITHUB_TAG_TEMPLATE = 'v{version}'

function applyTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = variables[key]
    return value === undefined ? match : value
  })
}

function publicFilename(binary: RecordedBinary, command: string, template: string): string {
  const ext = binary.filename.includes('.') ? `.${binary.filename.split('.').pop()}` : ''
  return applyTemplate(template, {
    command,
    id: binary.id,
    target: binary.target,
    platform: binary.platform,
    arch: binary.arch,
    ext,
    filename: binary.filename,
  })
}

function urlFor(host: ReleaseHost, variables: Record<string, string>): string {
  if (host.kind === 'github-assets') {
    const tag = applyTemplate(host.tag ?? DEFAULT_GITHUB_TAG_TEMPLATE, variables)
    return `https://github.com/${host.repository}/releases/download/${tag}/${variables['filename']}`
  }
  return applyTemplate(host.template, variables)
}

function binaryEntry(
  binary: RecordedBinary,
  command: string,
  host: ReleaseHost,
  template: string,
  releaseVersion: string,
): CliReleaseManifestInput['binaries'][number] {
  const filename = publicFilename(binary, command, template)
  const variables = {
    filename,
    command,
    id: binary.id,
    target: binary.target,
    platform: binary.platform,
    arch: binary.arch,
    version: releaseVersion,
  }
  const entry: CliReleaseManifestInput['binaries'][number] = {
    id: binary.id,
    target: binary.target,
    platform: binary.platform,
    arch: binary.arch,
    filename,
    url: urlFor(host, variables),
    sha256: binary.sha256,
    size: binary.size,
    compileFlagsDigest: binary.compileFlagsDigest,
  }
  if (binary.libc) entry.libc = binary.libc
  if (binary.cpuVariant) entry.cpuVariant = binary.cpuVariant
  return entry
}

export function manifestFromBuildRecord(record: BuildRecord, config: ReleaseDistConfig): CliReleaseManifestInput {
  const command = config.subject.command ?? config.subject.id
  const template = config.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE
  const releaseVersion = record.constants.releaseVersion

  return {
    manifestVersion: 1,
    metadata: {
      description: config.metadata.description,
      ...(config.metadata.homepage ? { homepage: config.metadata.homepage } : {}),
      ...(config.metadata.license ? { license: config.metadata.license } : {}),
      ...(config.metadata.repository ? { repository: config.metadata.repository } : {}),
    },
    subject: {
      id: config.subject.id,
      name: config.subject.name,
      version: releaseVersion,
      commit: record.constants.sourceCommit,
      contract: {
        kind: config.contract?.kind ?? 'product-catalog',
        digest: record.constants.contractDigest,
      },
    },
    release: {
      version: releaseVersion,
      ...(config.release.channel ? { channel: config.release.channel } : {}),
      createdAt: config.release.createdAt ?? new Date().toISOString(),
      generatorVersion: config.release.generatorVersion,
      ...(config.release.buildId ? { buildId: config.release.buildId } : {}),
    },
    runtime: { command },
    binaries: record.binaries.map((binary) => binaryEntry(binary, command, config.host, template, releaseVersion)),
  }
}
