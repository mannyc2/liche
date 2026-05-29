import { describe, expect, test } from 'bun:test'
import { arg, defaultHelpRenderer, defineCli, defineCommand, help as helpControl, z } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { renderHelp } from '../src/help/render.js'
import { runCli, testCli, testCommand } from './helpers.js'

const stateOf = (cli: any) => (cli as InternalCli)[stateSymbol]
const cliWith = (name: string, definition: any = {}, root: any = {}) => testCli('app', root, [testCommand(name, definition)])

describe('renderHelp — title and usage', () => {
  test('renders bare name when CLI has no description', () => {
    const cli = cliWith('run', { run: () => ({}) })
    const help = renderHelp('app', stateOf(cli))
    expect(help.split('\n')[0]).toBe('app')
  })

  test('renders "name - description" when CLI has a description', () => {
    const cli = cliWith('run', { run: () => ({}) }, { description: 'the thing' })
    const help = renderHelp('app', stateOf(cli))
    expect(help.split('\n')[0]).toBe('app - the thing')
  })

  test('root usage includes "<command>" when CLI has subcommands', () => {
    const cli = cliWith('run', { run: () => ({}) })
    const help = renderHelp('app', stateOf(cli))
    expect(help).toContain('Usage: app <command>')
  })

  test('root usage omits "<command>" when CLI has only a root run', () => {
    const cli = testCli('app', { run: () => ({ ok: true }) })
    const help = renderHelp('app', stateOf(cli))
    expect(help).toContain('Usage: app\n')
    expect(help).not.toContain('Usage: app <command>')
  })

  test('command-level help scopes name with the command path', () => {
    const cli = cliWith('run', { description: 'do it', run: () => ({}) })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help.split('\n')[0]).toBe('app run - do it')
    expect(help).toContain('Usage: app run')
  })
})

