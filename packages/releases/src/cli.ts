#!/usr/bin/env bun
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Cli, z } from '@lili/core'
import { parseBuildRecord } from './build-record.js'
import { manifestFromBuildRecord } from './manifest-from-build-record.js'
import type { ReleaseDistConfig, ReleaseHost } from './manifest-from-build-record.js'
import { parseCliReleaseManifest } from './manifest.js'
import type { PackageEcosystem } from './manifest.js'
import { packageRelease } from './package.js'
import type { PackageReleaseFailure } from './package.js'
import { createDefaultRendererRegistry } from './renderers/all.js'
import { isPackageEcosystem } from './renderers/index.js'
import type { RendererConfigMap } from './renderers/index.js'

const RELEASE_TOOL_VERSION = '0.0.0'

function parseTapOrBucket(value: string, kind: 'homebrew' | 'scoop'): { repo: string; name: string } {
  const [repo, name] = value.split(':')
  if (!repo || !name) {
    throw new Error(`--${kind} expects '<owner>/<repo>:<name>', got '${value}'`)
  }
  return { repo, name }
}

function parseRenderers(value: string | undefined): readonly PackageEcosystem[] | 'all' | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === 'all') return 'all'
  const ids: PackageEcosystem[] = []
  for (const part of trimmed.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (!isPackageEcosystem(part)) {
      throw new Error(`unknown renderer '${part}'`)
    }
    ids.push(part)
  }
  return ids
}

type PackageOptions = {
  subjectId: string
  subjectName?: string | undefined
  command?: string | undefined
  description: string
  homepage?: string | undefined
  license?: string | undefined
  repository?: string | undefined
  hostRepository?: string | undefined
  hostTag?: string | undefined
  hostUrlTemplate?: string | undefined
  npm?: string | undefined
  npmScope?: string | undefined
  pypi?: string | undefined
  homebrew?: string | undefined
  scoop?: string | undefined
  renderers?: string | undefined
  out: string
  manifestOut?: string | undefined
}

function buildHost(options: PackageOptions): ReleaseHost {
  if (options.hostUrlTemplate) {
    return { kind: 'url-template', template: options.hostUrlTemplate }
  }
  if (!options.hostRepository) {
    throw new Error('either --host-repository (for GitHub Releases) or --host-url-template is required')
  }
  return {
    kind: 'github-assets',
    repository: options.hostRepository,
    ...(options.hostTag ? { tag: options.hostTag } : {}),
  }
}

function buildDistConfig(options: PackageOptions): ReleaseDistConfig {
  const subjectName = options.subjectName ?? options.subjectId
  const metadata: ReleaseDistConfig['metadata'] = {
    description: options.description,
    ...(options.homepage ? { homepage: options.homepage } : {}),
    ...(options.license ? { license: options.license } : {}),
    ...(options.repository
      ? {
          repository: {
            type: 'git',
            url: options.repository.startsWith('http')
              ? options.repository
              : `https://github.com/${options.repository}.git`,
          },
        }
      : {}),
  }
  return {
    subject: {
      id: options.subjectId,
      name: subjectName,
      ...(options.command ? { command: options.command } : {}),
    },
    metadata,
    host: buildHost(options),
    release: { generatorVersion: RELEASE_TOOL_VERSION },
  }
}

function buildRendererConfig(options: PackageOptions): RendererConfigMap | undefined {
  const config: RendererConfigMap = {}
  if (options.npm) {
    const npmConfig: { packageName?: string; packageScope?: string } = {
      packageName: options.npm,
    }
    if (options.npmScope) npmConfig.packageScope = options.npmScope
    config.npm = npmConfig
  }
  if (options.pypi) {
    config.pypi = { distribution: options.pypi }
  }
  if (options.homebrew) {
    const { name } = parseTapOrBucket(options.homebrew, 'homebrew')
    config.homebrew = { formulaName: name }
  }
  if (options.scoop) {
    const { name } = parseTapOrBucket(options.scoop, 'scoop')
    config.scoop = { manifestName: name }
  }
  return Object.keys(config).length > 0 ? config : undefined
}

