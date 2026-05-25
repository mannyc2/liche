import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { EnvRecord } from '../publishers/index.js'
import { readJsonFile } from './types.js'
import type { CliCommandRunner, CommandResult } from './types.js'

export const SHIP_DEFAULTS = {
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

export type ShipSource = {
  compileEntrypoint: string
  contractDigest: string
  manifestPath: string
  releaseVersion?: string
}

export async function runShipPhase(
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

export async function optionalCommandOutput(
  runner: CliCommandRunner,
  argv: readonly string[],
  input: { cwd: string; env: EnvRecord },
): Promise<string | undefined> {
  const result = await runner(argv, input)
  if (result.code !== 0) return undefined
  const value = result.stdout.trim()
  return value.length > 0 ? value : undefined
}

export function stripLeadingVersionPrefix(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
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
    return { ok: false, error: { code: 'GENERATED_MANIFEST_INVALID', message: 'generated manifest schema is missing digest' } }
  }
  if (typeof releaseVersion !== 'string' || releaseVersion.length === 0) {
    return { ok: false, error: { code: 'GENERATED_MANIFEST_INVALID', message: 'generated manifest schema is missing version' } }
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

export async function productShipSource(input: {
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

export async function coreCliShipSource(input: {
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
