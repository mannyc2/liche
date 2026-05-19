import { describe, expect, test } from 'bun:test'
import { Cli, z } from '../src/index.js'
import * as Skill from '../src/skills/index.js'
import { stateSymbol, type InternalCli } from '../src/cli/create.js'

function stateOf(cli: any) {
  return (cli as InternalCli)[stateSymbol]
}

describe('skillMarkdown — exact output shape', () => {
  test('uses packaged skill markdown when the CLI provides one', () => {
    const cli = Cli.create('tool', {
      skill: {
        index: '# tool\npackaged index',
        markdown: '---\nname: tool\ndescription: packaged skill\n---\n\n# Packaged',
      },
    }).command('run', { run: () => ({}) })
    expect(Skill.skillMarkdown('tool', stateOf(cli))).toBe('---\nname: tool\ndescription: packaged skill\n---\n\n# Packaged')
  })

  test('frontmatter falls back to "<name> CLI" when no description set', () => {
    const cli = Cli.create('tool').command('run', { run: () => ({}) })
    const md = Skill.skillMarkdown('tool', stateOf(cli))
    expect(md).toContain('---\nname: tool\ndescription: tool CLI\n---')
  })

  test('description appears in frontmatter and body', () => {
    const cli = Cli.create('ship', { description: 'release helper', run: () => ({ ok: true }) })
    const md = Skill.skillMarkdown('ship', stateOf(cli))
    expect(md.startsWith('---\nname: ship\ndescription: release helper\n---\n\n# ship\n\nrelease helper\n\n## Commands')).toBe(true)
  })

  test('root command renders bare `$ name` code block (no command suffix)', () => {
    const cli = Cli.create('ship', { description: 'release helper', run: () => ({ ok: true }) })
    const md = Skill.skillMarkdown('ship', stateOf(cli))
    expect(md).toContain('### (root)\nrelease helper\n\n`$ ship`')
    expect(md).not.toContain('`$ ship (root)`')
  })

  test('child command renders `$ name child` code block', () => {
    const cli = Cli.create('ship').command('publish', {
      description: 'publish a release',
      run: () => ({ ok: true }),
    })
    const md = Skill.skillMarkdown('ship', stateOf(cli))
    expect(md).toContain('### publish\npublish a release\n\n`$ ship publish`')
  })

  test('options table renders with kebab-cased flag names', () => {
    const cli = Cli.create('app').command('build', {
      options: z.object({ dryRun: z.boolean().describe('skip writes').default(false) }),
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).toContain('| Flag | Description |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| --dry-run | skip writes |')
    expect(md).not.toContain('| --dryRun |')
  })

  test('deprecated options get " **Deprecated.**" suffix in description cell', () => {
    const cli = Cli.create('app').command('build', {
      options: z.object({
        legacy: z.boolean().describe('old flag').meta({ deprecated: true }).default(false),
        modern: z.string().describe('new flag').optional(),
      }),
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).toContain('| --legacy | old flag **Deprecated.** |')
    expect(md).toContain('| --modern | new flag |')
    expect(md).not.toContain('| --modern | new flag **Deprecated.**')
  })

  test('hint renders as a blockquote line', () => {
    const cli = Cli.create('app').command('run', {
      hint: 'use --watch',
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).toContain('\n> use --watch')
  })

  test('no hint => no blockquote', () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).not.toContain('\n> ')
  })

  test('examples render under "**Examples**" with backtick-wrapped commands', () => {
    const cli = Cli.create('app').command('run', {
      examples: ['app run foo'],
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).toContain('**Examples**')
    expect(md).toContain('- `app run foo`')
  })

  test('object example with boolean=true emits flag without value; non-boolean emits flag + value', () => {
    const cli = Cli.create('app').command('build', {
      examples: [{ options: { dryRun: true, mode: 'fast' } }],
      options: z.object({ dryRun: z.boolean().default(false), mode: z.string().optional() }),
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).toContain('- `app build --dry-run --mode fast`')
    expect(md).not.toContain('--dry-run true')
    expect(md).not.toContain('--dryRun')
  })

  test('example for root command omits "(root)" in rendered command', () => {
    const cli = Cli.create('ship', {
      examples: [{ args: { tag: 'v1' } }],
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('ship', stateOf(cli))
    expect(md).toContain('- `ship v1`')
    expect(md).not.toContain('- `ship (root)')
  })

  test('example with description appends " — desc"', () => {
    const cli = Cli.create('app').command('run', {
      examples: [{ description: 'happy path', args: {} }],
      run: () => ({}),
    })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).toContain('- `app run` — happy path')
  })

  test('no examples => no "**Examples**" heading', () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).not.toContain('**Examples**')
  })

  test('no options => no options table', () => {
    const cli = Cli.create('app').command('run', { run: () => ({}) })
    const md = Skill.skillMarkdown('app', stateOf(cli))
    expect(md).not.toContain('| Flag | Description |')
  })
})

describe('skillIndex — exact output shape', () => {
  test('uses packaged skill index when the CLI provides one', () => {
    const cli = Cli.create('tool', {
      skill: {
        index: '# tool\npackaged index',
        markdown: '# full skill',
      },
    }).command('run', { run: () => ({}) })
    expect(Skill.skillIndex('tool', stateOf(cli))).toBe('# tool\npackaged index')
  })

  test('renders header, blank, then one bullet per command', () => {
    const cli = Cli.create('ship', { description: 'release helper', run: () => ({ ok: true }) }).command('publish', {
      description: 'publish a release',
      run: () => ({}),
    })
    expect(Skill.skillIndex('ship', stateOf(cli))).toBe(
      '# ship\nrelease helper\n\n- (root): release helper\n- publish: publish a release',
    )
  })

  test('empty description renders as bare ": "', () => {
    const cli = Cli.create('tool').command('run', { run: () => ({}) })
    const index = Skill.skillIndex('tool', stateOf(cli))
    expect(index).toContain('- run: ')
    expect(index.startsWith('# tool\n\n\n')).toBe(true)
  })
})
