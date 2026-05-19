import { describe, expect, test } from 'bun:test'
import {
  Command,
  DEFAULT_GENERATED_VOCABULARY,
  Field,
  lintCatalog,
  normalizeProduct,
  Product,
  Shape,
  vocabulary,
} from '../src/index.js'

function lintProductInput(product: Product) {
  return lintCatalog(normalizeProduct(product))
}

describe('lintCatalog — vocabulary/verb', () => {
  test("resource operation verb 'info' fails vocabulary/verb when not in the active vocabulary", () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('info', {
          summary: 'Info',
          output: Shape.object({ id: Field.string('id') }),
        }),
    )
    const issues = lintProductInput(p)
    const issue = issues.find((i) => i.code === 'vocabulary/verb')
    expect(issue).toBeDefined()
    expect(issue?.recommendation).toContain("add 'info'")
  })

  test("default vocabulary verbs ('list','get','create','update','delete','run') are accepted", () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('list', {
          summary: 'List',
          output: Shape.list('script'),
        }),
    )
    const issues = lintProductInput(p)
    expect(issues.find((i) => i.code === 'vocabulary/verb')).toBeUndefined()
  })

  test('product vocabulary can extend the verb allowlist for resource operations', () => {
    const p = Product.create({
      id: 'workers',
      name: 'Workers',
      version: '1.0.0',
      vocabulary: vocabulary({ verbs: ['purge'] }),
    }).resource('script', { label: 'Script', path: '/scripts' }, (r) =>
      r.operation('purge', {
        summary: 'Purge',
        output: Shape.object({ purged: Field.boolean('purged') }),
      }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'vocabulary/verb')).toBeUndefined()
  })

  test('top-level commands are not subject to the verb allowlist', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'deploy',
      Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'vocabulary/verb')).toBeUndefined()
  })
})

describe('lintCatalog — product/id', () => {
  test('product id violating the stable-id pattern fails product/id-stable', () => {
    const p = Product.create({ id: 'Workers!', name: 'Workers', version: '1.0.0' })
    expect(lintProductInput(p).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })

  test('empty product version fails product/version-required', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '' })
    expect(lintProductInput(p).find((i) => i.code === 'product/version-required')).toBeDefined()
  })
})

describe('lintCatalog — resource/path', () => {
  test('resource with empty path fails resource/path-required', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '' },
      (r) =>
        r.operation('list', {
          summary: 'List',
          output: Shape.list('script'),
        }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'resource/path-required')).toBeDefined()
  })
})

describe('lintCatalog — surface/openapi-on-local', () => {
  test('local command opted into surfaces.openapi fails the lint', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'dev',
      Command.local({
        summary: 'Dev',
        handler: 'wrangler.dev',
        surfaces: { openapi: true },
      }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'surface/openapi-on-local')).toBeDefined()
  })

  test('local command without surfaces.openapi passes', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'dev',
      Command.local({ summary: 'Dev', handler: 'wrangler.dev' }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — command/execution-coherent', () => {
  test('hybrid-workflow opted into OpenAPI without an http trigger fails', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'wrangler.deploy',
        surfaces: { openapi: true },
      }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'command/execution-coherent')).toBeDefined()
  })

  test('hybrid-workflow with http trigger and surfaces.openapi=true passes', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'wrangler.deploy',
        http: { method: 'POST', path: '/deploy' },
        surfaces: { openapi: true },
      }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'command/execution-coherent'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — shape/unknown-resource-ref', () => {
  test('Shape.list pointing at an undeclared resource fails the lint', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('list', {
          summary: 'List',
          output: Shape.list('ghost'),
        }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'shape/unknown-resource-ref')).toBeDefined()
  })

  test('Shape.list pointing at a declared resource passes', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('list', {
          summary: 'List',
          output: Shape.list('script'),
        }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'shape/unknown-resource-ref'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — clean product', () => {
  test('workers-style product with resource + workflow + local command produces no issues', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
      .resource('script', { label: 'Worker script', path: '/workers/scripts' }, (r) =>
        r
          .field('id', Field.string('Script ID').identifier().immutable())
          .field('name', Field.string('Script name').humanLabel())
          .operation('list', {
            summary: 'List Worker scripts',
            http: { method: 'GET', path: '' },
            output: Shape.list('script'),
          }),
      )
      .command('deploy', Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }))
      .command('dev', Command.local({ summary: 'Dev', handler: 'wrangler.dev' }))
    expect(lintProductInput(p)).toEqual([])
  })
})