describe('renderHelp — arguments', () => {
  test('required args render as <name>', () => {
    const cli = cliWith('build', {
      args: z.object({ target: z.string() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['build'])
    expect(help).toContain('Usage: app build <target>')
  })

  test('optional args render as [name]', () => {
    const cli = cliWith('build', {
      args: z.object({ target: z.string().optional() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['build'])
    expect(help).toContain('Usage: app build [target]')
  })

  test('mixed required + optional args render in declared order', () => {
    const cli = cliWith('build', {
      args: z.object({ name: z.string(), version: z.string().optional() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['build'])
    expect(help).toContain('Usage: app build <name> [version]')
  })
})

describe('renderHelp — options', () => {
  test('single-char option keys render as -x (no kebab, no --)', () => {
    const cli = cliWith('run', {
      options: z.object({ x: z.string() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('-x')
    expect(help).not.toContain('--x')
  })

  test('multi-char keys render as --kebab-case', () => {
    const cli = cliWith('run', {
      options: z.object({ dryRun: z.boolean().default(false) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--dry-run')
    expect(help).not.toContain('--dryRun')
  })

  test('arg.boolean() flags render with no <value> placeholder', () => {
    const cli = cliWith('run', {
      options: z.object({ verbose: arg.boolean().default(false) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--verbose')
    expect(help).not.toContain('--verbose <verbose>')
  })

  test('alias renders as "-a, --long"', () => {
    const cli = cliWith('run', {
      options: z.object({ format: z.string() }),
      alias: { format: 'f' },
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('-f, --format')
  })

  test('default value renders as "(default: <value>)" suffix', () => {
    const cli = cliWith('run', {
      options: z.object({ count: z.number().default(7) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('(default: 7)')
  })

  test('no default → no "(default:)" suffix', () => {
    const cli = cliWith('run', {
      options: z.object({ count: z.number() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).not.toContain('(default:')
  })

  test('env input source mapping renders "(env: NAME)" suffix', () => {
    const cli = cliWith('run', {
      options: z.object({ token: z.string() }),
      sources: { options: { token: [{ provider: 'env', path: 'APP_TOKEN' }] } },
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('(env: APP_TOKEN)')
  })

  test('deprecated option gets "[deprecated]" suffix', () => {
    const cli = cliWith('run', {
      options: z.object({ legacy: z.boolean().meta({ deprecated: true }).default(false) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--legacy')
    expect(help).toContain('[deprecated]')
  })

  test('non-deprecated option has no "[deprecated]" suffix', () => {
    const cli = cliWith('run', {
      options: z.object({ modern: z.boolean().default(false) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).not.toContain('[deprecated]')
  })

  test('non-boolean option appends "<key>" value token to its options-table label', () => {
    const cli = cliWith('run', {
      options: z.object({ name: z.string() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--name <name>')
  })

  test('boolean option has no value token in its options-table label', () => {
    const cli = cliWith('run', {
      options: z.object({ verbose: z.boolean().default(false) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--verbose')
    expect(help).not.toMatch(/--verbose\s*</)
  })

  test('meta valueLabel overrides the default <key> token', () => {
    const cli = cliWith('run', {
      options: z.object({ name: z.string().meta({ valueLabel: 'identity' }) }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--name <identity>')
    expect(help).not.toContain('--name <name>')
  })

  test('description from .describe() renders in option row', () => {
    const cli = cliWith('run', {
      options: z.object({ mode: z.string().describe('which mode to run in') }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('which mode to run in')
  })
})

describe('renderHelp — commands listing', () => {
  test('lists child commands under "Commands:"', () => {
    const cli = testCli('app', [
      testCommand('build', { description: 'build it', run: () => ({}) }),
      testCommand('publish', { description: 'ship it', run: () => ({}) }),
    ])
    const help = renderHelp('app', stateOf(cli))
    expect(help).toContain('Commands:')
    expect(help).toContain('build')
    expect(help).toContain('build it')
    expect(help).toContain('publish')
    expect(help).toContain('ship it')
  })

  test('aliases appear in parentheses after command description', () => {
    const cli = testCli('app', [
      testCommand('build', { aliases: ['b'], description: 'build it', run: () => ({}) }),
    ])
    const help = renderHelp('app', stateOf(cli))
    expect(help).toMatch(/build\s+build it \(b\)/)
  })

  test('core does not add helper commands by default', () => {
    const cli = testCli('app', { run: () => ({}) })
    const help = renderHelp('app', stateOf(cli))
    expect(help).not.toMatch(/^Commands:$/m)
    expect(help).not.toContain('completions')
  })
})

describe('renderHelp — examples', () => {
  test('string example renders verbatim under "Examples:"', () => {
    const cli = cliWith('run', {
      examples: ['app run --watch'],
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('Examples:')
    expect(help).toContain('app run --watch')
  })

  test('object example with description renders "<rendered> - <desc>"', () => {
    const cli = cliWith('build', {
      examples: [{ args: { name: 'foo' }, description: 'happy path' }],
      args: z.object({ name: z.string() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['build'])
    expect(help).toContain('app build foo - happy path')
  })

  test('object example with boolean=true option emits flag without value', () => {
    const cli = cliWith('build', {
      examples: [{ options: { dryRun: true, mode: 'fast' } }],
      options: z.object({ dryRun: z.boolean().default(false), mode: z.string().optional() }),
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['build'])
    expect(help).toContain('app build --dry-run --mode fast')
    expect(help).not.toContain('--dry-run true')
  })

  test('no examples → no "Examples:" section', () => {
    const cli = cliWith('run', { run: () => ({}) })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).not.toContain('Examples:')
  })
})

describe('renderHelp — hint and usage blocks', () => {
  test('hint renders after Examples', () => {
    const cli = cliWith('run', {
      examples: ['app run'],
      hint: 'Tip: pass --watch',
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    const examplesIndex = help.indexOf('Examples:')
    const hintIndex = help.indexOf('Tip: pass --watch')
    expect(examplesIndex).toBeGreaterThan(0)
    expect(hintIndex).toBeGreaterThan(examplesIndex)
  })

  test('usage prefix/suffix wrap the binary line', () => {
    const cli = cliWith('fetch', {
      args: z.object({ url: z.string() }),
      usage: [{ args: { url: true }, prefix: 'cat in.txt | ', suffix: ' > out.txt' }],
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['fetch'])
    expect(help).toContain('cat in.txt | app fetch <url> > out.txt')
  })

  test('usage entries can be raw strings', () => {
    const cli = cliWith('run', {
      usage: ['raw usage line here'],
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('raw usage line here')
  })

  test('usage options token includes alias prefix when option has alias', () => {
    const cli = cliWith('run', {
      options: z.object({ format: z.string() }),
      alias: { format: 'f' },
      usage: [{ options: { format: true } }],
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('-f|--format <format>')
  })

  test('boolean option in usage emits no value placeholder', () => {
    const cli = cliWith('run', {
      options: z.object({ dry: z.boolean().default(false) }),
      usage: [{ options: { dry: true } }],
      run: () => ({}),
    })
    const help = renderHelp('app', stateOf(cli), undefined, ['run'])
    expect(help).toContain('--dry')
    expect(help).not.toContain('--dry <dry>')
  })
})

describe('renderHelp — global sections always present', () => {
  test('does not include extension helper commands unless registered', () => {
    const cli = cliWith('run', { run: () => ({}) })
    const help = renderHelp('app', stateOf(cli))
    expect(help).not.toContain('completions')
  })

  test('includes "Global Options:" section with format/help/version', () => {
    const cli = cliWith('run', { run: () => ({}) })
    const help = renderHelp('app', stateOf(cli))
    expect(help).toContain('Global Options:')
    expect(help).toContain('--format <json|yaml|md|jsonl|csv>')
    expect(help).toContain('--help, -h')
    expect(help).toContain('--version')
  })
})

describe('help({ renderer })', () => {
  test('custom renderer handles explicit root help, command help, and fallback help', async () => {
    const renderer = (model: any, context: any) => [
      `CUSTOM ${model.name}`,
      `binary=${context.binaryName}`,
      `path=${model.path.join('/')}`,
      `commands=${model.commands.map((command: any) => command.name).join(',')}`,
      `globals=${model.globals.map((global: any) => global.label).join(',')}`,
    ].join('\n')
    const cli = defineCli({
      name: 'app',
      extensions: [helpControl({ renderer })],
      commands: [
        defineCommand({
          path: ['run'],
          description: 'run it',
          run: () => ({ ok: true }),
        }),
      ],
    })

    const root = await runCli(cli, ['--help'])
    expect(root.stdout).toBe('CUSTOM app\nbinary=app\npath=\ncommands=run\nglobals=--help, -h\n')

    const command = await runCli(cli, ['run', '--help'])
    expect(command.stdout).toBe('CUSTOM app run\nbinary=app\npath=run\ncommands=\nglobals=--help, -h\n')

    const fallback = await runCli(cli, [])
    expect(fallback.stdout).toBe(root.stdout)
  })

  test('custom renderer can wrap the public defaultHelpRenderer', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        helpControl({
          renderer: (model, context) => `${defaultHelpRenderer(model, context)}\nWrapped help.`,
        }),
      ],
      commands: [
        defineCommand({
          path: ['run'],
          description: 'run it',
          run: () => ({ ok: true }),
        }),
      ],
    })

    const result = await runCli(cli, ['--help'])
    expect(result.stdout).toContain('Usage: app <command>')
    expect(result.stdout).toContain('Wrapped help.')
  })

  test('human validation diagnostics use the configured renderer', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [helpControl({ renderer: (model) => `CUSTOM HELP ${model.name}` })],
      commands: [
        defineCommand({
          path: ['deploy'],
          input: { options: z.object({ name: z.string() }) },
          run: () => ({ ok: true }),
        }),
      ],
    })

    const result = await runCli(cli, ['deploy'], { streams: { stdin: 'tty', stdout: 'tty', stderr: 'tty' } })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('See below for usage.')
    expect(result.stderr).toContain('CUSTOM HELP app deploy')
  })
})
