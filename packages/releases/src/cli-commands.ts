import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { RunContext } from '@liche/core'
import { z } from 'zod'
import type { CliReleaseManifest } from './manifest.js'
import { parseBuildRecord } from './build-record.js'
import { createCliPublisherExecutors, publishGithubReleaseAssets } from './default-executors.js'
import { manifestFromBuildRecord } from './manifest-from-build-record.js'
import { parseCliReleaseManifest } from './manifest.js'
import { packageRelease } from './package.js'
import type { PackageReleaseFailure } from './package.js'
import {
  executeReleasePublish,
  loadPublisherCredentialsFromEnv,
  planReleasePublish,
  PUBLISHER_ENV_NAMES,
  preflightReleasePublish,
} from './publishers/index.js'
import type { EnvRecord, ExecuteFailure, PreflightFailure, PublishPlanFailure } from './publishers/index.js'
import type { OidcExchangeEnv, PublisherCredentials } from './publishers/index.js'
import { createDefaultRendererRegistry } from './renderers/all.js'
import {
  artifactsFromManifest,
  distConfigFromReleasesConfig,
  githubReleaseTarget,
  parsePublishSelection,
  publisherConfigFromReleasesConfig,
  rendererConfigFromReleasesConfig,
  rendererSelectionFromReleasesConfig,
} from './release-config.js'
import type { ReleasesConfig } from './release-config.js'

type CommandErrorInput = Parameters<RunContext['error']>[0]
type CommandResult<T> = { ok: true; value: T } | { ok: false; error: CommandErrorInput }
type ReleaseCommandContext<A, O, E = unknown> = RunContext<A, O, E>

export const PublisherCredentialEnvSchema = z.object({
  [PUBLISHER_ENV_NAMES.npm.token]: z.string().optional(),
  [PUBLISHER_ENV_NAMES.pypi.token]: z.string().optional(),
  [PUBLISHER_ENV_NAMES.homebrew.githubToken]: z.string().optional(),
  [PUBLISHER_ENV_NAMES.scoop.githubToken]: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
}).passthrough()

export type CliCommandRunner = (
  argv: readonly string[],
  options: { cwd: string; env?: EnvRecord },
) => Promise<{ code: number; stdout: string; stderr: string }>

export type ShipReleaseInput = {
  config: ReleasesConfig
  cwd: string
  dryRun: boolean
  env: EnvRecord
  runner?: CliCommandRunner
}

const SHIP_DEFAULTS = {
  buildOut: 'dist/binaries',
  buildRecord: 'dist/build-record.json',
  cli: 'src/cli.ts',
  commandManifest: 'liche.command-manifest.json',
  ecosystems: 'npm,homebrew,scoop,github',
  generatedOut: 'dist/generated',
  product: 'src/product.ts',
  releaseOut: 'dist/release',
  targets: 'all',
} as const

async function readJsonFile(path: string): Promise<
  | { ok: true; value: unknown }
  | { ok: false; message: string }
> {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

async function defaultCliCommandRunner(
  argv: readonly string[],
  options: { cwd: string; env?: EnvRecord },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([...argv], {
    cwd: options.cwd,
    env: { ...Bun.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout as unknown as ReadableStream).text(),
    new Response(child.stderr as unknown as ReadableStream).text(),
    child.exited,
  ])
  return { code, stdout, stderr }
}

async function runShipPhase(
  runner: CliCommandRunner,
  argv: readonly string[],
  input: { cwd: string; env: EnvRecord; phase: string },
): Promise<CommandResult<{ stdout: string }>> {
  const result = await runner(argv, { cwd: input.cwd, env: input.env })
  if (result.code === 0) return { ok: true, value: { stdout: result.stdout } }
  return {
    ok: false,
    error: {
      code: 'SHIP_PHASE_FAILED',
      message: `${input.phase} failed`,
      hint: `${argv.join(' ')} exited with ${result.code}\n${result.stderr}\n${result.stdout}`.trim(),
    },
  }
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim()
  if (trimmed.length === 0) return {}
  return JSON.parse(trimmed)
}

function readStringPath(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function releaseVersionFromRef(env: EnvRecord): string | undefined {
  const fullRef = env['GITHUB_REF']
  const refName = env['GITHUB_REF_NAME']
  const ref = fullRef?.startsWith('refs/tags/')
    ? fullRef.slice('refs/tags/'.length)
    : env['GITHUB_REF_TYPE'] === 'tag'
      ? refName
      : refName?.startsWith('v')
        ? refName
        : undefined
  if (!ref) return undefined
  const name = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : ref
  return name.startsWith('v') ? name.slice(1) : name
}

function formatPackageFailures(failures: readonly PackageReleaseFailure[]): string {
  return failures.map((failure) => `${failure.stage}/${failure.code}: ${failure.message}`).join('\n')
}

function formatPlanFailures(failures: readonly PublishPlanFailure[]): string {
  return failures.map((failure) => `${failure.publisher}/${failure.code}: ${failure.message}`).join('\n')
}

function formatPreflightFailures(failures: readonly PreflightFailure[]): string {
  return failures.map((failure) => `${failure.publisher}/${failure.code}: ${failure.message}`).join('\n')
}

function formatExecuteFailure(failure: ExecuteFailure): string {
  return `${failure.stepIndex}/${failure.ecosystem}/${failure.code}: ${failure.message}`
}

function releaseConfig(ctx: { config: Record<string, unknown> }): ReleasesConfig {
  return ctx.config as ReleasesConfig
}

function envRecord(value: unknown): EnvRecord {
  if (!value || typeof value !== 'object') return {}
  const out: EnvRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || entry === undefined) out[key] = entry
  }
  return out
}

