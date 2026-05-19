import { describe, expect, test } from 'bun:test'
import { canonicalDigest, Command, Field, normalizeProduct, Product, Shape } from '../src/index.js'

function buildA() {
  return Product.create({ id: 'workers', name: 'Workers', version: '1.0.0' })
    .resource('script', { label: 'Worker script', path: '/workers/scripts' }, (r) =>
      r
        .field('id', Field.string('Script ID').identifier().immutable())
        .field('name', Field.string('Script name').humanLabel()),
    )
    .command('deploy', Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }))
}

function buildBReordered() {
  return Product.create({ version: '1.0.0', id: 'workers', name: 'Workers' })
    .resource('script', { path: '/workers/scripts', label: 'Worker script' }, (r) =>
      r
        .field('id', Field.string('Script ID').identifier().immutable())
        .field('name', Field.string('Script name').humanLabel()),
    )
    .command('deploy', Command.workflow({ handler: 'wrangler.deploy', summary: 'Deploy' }))
}

describe('canonicalDigest', () => {
  test('produces sha256:<hex> format', () => {
    const digest = canonicalDigest({ a: 1 })
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test('two products with reordered init keys produce identical catalog digests', () => {
    const catA = normalizeProduct(buildA())
    const catB = normalizeProduct(buildBReordered())
    expect(canonicalDigest(catA)).toBe(canonicalDigest(catB))
  })

  test('reordered Shape.object properties do not change the digest', () => {
    const a = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        input: Shape.object({
          entrypoint: Field.string('Entrypoint'),
          environment: Field.string('Environment').optional(),
        }),
      }),
    )
    const b = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        input: Shape.object({
          environment: Field.string('Environment').optional(),
          entrypoint: Field.string('Entrypoint'),
        }),
      }),
    )
    expect(canonicalDigest(normalizeProduct(a))).toBe(canonicalDigest(normalizeProduct(b)))
  })

  test('changing a field name in input changes the digest', () => {
    const a = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        input: Shape.object({ a: Field.string('a') }),
      }),
    )
    const b = Product.create({ id: 'p', name: 'P', version: '0.1.0' }).command(
      'deploy',
      Command.workflow({
        summary: 'Deploy',
        handler: 'h.deploy',
        input: Shape.object({ b: Field.string('a') }),
      }),
    )
    expect(canonicalDigest(normalizeProduct(a))).not.toBe(canonicalDigest(normalizeProduct(b)))
  })

  test('throws when value contains a function (functions are not digestable)', () => {
    expect(() => canonicalDigest({ run: () => 1 })).toThrow(/functions are not digestable/)
  })
})