function selectedRenderers(
  options: PackageOptions,
): readonly PackageEcosystem[] | 'all' {
  const explicit = parseRenderers(options.renderers)
  if (explicit !== undefined) return explicit
  const ids: PackageEcosystem[] = []
  if (options.npm) ids.push('npm')
  if (options.pypi) ids.push('pypi')
  if (options.homebrew) ids.push('homebrew')
  if (options.scoop) ids.push('scoop')
  return ids
}

function formatFailures(failures: readonly PackageReleaseFailure[]): string {
  return failures
    .map((failure) => `${failure.stage}/${failure.code}: ${failure.message}`)
    .join('\n')
}

export const cli = Cli.create('li-release', {
  builtins: { completions: true },
  version: RELEASE_TOOL_VERSION,
}).command('package', {
  alias: { out: 'o' },
  args: z.object({ buildRecord: z.string() }),
  options: z.object({
    subjectId: z.string(),
    subjectName: z.string().optional(),
    command: z.string().optional(),
    description: z.string(),
    homepage: z.string().optional(),
    license: z.string().optional(),
    repository: z.string().optional(),
    hostRepository: z.string().optional(),
    hostTag: z.string().optional(),
    hostUrlTemplate: z.string().optional(),
    npm: z.string().optional(),
    npmScope: z.string().optional(),
    pypi: z.string().optional(),
    homebrew: z.string().optional(),
    scoop: z.string().optional(),
    renderers: z.string().optional(),
    out: z.string(),
    manifestOut: z.string().optional(),
  }),
  async run(ctx) {
    const buildRecordPath = resolve(process.cwd(), ctx.args.buildRecord)
    const raw = await readFile(buildRecordPath, 'utf8')
    const parsedRecord = parseBuildRecord(JSON.parse(raw))
    if (!parsedRecord.ok) {
      return ctx.error({
        code: 'BUILD_RECORD_INVALID',
        message: `build record at '${buildRecordPath}' did not parse`,
        hint: parsedRecord.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      })
    }

    let distConfig: ReleaseDistConfig
    try {
      distConfig = buildDistConfig(ctx.options)
    } catch (error) {
      return ctx.error({
        code: 'CONFIG_INVALID',
        message: error instanceof Error ? error.message : String(error),
      })
    }

    const manifestInput = manifestFromBuildRecord(parsedRecord.record, distConfig)
    const manifestResult = parseCliReleaseManifest(manifestInput)
    if (!manifestResult.ok) {
      return ctx.error({
        code: 'MANIFEST_INVALID',
        message: 'release manifest derived from build record did not validate',
        hint: manifestResult.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      })
    }

    const outDir = resolve(process.cwd(), ctx.options.out)
    let rendererConfig: RendererConfigMap | undefined
    try {
      rendererConfig = buildRendererConfig(ctx.options)
    } catch (error) {
      return ctx.error({
        code: 'CONFIG_INVALID',
        message: error instanceof Error ? error.message : String(error),
      })
    }

    const renderers = selectedRenderers(ctx.options)
    const result = await packageRelease({
      manifest: manifestResult.manifest,
      binaryPaths: Object.fromEntries(
        parsedRecord.record.binaries.map((binary) => [binary.id, binary.path]),
      ),
      renderers,
      rendererRegistry: createDefaultRendererRegistry(),
      outDir: join(outDir, 'packages'),
      ...(rendererConfig ? { rendererConfig } : {}),
    })

    if (!result.ok) {
      return ctx.error({
        code: 'PACKAGE_FAILED',
        message: `release packaging failed`,
        hint: formatFailures(result.failures),
      })
    }

    const manifestPath = ctx.options.manifestOut
      ? resolve(process.cwd(), ctx.options.manifestOut)
      : join(outDir, 'manifest.json')
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)

    return {
      manifest: manifestPath,
      out: outDir,
      packages: result.packages.map((pkg) => ({
        id: pkg.id,
        ecosystem: pkg.ecosystem,
        kind: pkg.kind,
        name: pkg.name,
        ...(pkg.artifact ? { artifact: pkg.artifact.fileName } : {}),
      })),
    }
  },
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