function githubActionsOidcEnv(env: EnvRecord): OidcExchangeEnv | undefined {
  const requestUrl = env['ACTIONS_ID_TOKEN_REQUEST_URL']
  const requestToken = env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
  if (!requestUrl || !requestToken) return undefined
  return {
    idTokenFetcher: async (audience) => {
      const url = new URL(requestUrl)
      url.searchParams.set('audience', audience)
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${requestToken}` },
      })
      if (!response.ok) return { ok: false, reason: `GitHub OIDC token request failed with ${response.status}` }
      const body = await response.json() as { value?: unknown; token?: unknown }
      const token = typeof body.value === 'string' ? body.value : body.token
      return typeof token === 'string' && token.length > 0
        ? { ok: true, token }
        : { ok: false, reason: 'GitHub OIDC token response did not include a token' }
    },
  }
}

function publisherCredentials(env: EnvRecord): { credentials: PublisherCredentials; oidc?: OidcExchangeEnv } {
  const credentials = loadPublisherCredentialsFromEnv(env)
  const oidc = githubActionsOidcEnv(env)
  if (!credentials.npm && oidc) credentials.npm = { kind: 'oidc', provider: 'github-actions' }
  return oidc ? { credentials, oidc } : { credentials }
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

type PackageCommandOutput = {
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

async function packageFromBuildRecord(input: {
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

type PublishCommandOutput = {
  dryRun: boolean
  manifest: string
  [key: string]: unknown
}

async function publishFromManifest(input: {
  config: ReleasesConfig
  cwd: string
  dryRun: boolean
  ecosystems: string
  env: EnvRecord
  manifest: string
}): Promise<CommandResult<PublishCommandOutput>> {
  const manifestPath = resolve(input.cwd, input.manifest)
  const rawManifest = await readJsonFile(manifestPath)
  if (!rawManifest.ok) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_READ_FAILED',
        message: `could not read release manifest at '${manifestPath}'`,
        hint: rawManifest.message,
      },
    }
  }

  const manifestResult = parseCliReleaseManifest(rawManifest.value)
  if (!manifestResult.ok) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_INVALID',
        message: `release manifest at '${manifestPath}' did not validate`,
        hint: manifestResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      },
    }
  }

  let selection: ReturnType<typeof parsePublishSelection>
  try {
    selection = parsePublishSelection(input.ecosystems)
  } catch (error) {
    return {
      ok: false,
      error: { code: 'CONFIG_INVALID', message: error instanceof Error ? error.message : String(error) },
    }
  }

  const completed: Record<string, unknown> = {}

  if (selection.github) {
    const target = githubReleaseTarget(input.config, manifestResult.manifest)
    if (!target) {
      return {
        ok: false,
        error: {
          code: 'GITHUB_RELEASE_CONFIG_MISSING',
          message: 'github publishing requires a github-assets host or publishers.github.repository',
        },
      }
    }
    const uploaded = await publishGithubReleaseAssets({
      manifest: manifestResult.manifest,
      manifestPath,
      repository: target.repository,
      tag: target.tag,
      dryRun: input.dryRun,
    })
    if (!uploaded.ok) {
      return {
        ok: false,
        error: { code: uploaded.code, message: uploaded.message, hint: JSON.stringify(uploaded.details ?? {}) },
      }
    }
    completed.github = uploaded
  }

  const shouldPlanPackages =
    selection.packageSelection === 'all' ||
    (Array.isArray(selection.packageSelection) && selection.packageSelection.length > 0)

  if (shouldPlanPackages) {
    const publisherConfig = publisherConfigFromReleasesConfig(input.config)
    const planResult = planReleasePublish({
      manifest: manifestResult.manifest,
      packages: manifestResult.manifest.packages,
      artifacts: artifactsFromManifest(manifestResult.manifest, manifestPath),
      selection: selection.packageSelection,
      ...(publisherConfig ? { config: publisherConfig } : {}),
    })
    if (!planResult.ok) {
      return {
        ok: false,
        error: {
          code: 'PUBLISH_PLAN_FAILED',
          message: 'release publish plan failed',
          hint: formatPlanFailures(planResult.failures),
        },
      }
    }

    const { credentials, oidc } = publisherCredentials(input.env)
    const preflight = preflightReleasePublish({ plan: planResult.plan, credentials })
    if (!preflight.ok) {
      return {
        ok: false,
        error: {
          code: 'PUBLISH_PREFLIGHT_FAILED',
          message: 'release publish preflight failed',
          hint: formatPreflightFailures(preflight.failures),
        },
      }
    }

    if (input.dryRun) {
      completed.packagePublish = { cleared: preflight.cleared, plan: planResult.plan }
    } else {
      const executed = await executeReleasePublish({
        plan: planResult.plan,
        credentials,
        executors: createCliPublisherExecutors(),
        ...(oidc ? { oidc } : {}),
      })
      if (!executed.ok) {
        return {
          ok: false,
          error: {
            code: executed.failure.code === 'EXECUTOR_MISSING'
              ? 'PUBLISH_EXECUTOR_MISSING'
              : 'PUBLISH_EXECUTION_FAILED',
            message: 'release publish execution failed',
            hint: formatExecuteFailure(executed.failure),
          },
        }
      }
      completed.packagePublish = { completed: executed.completed }
    }
  }

  return {
    ok: true,
    value: {
      dryRun: input.dryRun,
      manifest: manifestPath,
      ...completed,
    },
  }
}

export async function runPublishCommand(
  ctx: ReleaseCommandContext<{ manifest: string }, { dryRun: boolean; ecosystems: string }>,
): Promise<unknown> {
  const result = await publishFromManifest({
    config: releaseConfig(ctx),
    cwd: process.cwd(),
    dryRun: ctx.options.dryRun,
    ecosystems: ctx.options.ecosystems,
    env: envRecord(ctx.env),
    manifest: ctx.args.manifest,
  })
  if (!result.ok) return ctx.error(result.error)
  return result.value
}

async function optionalCommandOutput(
  runner: CliCommandRunner,
  argv: readonly string[],
  input: { cwd: string; env: EnvRecord },
): Promise<string | undefined> {
  const result = await runner(argv, input)
  if (result.code !== 0) return undefined
  const value = result.stdout.trim()
  return value.length > 0 ? value : undefined
}

function stripLeadingVersionPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

function generatedManifestFacts(value: unknown): CommandResult<{ contractDigest: string; releaseVersion: string }> {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: { code: 'GENERATED_MANIFEST_INVALID', message: 'generated manifest is not an object' } }
  }
  const schema = (value as Record<string, unknown>)['schema']
  if (!schema || typeof schema !== 'object') {
    return { ok: false, error: { code: 'GENERATED_MANIFEST_INVALID', message: 'generated manifest is missing schema' } }
  }
  const contractDigest = (schema as Record<string, unknown>)['digest']
  const releaseVersion = (schema as Record<string, unknown>)['version']
  if (typeof contractDigest !== 'string' || contractDigest.length === 0) {
    return {
      ok: false,
      error: { code: 'GENERATED_MANIFEST_INVALID', message: 'generated manifest schema is missing digest' },
    }
  }
  if (typeof releaseVersion !== 'string' || releaseVersion.length === 0) {
    return {
      ok: false,
      error: { code: 'GENERATED_MANIFEST_INVALID', message: 'generated manifest schema is missing version' },
    }
  }
  return { ok: true, value: { contractDigest, releaseVersion } }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalizeJson((value as Record<string, unknown>)[key])
  }
  return out
}

function digestJson(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeJson(value))
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

function commandManifestFacts(value: unknown): CommandResult<{ contractDigest: string; releaseVersion?: string }> {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: { code: 'COMMAND_MANIFEST_INVALID', message: 'command manifest is not an object' } }
  }
  const commands = (value as Record<string, unknown>)['commands']
  if (!Array.isArray(commands)) {
    return { ok: false, error: { code: 'COMMAND_MANIFEST_INVALID', message: 'command manifest is missing commands' } }
  }
  const version = (value as Record<string, unknown>)['version']
  return {
    ok: true,
    value: {
      contractDigest: digestJson(value),
      ...(typeof version === 'string' && version.length > 0 ? { releaseVersion: version } : {}),
    },
  }
}

type ShipSource = {
  compileEntrypoint: string
  contractDigest: string
  manifestPath: string
  releaseVersion?: string
}

async function productShipSource(input: {
  cwd: string
  env: EnvRecord
  generatedOut: string
  runner: CliCommandRunner
}): Promise<CommandResult<ShipSource>> {
  const generated = await runShipPhase(
    input.runner,
    ['bun', 'liche-product', 'generate', SHIP_DEFAULTS.product, '--out', input.generatedOut, '--json'],
    { cwd: input.cwd, env: input.env, phase: 'product generation' },
  )
  if (!generated.ok) return generated

  let generatedOutput: unknown
  try {
    generatedOutput = parseJsonOutput(generated.value.stdout)
  } catch (error) {
    return {
      ok: false,
      error: { code: 'SHIP_PHASE_OUTPUT_INVALID', message: 'product generation did not return JSON', hint: String(error) },
    }
  }

  const manifestPath = readStringPath(generatedOutput, 'manifestPath') ?? join(input.generatedOut, 'liche.generated.manifest.json')
  const compileEntrypoint = readStringPath(generatedOutput, 'compileEntrypointPath') ?? join(input.generatedOut, 'liche.compile-entry.ts')
  const rawGeneratedManifest = await readJsonFile(manifestPath)
  if (!rawGeneratedManifest.ok) {
    return {
      ok: false,
      error: {
        code: 'GENERATED_MANIFEST_READ_FAILED',
        message: `could not read generated manifest at '${manifestPath}'`,
        hint: rawGeneratedManifest.message,
      },
    }
  }

  const facts = generatedManifestFacts(rawGeneratedManifest.value)
  if (!facts.ok) return facts

  return {
    ok: true,
    value: {
      compileEntrypoint,
      contractDigest: facts.value.contractDigest,
      manifestPath,
      releaseVersion: facts.value.releaseVersion,
    },
  }
}

async function coreCliShipSource(input: {
  cwd: string
  env: EnvRecord
  generatedOut: string
  runner: CliCommandRunner
}): Promise<CommandResult<ShipSource>> {
  const compileEntrypoint = resolve(input.cwd, SHIP_DEFAULTS.cli)
  const manifest = await runShipPhase(
    input.runner,
    ['bun', compileEntrypoint, '--llms', '--json'],
    { cwd: input.cwd, env: input.env, phase: 'command manifest generation' },
  )
  if (!manifest.ok) return manifest

  let commandManifest: unknown
  try {
    commandManifest = parseJsonOutput(manifest.value.stdout)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'SHIP_PHASE_OUTPUT_INVALID',
        message: 'command manifest generation did not return JSON',
        hint: String(error),
      },
    }
  }

  const facts = commandManifestFacts(commandManifest)
  if (!facts.ok) return facts

  const manifestPath = join(input.generatedOut, SHIP_DEFAULTS.commandManifest)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(commandManifest, null, 2)}\n`)

  return {
    ok: true,
    value: {
      compileEntrypoint,
      contractDigest: facts.value.contractDigest,
      manifestPath,
      ...(facts.value.releaseVersion ? { releaseVersion: facts.value.releaseVersion } : {}),
    },
  }
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

export async function shipRelease(input: ShipReleaseInput): Promise<CommandResult<{
  build: { record: string }
  generated: { compileEntrypoint: string; manifest: string }
  package: PackageCommandOutput
  publish: PublishCommandOutput
}>> {
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
  const commit = input.env['GITHUB_SHA']
    ?? (await optionalCommandOutput(runner, ['git', 'rev-parse', 'HEAD'], { cwd: input.cwd, env: input.env }))

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

export async function runShipCommand(
  ctx: ReleaseCommandContext<unknown, { dryRun: boolean }>,
): Promise<unknown> {
  const result = await shipRelease({
    config: releaseConfig(ctx),
    cwd: process.cwd(),
    dryRun: ctx.options.dryRun,
    env: envRecord(ctx.env),
  })
  if (!result.ok) return ctx.error(result.error)
  return result.value
}
