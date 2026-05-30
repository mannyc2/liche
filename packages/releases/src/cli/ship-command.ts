import { resolve } from 'node:path'
import type { ReleasesConfig } from '../config.js'
import type { EnvRecord } from '../publishers/index.js'
import { releaseVersionFromRef } from './oidc-env.js'
import { packageFromBuildRecord } from './package-command.js'
import type { PackageCommandOutput } from './package-command.js'
import { publishFromManifest } from './publish-command.js'
import type { PublishCommandOutput } from './publish-command.js'
import {
  SHIP_DEFAULTS,
  coreCliShipSource,
  optionalCommandOutput,
  productShipSource,
  runShipPhase,
  stripLeadingVersionPrefix,
} from './ship-phases.js'
import type { ShipSource } from './ship-phases.js'
import { defaultCliCommandRunner, envRecord, fileExists, releaseConfig } from './types.js'
import type { CliCommandRunner, CommandResult, ReleaseCommandContext } from './types.js'

export type ShipReleaseInput = {
  config: ReleasesConfig
  cwd: string
  dryRun: boolean
  env: EnvRecord
  runner?: CliCommandRunner
}

async function shipSource(input: {
  cwd: string
  env: EnvRecord
  generatedOut: string
  runner: CliCommandRunner
}): Promise<CommandResult<ShipSource>> {
  if (await fileExists(resolve(input.cwd, SHIP_DEFAULTS.product))) return productShipSource(input)
  if (await fileExists(resolve(input.cwd, SHIP_DEFAULTS.cli))) return coreCliShipSource(input)
  return {
    ok: false,
    error: {
      code: 'RELEASE_SOURCE_MISSING',
      message: `expected '${SHIP_DEFAULTS.cli}' or '${SHIP_DEFAULTS.product}' in the release repository`,
    },
  }
}

export async function shipRelease(input: ShipReleaseInput): Promise<
  CommandResult<{
    build: { record: string }
    generated: { compileEntrypoint: string; manifest: string }
    package: PackageCommandOutput
    publish: PublishCommandOutput
  }>
> {
  const runner = input.runner ?? defaultCliCommandRunner
  const generatedOut = resolve(input.cwd, SHIP_DEFAULTS.generatedOut)
  const buildOut = resolve(input.cwd, SHIP_DEFAULTS.buildOut)
  const buildRecord = resolve(input.cwd, SHIP_DEFAULTS.buildRecord)
  const releaseOut = resolve(input.cwd, SHIP_DEFAULTS.releaseOut)

  const source = await shipSource({ cwd: input.cwd, env: input.env, generatedOut, runner })
  if (!source.ok) return source

  const versionFromRef = releaseVersionFromRef(input.env)
  const describedVersion = versionFromRef
    ? undefined
    : await optionalCommandOutput(runner, ['git', 'describe', '--tags', '--abbrev=0'], {
        cwd: input.cwd,
        env: input.env,
      })
  const sourceVersion = source.value.releaseVersion
  const releaseVersion = versionFromRef ?? stripLeadingVersionPrefix(describedVersion ?? sourceVersion ?? '')
  if (releaseVersion.length === 0) {
    return {
      ok: false,
      error: {
        code: 'RELEASE_VERSION_MISSING',
        message: 'could not resolve release version from tag, git describe, or CLI metadata',
      },
    }
  }
  const commit =
    input.env['GITHUB_SHA'] ??
    (await optionalCommandOutput(runner, ['git', 'rev-parse', 'HEAD'], { cwd: input.cwd, env: input.env }))

  if (!commit) {
    return {
      ok: false,
      error: {
        code: 'SOURCE_COMMIT_MISSING',
        message: 'could not resolve source commit from GITHUB_SHA or git rev-parse HEAD',
      },
    }
  }

  const built = await runShipPhase(
    runner,
    [
      'bun',
      'liche-build',
      'build',
      source.value.compileEntrypoint,
      '--targets',
      SHIP_DEFAULTS.targets,
      '--release-version',
      releaseVersion,
      '--commit',
      commit,
      '--contract-digest',
      source.value.contractDigest,
      '--out',
      buildOut,
      '--record',
      buildRecord,
      '--json',
    ],
    { cwd: input.cwd, env: input.env, phase: 'binary build' },
  )
  if (!built.ok) return built

  const packaged = await packageFromBuildRecord({
    buildRecord,
    config: input.config,
    cwd: input.cwd,
    out: releaseOut,
  })
  if (!packaged.ok) return packaged

  const published = await publishFromManifest({
    config: input.config,
    cwd: input.cwd,
    dryRun: input.dryRun,
    ecosystems: SHIP_DEFAULTS.ecosystems,
    env: input.env,
    manifest: packaged.value.manifest,
  })
  if (!published.ok) return published

  return {
    ok: true,
    value: {
      generated: { compileEntrypoint: source.value.compileEntrypoint, manifest: source.value.manifestPath },
      build: { record: buildRecord },
      package: packaged.value,
      publish: published.value,
    },
  }
}

export async function runShipCommand(ctx: ReleaseCommandContext<unknown, { dryRun: boolean }>): Promise<unknown> {
  const result = await shipRelease({
    config: releaseConfig(ctx),
    cwd: process.cwd(),
    dryRun: ctx.options.dryRun,
    env: envRecord(ctx.env),
  })
  if (!result.ok) return ctx.error(result.error)
  return result.value
}
