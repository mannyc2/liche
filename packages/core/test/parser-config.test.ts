import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli, Config, z } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { loadConfig, loadConfigResolution } from '../src/parser/config.js'

const stateOf = (cli: unknown) => (cli as InternalCli)[stateSymbol]

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lili-cfg-'))
}

describe('loadConfig', () => {
  let dir: string
  beforeEach(() => {
    dir = tmp()
  })
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
  })

  test('returns undefined when CLI has no config schema and no --config flag', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result).toBeUndefined()
  })

  test('throws ParseError when --config is passed but CLI has no config schema', async () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    await expect(loadConfig('app', stateOf(cli), { configPath: './nope.json', configDisabled: false } as any)).rejects.toThrow(
      '--config has no effect',
    )
  })

  test('returns undefined when configDisabled is true even with config schema', async () => {
    const cli = Cli.create('app', { config: Config.object({}) }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: true } as any)
    expect(result).toBeUndefined()
  })

  test('reads JSON, JSONC, YAML, and TOML config files from explicit --config paths', async () => {
    const jsonPath = join(dir, 'app.json')
    const jsoncPath = join(dir, 'app.jsonc')
    const yamlPath = join(dir, 'app.yaml')
    const tomlPath = join(dir, 'app.toml')
    writeFileSync(jsonPath, JSON.stringify({ mode: 'json' }))
    writeFileSync(jsoncPath, '{ // comment\n "mode": "jsonc"\n}')
    writeFileSync(yamlPath, 'mode: yaml\n')
    writeFileSync(tomlPath, 'mode = "toml"\n')

    const cli = Cli.create('app', { config: Config.object({}) }).command('run', { run: () => ({}) })
    for (const [path, mode] of [
      [jsonPath, 'json'],
      [jsoncPath, 'jsonc'],
      [yamlPath, 'yaml'],
      [tomlPath, 'toml'],
    ] as const) {
      expect(await loadConfig('app', stateOf(cli), { configPath: path, configDisabled: false } as any)).toEqual({ mode })
    }
  })

  test('throws ParseError with the path when explicit --config file does not exist', async () => {
    const cli = Cli.create('app', { config: Config.object({}) }).command('run', { run: () => ({}) })
    await expect(
      loadConfig('app', stateOf(cli), { configPath: `${dir}/missing.json`, configDisabled: false } as any),
    ).rejects.toThrow(`Config file not found: ${dir}/missing.json`)
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
      const cli = Cli.create('app', {
        config: Config.object({
          files: ['app.json'],
          scopes: { project: true, user: { xdg: true } },
        }),
      }).command('run', { run: () => ({}) })

      const result = await loadConfig('app', stateOf(cli), {
        configPath: undefined,
        configDisabled: false,
      } as any, { XDG_CONFIG_HOME: userRoot })
      expect(result).toEqual({
        baseUrl: 'https://project.example.test',
        nested: { keep: true, value: 'project' },
      })
    } finally {
      process.chdir(previous)
    }
  })

  test('returns schema defaults when no declared file exists', async () => {
    const cli = Cli.create('app', {
      config: Config.object({
        files: [join(dir, 'missing.json')],
        schema: z.object({ mode: z.string().default('default') }),
      }),
    }).command('run', { run: () => ({}) })
    const result = await loadConfigResolution('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result?.values).toEqual({ mode: 'default' })
  })

  test('tracks provenance for resolved config fields', async () => {
    const path = join(dir, 'app.json')
    writeFileSync(path, JSON.stringify({ mode: 'json', nested: { value: true } }))
    const cli = Cli.create('app', { config: Config.object({ files: [path] }) }).command('run', { run: () => ({}) })
    const result = await loadConfigResolution('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result?.sources.get('mode')).toEqual({ kind: 'project-file', path })
    expect(result?.sources.get('nested.value')).toEqual({ kind: 'project-file', path })
  })
})
