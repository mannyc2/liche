import { join } from 'node:path'
import { packageArtifact, safeLowerSegment, writeArtifact } from './common.js'
import type { BinaryTarget } from '../manifest/index.js'
import type { ReleaseRenderer, ReleaseRendererInput, RenderPackageResult } from './index.js'

export type ScoopRendererConfig = {
  manifestName?: string
  commandName?: string
}

function scoopArchitecture(binary: BinaryTarget): '64bit' | 'arm64' {
  return binary.arch === 'arm64' ? 'arm64' : '64bit'
}

async function renderScoop(input: ReleaseRendererInput): Promise<RenderPackageResult> {
  const config = (input.config as ScoopRendererConfig | undefined) ?? {}
  const name = safeLowerSegment(config.manifestName ?? input.manifest.runtime.command)
  const command = config.commandName ?? input.manifest.runtime.command
  const architecture: Record<string, unknown> = {}
  for (const binary of input.manifest.binaries.filter((entry) => entry.platform === 'windows')) {
    architecture[scoopArchitecture(binary)] = {
      url: binary.url,
      hash: binary.sha256,
      bin: [[binary.filename, command]],
    }
  }
  const manifest: Record<string, unknown> = {
    version: input.manifest.release.version,
    description: input.manifest.metadata.description,
    architecture,
  }
  if (input.manifest.metadata.homepage) manifest.homepage = input.manifest.metadata.homepage
  if (input.manifest.metadata.license) manifest.license = input.manifest.metadata.license
  const artifact = await writeArtifact(
    join(input.outDir, `${name}.json`),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  )
  const packageId = `scoop:${name}`
  return {
    packages: [
      {
        id: packageId,
        renderer: 'scoop',
        ecosystem: 'scoop',
        kind: 'scoop-manifest',
        name,
        version: input.manifest.release.version,
        artifact: packageArtifact(artifact),
      },
    ],
    artifacts: [{ packageId, path: artifact.path }],
  }
}

export const scoopRenderer: ReleaseRenderer = {
  id: 'scoop',
  validate: ({ manifest }) =>
    manifest.binaries.some((binary) => binary.platform === 'windows')
      ? []
      : ['scoop renderer requires at least one windows binary'],
  render: renderScoop,
}