describe('lintCatalog — issue shape (code, path, message, recommendation)', () => {
  test('product/id-required has the expected code, path, and message', () => {
    const p = Product.create({ id: '', name: 'Workers', version: '1.0.0' })
    const issue = lintProductInput(p).find((i) => i.code === 'product/id-required')
    expect(issue).toEqual({
      code: 'product/id-required',
      path: 'product.id',
      message: 'Product id must be a non-empty string',
    })
  })

  test('product/version-required has the expected code, path, and message', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '' })
    const issue = lintProductInput(p).find((i) => i.code === 'product/version-required')
    expect(issue).toEqual({
      code: 'product/version-required',
      path: 'product.version',
      message: 'Product version must be a non-empty string',
    })
  })

  test('product/id-stable mentions the offending id in the message', () => {
    const p = Product.create({ id: 'Workers!', name: 'Workers', version: '1.0.0' })
    const issue = lintProductInput(p).find((i) => i.code === 'product/id-stable')
    expect(issue?.path).toBe('product.id')
    expect(issue?.message).toBe("Product id 'Workers!' does not match the stable id pattern")
  })

  test('resource/path-required has the expected code, path, and message', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '' },
      (r) => r.operation('list', { summary: 'List', output: Shape.list('script') }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'resource/path-required')
    expect(issue?.path).toBe('resources[0].path')
    expect(issue?.message).toBe("Resource 'script' must declare a non-empty path")
  })

  test('resource/id-stable fires for invalid resource ids and includes the id', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'Bad!',
      { label: 'Bad', path: '/bad' },
      (r) => r.operation('list', { summary: 'List', output: Shape.list('Bad!') }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'resource/id-stable')
    expect(issue?.path).toBe('resources[0].id')
    expect(issue?.message).toBe("Resource id 'Bad!' does not match the stable id pattern")
  })

  test('vocabulary/verb issue includes recommendation listing the active verbs', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('info', {
          summary: 'Info',
          output: Shape.list('script'),
        }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'vocabulary/verb')
    expect(issue?.path).toBe('capabilities[0].verb')
    expect(issue?.message).toBe(
      "Resource operation verb 'info' is not in the product vocabulary",
    )
    expect(issue?.recommendation).toBe(
      "add 'info' to vocabulary({ verbs: [...] }) or use one of: get, list, create, update, delete, run",
    )
  })

  test('surface/openapi-on-local has the expected path and message', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'dev',
      Command.local({ summary: 'Dev', handler: 'wrangler.dev', surfaces: { openapi: true } }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'surface/openapi-on-local')
    expect(issue?.path).toBe('capabilities[0].surfaces.openapi')
    expect(issue?.message).toBe(
      "Local command 'dev' must not appear in OpenAPI; remove surfaces.openapi or change execution mode",
    )
  })

  test('command/execution-coherent has the expected path, message, and recommendation', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'wrangler.deploy',
        surfaces: { openapi: true },
      }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'command/execution-coherent')
    expect(issue?.path).toBe('capabilities[0].execution.http')
    expect(issue?.message).toBe(
      "Hybrid-workflow command 'deploy' opted into OpenAPI but has no http trigger",
    )
    expect(issue?.recommendation).toBe(
      'declare http: { method, path } on the workflow or set surfaces.openapi=false',
    )
  })

  test('command/id-stable fires for invalid command ids and includes the id', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).command(
      'Bad-Id!',
      Command.local({ summary: 'Bad', handler: 'wrangler.bad' }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'command/id-stable')
    expect(issue?.path).toBe('capabilities[0].id')
    expect(issue?.message).toBe("Command id 'Bad-Id!' does not match the stable id pattern")
  })

  test('shape/unknown-resource-ref has the expected path, message, and recommendation', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) => r.operation('list', { summary: 'List', output: Shape.list('ghost') }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'shape/unknown-resource-ref')
    expect(issue?.path).toBe('capabilities[0].output')
    expect(issue?.message).toBe("Shape.list references unknown resource 'ghost'")
    expect(issue?.recommendation).toBe(
      'declare the resource with Product.create(...).resource(id, ...) or fix the reference',
    )
  })
})

describe('lintCatalog — hasText whitespace handling', () => {
  test('product id with only whitespace fails product/id-required (trim is not skipped)', () => {
    const p = Product.create({ id: '   ', name: 'W', version: '1.0.0' })
    expect(lintProductInput(p).find((i) => i.code === 'product/id-required')).toBeDefined()
  })

  test('product version with only whitespace fails product/version-required', () => {
    const p = Product.create({ id: 'workers', name: 'W', version: '   ' })
    expect(lintProductInput(p).find((i) => i.code === 'product/version-required')).toBeDefined()
  })

  test('resource path with only whitespace fails resource/path-required', () => {
    const p = Product.create({ id: 'workers', name: 'W', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '   ' },
      (r) => r.operation('list', { summary: 'List', output: Shape.list('script') }),
    )
    expect(lintProductInput(p).find((i) => i.code === 'resource/path-required')).toBeDefined()
  })
})

