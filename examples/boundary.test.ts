import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const exampleFiles = [
  'README.md',
  'ci/README.md',
  'ci/package.json',
  'ci/smoke.test.ts',
  'ci/src/cli.ts',
  'core-handwritten/README.md',
  'core-handwritten/cli.ts',
  'core-handwritten/smoke.test.ts',
  'product-auth-context/README.md',
  'product-auth-context/product.ts',
  'product-auth-context/run-generated.ts',
  'product-auth-context/smoke.test.ts',
  'product-auth-session/README.md',
  'product-auth-session/product.ts',
  'product-auth-session/run-generated.ts',
  'product-auth-session/smoke.test.ts',
  'product-workers/README.md',
  'product-workers/product.ts',
  'product-workers/run-generated.ts',
  'product-workers/smoke.test.ts',
  'release-renderers/README.md',
  'release-renderers/smoke.test.ts',
]

describe('examples dogfood package boundaries', () => {
  test('examples import public package names and expose one smoke command', () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'))
    expect(packageJson.scripts['examples:smoke']).toBe('bun test examples')

    const violations: string[] = []
    for (const file of exampleFiles) {
      const source = readFileSync(join(import.meta.dir, file), 'utf8')
      if (/packages\/[^/\s]+\/src/.test(source)) violations.push(`${file}: package source path`)
      if (/\.\.\/\.\.\/packages/.test(source)) violations.push(`${file}: relative package import`)
      if (new RegExp(`bun ${'packages/'}`).test(source)) violations.push(`${file}: source CLI command`)
    }
    expect(violations).toEqual([])
  })

  test('tracked example files stay inside the examples tree', () => {
    for (const file of exampleFiles) {
      expect(relative(import.meta.dir, join(import.meta.dir, file)).startsWith('..')).toBe(false)
    }
  })
})
