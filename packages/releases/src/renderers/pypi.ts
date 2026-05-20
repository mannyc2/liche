import { join } from 'node:path'
import { createZip } from './archives/zip.js'
import {
  packageArtifact,
  readBinary,
  safeLowerSegment,
  sha256Base64Url,
  validateHasBinaries,
  verifiedPath,
  writeArtifact,
} from './common.js'
import type { BinaryTarget, PackageRecord } from '../manifest.js'
import type { ReleaseRenderer, ReleaseRendererInput, RenderPackageResult } from './index.js'

export type PypiRendererConfig = {
  distribution?: string
  commandName?: string
  manylinuxTag?: string
  musllinuxTag?: string
}

function normalizeWheelDistribution(value: string): string {
  return safeLowerSegment(value).replace(/[-.]+/g, '_')
}

function wheelPlatformTag(binary: BinaryTarget, config: PypiRendererConfig): string {
  if (binary.platform === 'darwin') {
    return binary.arch === 'arm64' ? 'macosx_11_0_arm64' : 'macosx_10_13_x86_64'
  }
  if (binary.platform === 'windows') {
    return binary.arch === 'arm64' ? 'win_arm64' : 'win_amd64'
  }
  const arch = binary.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (binary.libc === 'musl') return `${config.musllinuxTag ?? 'musllinux_1_2'}_${arch}`
  return `${config.manylinuxTag ?? 'manylinux_2_28'}_${arch}`
}

function wheelRecordLine(path: string, data: Uint8Array): string {
  return `${path},sha256=${sha256Base64Url(data)},${data.byteLength}`
}

async function renderPypi(input: ReleaseRendererInput): Promise<RenderPackageResult> {
  const config = (input.config as PypiRendererConfig | undefined) ?? {}
  const distribution = normalizeWheelDistribution(config.distribution ?? input.manifest.runtime.command)
  const command = config.commandName ?? input.manifest.runtime.command
  const version = input.manifest.release.version
  const packages: PackageRecord[] = []
  const artifacts: Array<{ packageId: string; path: string }> = []

  for (const binary of input.manifest.binaries) {
    const tag = `py3-none-${wheelPlatformTag(binary, config)}`
    const distInfo = `${distribution}-${version}.dist-info`
    const scriptName = binary.platform === 'windows' && !command.endsWith('.exe') ? `${command}.exe` : command
    const scriptPath = `${distribution}-${version}.data/scripts/${scriptName}`
    const binaryBytes = await readBinary(verifiedPath(input, binary.id))
    const metadata = [
      'Metadata-Version: 2.3',
      `Name: ${distribution}`,
      `Version: ${version}`,
      `Summary: ${input.manifest.metadata.description}`,
      input.manifest.metadata.homepage ? `Home-page: ${input.manifest.metadata.homepage}` : '',
      input.manifest.metadata.license ? `License: ${input.manifest.metadata.license}` : '',
      '',
    ].filter((line) => line !== '').join('\n')
    const wheel = [
      'Wheel-Version: 1.0',
      `Generator: @lili/releases ${input.manifest.release.generatorVersion}`,
      'Root-Is-Purelib: false',
      `Tag: ${tag}`,
      '',
    ].join('\n')
    const baseEntries = [
      { path: scriptPath, data: binaryBytes, mode: 0o755 },
      { path: `${distInfo}/METADATA`, data: metadata },
      { path: `${distInfo}/WHEEL`, data: wheel },
    ]
    const recordLines = baseEntries.map((entry) => wheelRecordLine(entry.path, Buffer.from(entry.data)))
    recordLines.push(`${distInfo}/RECORD,,`)
    const wheelBytes = createZip([
      ...baseEntries,
      { path: `${distInfo}/RECORD`, data: `${recordLines.join('\n')}\n` },
    ])
    const fileName = `${distribution}-${version}-${tag}.whl`
    const artifact = await writeArtifact(join(input.outDir, fileName), wheelBytes)
    const packageId = `pypi:${distribution}:${binary.id}`
    packages.push({
      id: packageId,
      renderer: 'pypi',
      ecosystem: 'pypi',
      kind: 'wheel',
      name: distribution,
      version,
      targetBinaryId: binary.id,
      artifact: packageArtifact(artifact),
    })
    artifacts.push({ packageId, path: artifact.path })
  }

  return { packages, artifacts }
}

export const pypiRenderer: ReleaseRenderer = {
  id: 'pypi',
  validate: ({ manifest }) => validateHasBinaries(manifest, 'pypi'),
  render: renderPypi,
}
