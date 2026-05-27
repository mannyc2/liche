import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCli, defineCommand, outputControls, run, z } from '@liche/core'
import type { CliInstance, RunOptions } from '@liche/core'
import { config, files } from '../src/index.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'liche-cfg-'))
}

async function runCli(cli: CliInstance, argv: string[], options: Omit<RunOptions, 'stdout' | 'stderr' | 'exit'> = {}) {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await run(cli, argv, {
    ...options,
    exit(code) { exitCode = code },
    stderr(chunk) { stderr += chunk },
    stdout(chunk) { stdout += chunk },
  })
  return { exitCode, stdout, stderr }
}

function cliFor<T extends Record<string, unknown>>(
  fileList: readonly string[] | undefined,
  schema: z.ZodType<T> | undefined,
  options: { scopes?: any } = {},
): CliInstance {
  const sources = fileList ? [files({ files: fileList, ...(options.scopes ? { scopes: options.scopes } : undefined) })] : []
  return defineCli({
    name: 'app',
    extensions: [
      outputControls({ json: true }),
      config({
        ...(schema ? { schema } : undefined),
        sources,
      }),
    ],
    commands: [
      defineCommand({
        path: ['run'],
        run: ({ ctx }) => ({ config: ctx.sources.value('config', ''), sources: snapshotSources(ctx) }),
      }),
    ],
  })
}

function snapshotSources(ctx: { sources: { source(provider: string, path: string): unknown } }): Record<string, unknown> {
  const fn = (path: string) => ctx.sources.source('config', path)
  return new Proxy({}, { get: (_, key: string) => fn(key) }) as Record<string, unknown>
}

describe('config extension loader', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { force: true, recursive: true }) })

  test('reads JSON, JSONC, YAML, and TOML config files from explicit --config paths', async () => {
    const jsonPath = join(dir, 'app.json')
    const jsoncPath = join(dir, 'app.jsonc')
    const yamlPath = join(dir, 'app.yaml')
    const tomlPath = join(dir, 'app.toml')
    writeFileSync(jsonPath, JSON.stringify({ mode: 'json' }))
    writeFileSync(jsoncPath, '{ // comment\n "mode": "jsonc"\n}')
    writeFileSync(yamlPath, 'mode: yaml\n')
    writeFileSync(tomlPath, 'mode = "toml"\n')

    for (const [path, mode] of [
      [jsonPath, 'json'],
      [jsoncPath, 'jsonc'],
      [yamlPath, 'yaml'],
      [tomlPath, 'toml'],
    ] as const) {
      const cli = cliFor(undefined, undefined)
      const result = await runCli(cli, ['run', '--config', path, '--json'])
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).config).toEqual({ mode })
    }
  })

  test('reads JSONC with trailing commas while preserving comment markers inside strings', async () => {
    const path = join(dir, 'app.jsonc')
    writeFileSync(path, `{
      // leading comment
      "url": "https://example.test/path",
      "glob": "src/**/*.ts",
      "literal": "keep /* this */ and // this",
      "list": [
        "one",
        "two",
      ],
    }`)

    const cli = cliFor(undefined, undefined)
    const result = await runCli(cli, ['run', '--config', path, '--json'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).config).toEqual({
      url: 'https://example.test/path',
      glob: 'src/**/*.ts',
      literal: 'keep /* this */ and // this',
      list: ['one', 'two'],
    })
  })

  test('throws ParseError with the path when explicit --config file does not exist', async () => {
    const cli = cliFor(undefined, undefined)
    const result = await runCli(cli, ['run', '--config', `${dir}/missing.json`, '--json'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain(`Config file not found: ${dir}/missing.json`)
  })

  test('discovers declared files and merges lower-priority files first', async () => {
    const userRoot = join(dir, 'user')
    const projectRoot = join(dir, 'project')
    const userPath = join(userRoot, 'app.json')
    const projectPath = join(projectRoot, 'app.json')
    mkdirSync(userRoot)
    mkdirSync(projectRoot)
    writeFileSync(userPath, JSON.stringify({ baseUrl: 'https://user.example.test', nested: { keep: true, value: 'user' } }))
    writeFileSync(projectPath, JSON.stringify({ baseUrl: 'https://project.example.test', nested: { value: 'project' } }))

    const previous = process.cwd()
    process.chdir(projectRoot)
    try {
      const cli = cliFor(['app.json'], undefined, { scopes: { project: true, user: { xdg: true } } })
      const result = await runCli(cli, ['run', '--json'], { env: { XDG_CONFIG_HOME: userRoot } })
      expect(JSON.parse(result.stdout).config).toEqual({
        baseUrl: 'https://project.example.test',
        nested: { keep: true, value: 'project' },
      })
    } finally {
      process.chdir(previous)
    }
  })

  test('returns schema defaults when no declared file exists', async () => {
    const cli = cliFor(
      [join(dir, 'missing.json')],
      z.object({ mode: z.string().default('default') }),
    )
    const result = await runCli(cli, ['run', '--json'])
    expect(JSON.parse(result.stdout).config).toEqual({ mode: 'default' })
  })

  test('strict config schemas reject unknown keys', async () => {
    const path = join(dir, 'app.json')
    writeFileSync(path, JSON.stringify({ mode: 'ok', typo: true }))
    const cli = cliFor(
      [path],
      z.strictObject({ mode: z.string() }),
    )
    const result = await runCli(cli, ['run', '--json'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Invalid config')
    expect(result.stdout).toContain('typo')
  })

  test('tracks provenance for resolved config fields', async () => {
    const path = join(dir, 'app.json')
    writeFileSync(path, JSON.stringify({ mode: 'json', nested: { value: true } }))
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        config({ sources: [files({ files: [path] })] }),
      ],
      commands: [
        defineCommand({
          path: ['run'],
          run: ({ ctx }) => ({
            mode: ctx.sources.source('config', 'mode'),
            nestedValue: ctx.sources.source('config', 'nested.value'),
          }),
        }),
      ],
    })
    const result = await runCli(cli, ['run', '--json'])
    expect(JSON.parse(result.stdout)).toEqual({
      mode: { kind: 'project-file', path },
      nestedValue: { kind: 'project-file', path },
    })
  })

  test('--no-config skips all external sources and leaves schema defaults', async () => {
    const path = join(dir, 'app.json')
    writeFileSync(path, JSON.stringify({ mode: 'fromfile' }))
    const cli = cliFor(
      [path],
      z.object({ mode: z.string().default('default') }),
    )
    const result = await runCli(cli, ['run', '--no-config', '--json'])
    expect(JSON.parse(result.stdout).config).toEqual({ mode: 'default' })
  })
})
