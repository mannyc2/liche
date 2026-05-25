import { sha256Hex } from '../internal/crypto.js'
import type { BinaryTarget, CliReleaseManifest, PackageRecord } from '../manifest/index.js'
import type { ReleaseRendererInput } from './index.js'

export type ArtifactBytes = {
  path: string
  bytes: Uint8Array
  sha256: string
  size: number
}

export { sha256Hex, sha256Base64Url } from '../internal/crypto.js'
export { readBinary } from '../internal/fs-bytes.js'

export async function writeArtifact(path: string, bytes: Uint8Array): Promise<ArtifactBytes> {
  await Bun.write(path, bytes)
  return {
    path,
    bytes,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  }
}

export function metadataLines(manifest: CliReleaseManifest): string {
  return [
    `# ${manifest.subject.name}`,
    '',
    manifest.metadata.description,
    '',
    `Version: ${manifest.release.version}`,
    `Commit: ${manifest.subject.commit}`,
    `Contract: ${manifest.subject.contract.kind} ${manifest.subject.contract.digest}`,
    '',
  ].join('\n')
}

export function safeLowerSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cli'
}

export function commandName(manifest: CliReleaseManifest, config: unknown): string {
  const cfg = config as { commandName?: string } | undefined
  return cfg?.commandName ?? manifest.runtime.command
}

export function targetSuffix(binary: BinaryTarget): string {
  const parts: string[] = [binary.platform, binary.arch]
  if (binary.platform === 'linux' && binary.libc === 'musl') parts.push('musl')
  if (binary.cpuVariant) parts.push(binary.cpuVariant)
  return parts.join('-')
}

export function verifiedPath(input: ReleaseRendererInput, id: string): string {
  const binary = input.binaries.find((entry) => entry.binaryId === id)
  if (!binary) throw new Error(`verified binary '${id}' was not provided to renderer`)
  return binary.path
}

export function packageArtifact(path: ArtifactBytes): PackageRecord['artifact'] {
  return {
    fileName: path.path.split('/').pop()!,
    sha256: path.sha256,
    size: path.size,
  }
}

export function validateHasBinaries(manifest: CliReleaseManifest, renderer: string): string[] {
  return manifest.binaries.length === 0 ? [`${renderer} renderer requires at least one binary`] : []
}