describe('lintCatalog — surface/openapi-on-local is local-mode-only', () => {
  test('workflow command with openapi=true does NOT trip surface/openapi-on-local (only local-mode does)', () => {
    const p = Product.create({ id: 'workers', name: 'W', version: '1.0.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'wrangler.deploy',
        http: { method: 'POST', path: '/deploy' },
        surfaces: { openapi: true },
      }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeUndefined()
  })

  test('workflow command without openapi opt-in does NOT trip surface/openapi-on-local', () => {
    const p = Product.create({ id: 'workers', name: 'W', version: '1.0.0' }).command(
      'deploy',
      Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — ID_PATTERN edge cases', () => {
  test('uppercase-start ids fail (anchors on ^)', () => {
    const p = Product.create({ id: 'Workers', name: 'W', version: '1.0.0' })
    expect(lintProductInput(p).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })

  test('ids with trailing junk fail (anchors on $)', () => {
    const p = Product.create({ id: 'workers!', name: 'W', version: '1.0.0' })
    expect(lintProductInput(p).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })

  test('valid ids with dot or dash separators and multi-char segments pass', () => {
    const p = Product.create({ id: 'workers.platform', name: 'W', version: '1.0.0' })
      .resource('cli-tool', { label: 'CLI', path: '/cli' }, (r) =>
        r.operation('list', { summary: 'List', output: Shape.list('cli-tool') }),
      )
      .command('sub.command', Command.local({ summary: 'Sub', handler: 'h' }))
    const issues = lintProductInput(p)
    expect(issues.find((i) => i.code === 'product/id-stable')).toBeUndefined()
    expect(issues.find((i) => i.code === 'resource/id-stable')).toBeUndefined()
    expect(issues.find((i) => i.code === 'command/id-stable')).toBeUndefined()
  })

  test('ids with consecutive separators (no segment in between) fail', () => {
    const p = Product.create({ id: 'workers..platform', name: 'W', version: '1.0.0' })
    expect(lintProductInput(p).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })
})

describe('lintCatalog — operation/output-required and isNonEmptyShape', () => {
  test('operation with an object output that has zero properties fails operation/output-required', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) => r.operation('list', { summary: 'List', output: Shape.object({}) }),
    )
    const issue = lintProductInput(p).find((i) => i.code === 'operation/output-required')
    expect(issue?.path).toBe('capabilities[0].output')
    expect(issue?.message).toBe(
      "Resource operation 'script.list' must declare a non-empty output schema",
    )
  })

  test('operation with a non-empty object output does NOT fail operation/output-required', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) =>
        r.operation('list', {
          summary: 'List',
          output: Shape.object({ id: Field.string('id') }),
        }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'operation/output-required'),
    ).toBeUndefined()
  })

  test('operation with a list output is treated as non-empty (kind === "list" short-circuit)', () => {
    const p = Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' }).resource(
      'script',
      { label: 'Script', path: '/scripts' },
      (r) => r.operation('list', { summary: 'List', output: Shape.list('script') }),
    )
    expect(
      lintProductInput(p).find((i) => i.code === 'operation/output-required'),
    ).toBeUndefined()
  })
})

describe('vocabulary() — merge semantics', () => {
  test('no overrides returns defaults by identity for verbs and flags', () => {
    const v = vocabulary()
    expect(v.verbs).toBe(DEFAULT_GENERATED_VOCABULARY.verbs)
    expect(v.flags).toBe(DEFAULT_GENERATED_VOCABULARY.flags)
    expect(v.aliases).toEqual({})
  })

  test('empty-array override returns the default list by identity (mergeUnique short-circuit)', () => {
    const v = vocabulary({ verbs: [], flags: [] })
    expect(v.verbs).toBe(DEFAULT_GENERATED_VOCABULARY.verbs)
    expect(v.flags).toBe(DEFAULT_GENERATED_VOCABULARY.flags)
  })

  test('non-empty override appends to the defaults and preserves the default order', () => {
    const v = vocabulary({ verbs: ['purge', 'inspect'] })
    expect(v.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs, 'purge', 'inspect'])
  })

  test('override entries that duplicate a default are deduped (Set guard)', () => {
    const v = vocabulary({ verbs: ['get', 'purge', 'list'] })
    expect(v.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs, 'purge'])
  })

  test('override entries that duplicate each other are deduped against the running set', () => {
    const v = vocabulary({ verbs: ['purge', 'purge', 'inspect', 'purge'] })
    expect(v.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs, 'purge', 'inspect'])
  })

  test('aliases override merges into default aliases (not replaces)', () => {
    const v = vocabulary({ aliases: { ls: 'list', rm: 'delete' } })
    expect(v.aliases).toEqual({ ls: 'list', rm: 'delete' })
    expect(Object.keys(v.aliases).sort()).toEqual(['ls', 'rm'])
  })

  test('aliases override with later keys wins over earlier defaults of the same key', () => {
    const v = vocabulary({ aliases: { ls: 'list' } })
    expect(v.aliases.ls).toBe('list')
  })

  test('undefined aliases override yields an empty aliases object, not undefined', () => {
    const v = vocabulary({ verbs: ['purge'] })
    expect(v.aliases).toEqual({})
    expect(typeof v.aliases).toBe('object')
  })
})
