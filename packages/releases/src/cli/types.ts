import type { RunContext } from '@liche/core'
import { z } from 'zod'
import type { ReleasesConfig } from '../config.js'
import { PUBLISHER_ENV_NAMES } from '../publishers/index.js'
import type { EnvRecord } from '../publishers/index.js'

export type CommandErrorInput = Parameters<RunContext['error']>[0]
export type CommandResult<T> = { ok: true; value: T } | { ok: false; error: CommandErrorInput }
export type ReleaseCommandContext<A, O, E = unknown> = RunContext<A, O, E>

export type CliCommandRunner = (
  argv: readonly string[],
  options: { cwd: string; env?: EnvRecord },
) => Promise<{ code: number; stdout: string; stderr: string }>

export const PublisherCredentialEnvSchema = z.object({
  [PUBLISHER_ENV_NAMES.npm.token]: z.string().optional(),
  [PUBLISHER_ENV_NAMES.pypi.token]: z.string().optional(),
  [PUBLISHER_ENV_NAMES.homebrew.githubToken]: z.string().optional(),
  [PUBLISHER_ENV_NAMES.scoop.githubToken]: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
}).passthrough()

export function releaseConfig(ctx: { sources: { value(provider: string, path: string): unknown } }): ReleasesConfig {
  return ctx.sources.value('config', '') as ReleasesConfig
}

export function envRecord(value: unknown): EnvRecord {
  if (!value || typeof value !== 'object') return {}
  const out: EnvRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || entry === undefined) out[key] = entry
  }
  return out
}

export async function readJsonFile(path: string): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  try {
    const { readFile } = await import('node:fs/promises')
    return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

export async function defaultCliCommandRunner(
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
