import { describe, expect, test } from 'bun:test'
import {
  Command,
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
