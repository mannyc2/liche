import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ReleasesConfig } from '../config.js'
import {
  distConfigFromReleasesConfig,
  rendererConfigFromReleasesConfig,
  rendererSelectionFromReleasesConfig,
} from '../config.js'
import { manifestFromBuildRecord, parseBuildRecord, parseCliReleaseManifest } from '../manifest/index.js'
import type { CliReleaseManifest } from '../manifest/index.js'
import { packageRelease } from '../package/index.js'
import { createDefaultRendererRegistry } from '../renderers/all.js'
import { formatPackageFailures } from './format-failures.js'
import { releaseConfig } from './types.js'
import type { CommandResult, ReleaseCommandContext } from './types.js'

export type PackageCommandOutput = {
  manifest: string
  out: string
  packages: Array<{
    id: string
    ecosystem: string
    kind: string
    name: string
    artifact?: string
  }>
}

async function copyReleaseBinaries(input: {
  buildRecordBinaries: readonly { id: string; path: string }[]
  manifest: CliReleaseManifest
  outDir: string
}): Promise<void> {
  const byId = new Map(input.buildRecordBinaries.map((binary) => [binary.id, binary.path]))
  const binaryDir = join(input.outDir, 'binaries')
  await mkdir(binaryDir, { recursive: true })
  for (const binary of input.manifest.binaries) {
    const source = byId.get(binary.id)
    if (!source) continue
    const target = join(binaryDir, binary.filename)
    await copyFile(source, target)
    await chmod(target, 0o755)
  }
}

export async function packageFromBuildRecord(input: {
  buildRecord: string
  config: ReleasesConfig
  cwd: string
  out: string
}): Promise<CommandResult<PackageCommandOutput>> {
  const buildRecordPath = resolve(input.cwd, input.buildRecord)
  const raw = await readFile(buildRecordPath, 'utf8')
  const parsedRecord = parseBuildRecord(JSON.parse(raw))
  if (!parsedRecord.ok) {
    return {
      ok: false,
      error: {
        code: 'BUILD_RECORD_INVALID',
        message: `build record at '${buildRecordPath}' did not parse`,
        hint: parsedRecord.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      },
    }
  }

  let manifestInput: unknown
  try {
    manifestInput = manifestFromBuildRecord(parsedRecord.record, distConfigFromReleasesConfig(input.config))
  } catch (error) {
    return {
      ok: false,
      error: { code: 'CONFIG_INVALID', message: error instanceof Error ? error.message : String(error) },
    }
  }

  const manifestResult = parseCliReleaseManifest(manifestInput)
  if (!manifestResult.ok) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_INVALID',
        message: 'release manifest derived from build record did not validate',
        hint: manifestResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      },
    }
  }

  const outDir = resolve(input.cwd, input.out)
  await copyReleaseBinaries({
    buildRecordBinaries: parsedRecord.record.binaries,
    manifest: manifestResult.manifest,
    outDir,
  })

  const rendererConfig = rendererConfigFromReleasesConfig(input.config)
  const result = await packageRelease({
    manifest: manifestResult.manifest,
    binaryPaths: Object.fromEntries(parsedRecord.record.binaries.map((binary) => [binary.id, binary.path])),
    renderers: rendererSelectionFromReleasesConfig(input.config),
    rendererRegistry: createDefaultRendererRegistry(),
    outDir: join(outDir, 'packages'),
    ...(rendererConfig ? { rendererConfig } : {}),
  })
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: 'PACKAGE_FAILED',
        message: 'release packaging failed',
        hint: formatPackageFailures(result.failures),
      },
    }
  }

  const manifestPath = join(outDir, 'manifest.json')
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`)

  return {
    ok: true,
    value: {
      manifest: manifestPath,
      out: outDir,
      packages: result.packages.map((pkg) => ({
        id: pkg.id,
        ecosystem: pkg.ecosystem,
        kind: pkg.kind,
        name: pkg.name,
        ...(pkg.artifact ? { artifact: pkg.artifact.fileName } : {}),
      })),
    },
  }
}

export async function runPackageCommand(
  ctx: ReleaseCommandContext<{ buildRecord: string }, { out: string }>,
): Promise<unknown> {
  const result = await packageFromBuildRecord({
    buildRecord: ctx.args.buildRecord,
    config: releaseConfig(ctx),
    cwd: process.cwd(),
    out: ctx.options.out,
  })
  if (!result.ok) return ctx.error(result.error)
  return result.value
}
