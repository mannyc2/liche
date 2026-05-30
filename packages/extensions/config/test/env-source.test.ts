import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCli, defineCommand, outputControls, run, z } from '@liche/core'
import type { CliInstance, RunOptions } from '@liche/core'
import { config, env, files } from '../src/index.js'

async function runCli(cli: CliInstance, argv: string[], options: Omit<RunOptions, 'stdout' | 'stderr' | 'exit'> = {}) {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await run(cli, argv, {
    ...options,
    exit(code) {
      exitCode = code
    },
    stderr(chunk) {
      stderr += chunk
    },
    stdout(chunk) {
      stdout += chunk
    },
  })
  return { exitCode, stdout, stderr }
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'liche-env-'))
}

describe('env source', () => {
  test('coerces string, number, and boolean primitives by schema kind', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        config({
          schema: z.object({
            host: z.string(),
            port: z.number(),
            secure: z.boolean(),
          }),
          sources: [env({ prefix: 'APP_' })],
        }),
      ],
      commands: [
        defineCommand({
          path: ['run'],
          run: ({ ctx }) => ctx.sources.value('config', ''),
        }),
      ],
    })
    const result = await runCli(cli, ['run', '--json'], {
      env: { APP_HOST: 'localhost', APP_PORT: '8080', APP_SECURE: 'true' },
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).data).toEqual({ host: 'localhost', port: 8080, secure: true })
  })

  test('rejects non-finite numeric env vars with a parse error', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        config({
          schema: z.object({ port: z.number() }),
          sources: [env({ prefix: 'APP_' })],
        }),
      ],
      commands: [defineCommand({ path: ['run'], run: () => ({}) })],
    })
    const result = await runCli(cli, ['run', '--json'], { env: { APP_PORT: 'abc' } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('APP_PORT=abc')
  })

  test('rejects non-primitive schema fields', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        config({
          schema: z.object({ nested: z.object({ x: z.string() }) }),
          sources: [env({ prefix: 'APP_' })],
        }),
      ],
      commands: [defineCommand({ path: ['run'], run: () => ({}) })],
    })
    const result = await runCli(cli, ['run', '--json'], { env: { APP_NESTED: 'whatever' } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('non-primitive')
  })

  test('env overrides file when listed after files in sources', async () => {
    const dir = tmp()
    try {
      const path = join(dir, 'app.json')
      writeFileSync(path, JSON.stringify({ region: 'iad' }))
      const cli = defineCli({
        name: 'app',
        extensions: [
          outputControls({ json: true }),
          config({
            schema: z.object({ region: z.string() }),
            sources: [files({ files: [path] }), env({ prefix: 'APP_' })],
          }),
        ],
        commands: [defineCommand({ path: ['run'], run: ({ ctx }) => ctx.sources.value('config', '') })],
      })
      const result = await runCli(cli, ['run', '--json'], { env: { APP_REGION: 'sfo' } })
      expect(JSON.parse(result.stdout).data).toEqual({ region: 'sfo' })
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('file wins when listed after env', async () => {
    const dir = tmp()
    try {
      const path = join(dir, 'app.json')
      writeFileSync(path, JSON.stringify({ region: 'iad' }))
      const cli = defineCli({
        name: 'app',
        extensions: [
          outputControls({ json: true }),
          config({
            schema: z.object({ region: z.string() }),
            sources: [env({ prefix: 'APP_' }), files({ files: [path] })],
          }),
        ],
        commands: [defineCommand({ path: ['run'], run: ({ ctx }) => ctx.sources.value('config', '') })],
      })
      const result = await runCli(cli, ['run', '--json'], { env: { APP_REGION: 'sfo' } })
      expect(JSON.parse(result.stdout).data).toEqual({ region: 'iad' })
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('reports source kind = env for fields read from env', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        config({
          schema: z.object({ region: z.string() }),
          sources: [env({ prefix: 'APP_' })],
        }),
      ],
      commands: [
        defineCommand({
          path: ['run'],
          run: ({ ctx }) => ctx.sources.source('config', 'region'),
        }),
      ],
    })
    const result = await runCli(cli, ['run', '--json'], { env: { APP_REGION: 'sfo' } })
    expect(JSON.parse(result.stdout).data).toEqual({ kind: 'env', var: 'APP_' })
  })
})
