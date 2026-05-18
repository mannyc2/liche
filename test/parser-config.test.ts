import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cli, ParseError } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { commandConfig, loadConfig } from '../src/parser/config.js'

const stateOf = (cli: any) => (cli as InternalCli)[stateSymbol]

function tmp() {
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
    const cli = Cli.create('app', {
      config: { loader: () => ({ commands: { run: { options: { mode: 'fromcfg' } } } }) },
    }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: true } as any)
    expect(result).toBeUndefined()
  })

  test('reads JSON config file from explicit --config path', async () => {
    const path = join(dir, 'app.json')
    writeFileSync(path, JSON.stringify({ commands: { run: { options: { mode: 'json' } } } }))
    const cli = Cli.create('app', { config: {} }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: path, configDisabled: false } as any)
    expect(result).toEqual({ commands: { run: { options: { mode: 'json' } } } })
  })

  test('reads YAML config file from explicit --config path (.yaml)', async () => {
    const path = join(dir, 'app.yaml')
    writeFileSync(path, 'commands:\n  run:\n    options:\n      mode: yaml\n')
    const cli = Cli.create('app', { config: {} }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: path, configDisabled: false } as any)
    expect(result).toEqual({ commands: { run: { options: { mode: 'yaml' } } } })
  })

  test('reads YAML config file from .yml extension', async () => {
    const path = join(dir, 'app.yml')
    writeFileSync(path, 'top: true\n')
    const cli = Cli.create('app', { config: {} }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: path, configDisabled: false } as any)
    expect(result).toEqual({ top: true })
  })

  test('throws ParseError with the path when explicit --config file does not exist', async () => {
    const cli = Cli.create('app', { config: {} }).command('run', { run: () => ({}) })
    await expect(
      loadConfig('app', stateOf(cli), { configPath: `${dir}/missing.json`, configDisabled: false } as any),
    ).rejects.toThrow(`Config file not found: ${dir}/missing.json`)
  })

  test('probes default file names "<name>.json" when no --config is passed', async () => {
    const path = join(dir, 'myapp.json')
    writeFileSync(path, JSON.stringify({ probed: true }))
    const cli = Cli.create('myapp', { config: { files: [path] } }).command('run', { run: () => ({}) })
    const result = await loadConfig('myapp', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result).toEqual({ probed: true })
  })

  test('falls through to next file when first candidate does not exist', async () => {
    const path = join(dir, 'second.json')
    writeFileSync(path, JSON.stringify({ second: true }))
    const cli = Cli.create('app', { config: { files: [`${dir}/missing.json`, path] } }).command('run', {
      run: () => ({}),
    })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result).toEqual({ second: true })
  })

  test('uses custom loader when no probed file matches', async () => {
    const cli = Cli.create('app', {
      config: { files: [`${dir}/missing.json`], loader: () => ({ fromLoader: true }) },
    }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result).toEqual({ fromLoader: true })
  })

  test('returns undefined when no file probes match and no loader configured', async () => {
    const cli = Cli.create('app', { config: { files: [`${dir}/none.json`] } }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result).toBeUndefined()
  })

  test('custom loader called with file path when file exists', async () => {
    const path = join(dir, 'cfg.json')
    writeFileSync(path, '{}')
    let receivedPath: string | undefined
    const cli = Cli.create('app', {
      config: { files: [path], loader: (p) => { receivedPath = p; return { ok: true } } },
    }).command('run', { run: () => ({}) })
    await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(receivedPath).toBe(path)
  })

  test('custom loader called with undefined when no file matched (fallback path)', async () => {
    let receivedPath: string | undefined = 'sentinel'
    const cli = Cli.create('app', {
      config: {
        files: [`${dir}/missing.json`],
        loader: (p) => { receivedPath = p; return { ok: true } },
      },
    }).command('run', { run: () => ({}) })
    await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(receivedPath).toBeUndefined()
  })

  test('throws ParseError when loader returns a non-object non-undefined value', async () => {
    const cli = Cli.create('app', {
      config: { loader: () => 'not an object' as any },
    }).command('run', { run: () => ({}) })
    await expect(loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)).rejects.toThrow(
      'Config loader must return a plain object or undefined',
    )
  })

  test('loader returning undefined → returns undefined (not an error)', async () => {
    const cli = Cli.create('app', {
      config: { loader: () => undefined },
    }).command('run', { run: () => ({}) })
    const result = await loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)
    expect(result).toBeUndefined()
  })

  test('loader returning an array (not a plain object) → ParseError', async () => {
    const cli = Cli.create('app', {
      config: { loader: () => [1, 2, 3] as any },
    }).command('run', { run: () => ({}) })
    await expect(loadConfig('app', stateOf(cli), { configPath: undefined, configDisabled: false } as any)).rejects.toThrow(
      ParseError,
    )
  })
})

describe('commandConfig', () => {
  test('returns {} for undefined config', () => {
    expect(commandConfig(undefined, ['run'])).toEqual({})
  })

  test('returns {} when path segments do not exist', () => {
    expect(commandConfig({ commands: {} }, ['missing'])).toEqual({})
  })

  test('returns the leaf config object for a 1-deep path', () => {
    const config = { commands: { run: { options: { mode: 'x' } } } }
    expect(commandConfig(config, ['run'])).toEqual({ options: { mode: 'x' } })
  })

  test('traverses nested command groups', () => {
    const config = { commands: { pr: { commands: { list: { options: { json: true } } } } } }
    expect(commandConfig(config, ['pr', 'list'])).toEqual({ options: { json: true } })
  })

  test('returns {} when leaf is not an object (e.g. primitive)', () => {
    const config = { commands: { run: 'not an object' } }
    expect(commandConfig(config, ['run'])).toEqual({})
  })

  test('empty path returns the config itself when it is an object', () => {
    const config = { top: 1 }
    expect(commandConfig(config, [])).toEqual(config)
  })
})
