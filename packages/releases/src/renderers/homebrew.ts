import { join } from 'node:path'
import {
  packageArtifact,
  safeLowerSegment,
  writeArtifact,
} from './common.js'
import type { ReleaseRenderer, ReleaseRendererInput, RenderPackageResult } from './index.js'

export type HomebrewRendererConfig = {
  formulaName?: string
  className?: string
  commandName?: string
}

function rubyClassName(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('') || 'Cli'
}

function homebrewFormula(input: ReleaseRendererInput, className: string, command: string): string {
  const eligible = input.manifest.binaries.filter((binary) =>
    binary.platform === 'darwin' || (binary.platform === 'linux' && binary.libc !== 'musl'),
  )
  const branchLines = eligible.map((binary) => {
    const os = binary.platform === 'darwin' ? 'on_macos' : 'on_linux'
    const arch = binary.arch === 'arm64' ? 'Hardware::CPU.arm?' : 'Hardware::CPU.intel?'
    return `  ${os} do
    if ${arch}
      url "${binary.url}"
      sha256 "${binary.sha256}"
    end
  end`
  })
  return `class ${className} < Formula
  desc "${input.manifest.metadata.description.replace(/"/g, '\\"')}"
  homepage "${input.manifest.metadata.homepage ?? input.manifest.binaries[0]!.url}"
  version "${input.manifest.release.version}"
${input.manifest.metadata.license ? `  license "${input.manifest.metadata.license}"\n` : ''}
${branchLines.join('\n\n')}

  def install
    bin.install "${input.manifest.binaries[0]!.filename}" => "${command}"
  end

  test do
    system "#{bin}/${command}", "--help"
  end
end
`
}

async function renderHomebrew(input: ReleaseRendererInput): Promise<RenderPackageResult> {
  const config = (input.config as HomebrewRendererConfig | undefined) ?? {}
  const formulaName = safeLowerSegment(config.formulaName ?? input.manifest.runtime.command)
  const className = config.className ?? rubyClassName(formulaName)
  const command = config.commandName ?? input.manifest.runtime.command
  const formula = Buffer.from(homebrewFormula(input, className, command))
  const artifact = await writeArtifact(join(input.outDir, `${formulaName}.rb`), formula)
  const packageId = `homebrew:${formulaName}`
  return {
    packages: [
      {
        id: packageId,
        renderer: 'homebrew',
        ecosystem: 'homebrew',
        kind: 'formula',
        name: formulaName,
        version: input.manifest.release.version,
        artifact: packageArtifact(artifact),
      },
    ],
    artifacts: [{ packageId, path: artifact.path }],
  }
}

export const homebrewRenderer: ReleaseRenderer = {
  id: 'homebrew',
  validate: ({ manifest }) => {
    const eligible = manifest.binaries.some((binary) =>
      binary.platform === 'darwin' || (binary.platform === 'linux' && binary.libc !== 'musl'),
    )
    return eligible ? [] : ['homebrew renderer requires at least one darwin or linux glibc binary']
  },
  render: renderHomebrew,
}
