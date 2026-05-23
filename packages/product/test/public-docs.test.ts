import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PUBLIC_READMES = [
  'README.md',
  'packages/core/README.md',
  'packages/build/README.md',
  'packages/product/README.md',
  'packages/releases/README.md',
] as const

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

function codeBlocks(markdown: string): Array<{ lang: string; code: string }> {
  return [...markdown.matchAll(/```(\w*)\n([\s\S]*?)```/g)]
    .map((match) => ({ lang: match[1] ?? '', code: match[2] ?? '' }))
}

describe('public docs', () => {
  test('root and package READMEs describe the v1 workflow instead of internal planning docs', () => {
    const root = read('README.md')
    expect(root).toContain('Handwritten CLI')
    expect(root).toContain('Product Schema')
    expect(root).toContain('Compile')
    expect(root).toContain('Package And Publish')
    expect(root).not.toMatch(/Rewrite planning docs|Key planning decisions|docs\/next-plan|docs\/coverage-rewrite/)

    for (const path of PUBLIC_READMES) {
      const markdown = read(path)
      expect(markdown).not.toMatch(/packages\/[^/\s]+\/src|source-relative internals|internal requirement docs/)
      if (path.startsWith('packages/')) expect(markdown).not.toContain('docs/')
    }
  })

  test('runnable public README snippets use package names and public commands only', () => {
    for (const path of PUBLIC_READMES) {
      for (const block of codeBlocks(read(path))) {
        if (block.lang === 'ts') {
          expect(block.code).not.toMatch(/from ["']\.\.?\/|from ["']packages\//)
          expect(block.code).not.toMatch(/@lili\/(?:core|build|product|releases)\/src/)
        }
        if (block.lang === 'sh') {
          expect(block.code).not.toMatch(/packages\/[^/\s]+\/src/)
          expect(block.code).not.toMatch(/docs\//)
          expect(block.code).toMatch(/^(li-build|li-product|li-release|bun add|bun run|bun test)/m)
        }
      }
    }
  })
})
