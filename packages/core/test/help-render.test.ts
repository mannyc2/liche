import { describe, expect, test } from 'bun:test'
import { z } from '../src/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'
import { renderHelp } from '../src/help/render.js'
import { testCli, testCommand } from './helpers.js'

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

  test('optionEnv mapping renders "(env: NAME)" suffix', () => {
    const cli = cliWith('run', {
      options: z.object({ token: z.string() }),
      optionEnv: { token: 'APP_TOKEN' },
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
    expect(help).toContain('--format <json|yaml|md|jsonl>')
    expect(help).toContain('--help, -h')
    expect(help).toContain('--version')
  })
})
