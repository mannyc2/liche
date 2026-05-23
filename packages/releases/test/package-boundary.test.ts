import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

type PackageJson = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  exports?: Record<string, unknown>
}

// @lili/releases depends on @lili/core for the shared declarative CLI framework
// used by li-release. It must still stay clear of @lili/build and @lili/product
// so it can be consumed standalone as a library by anyone authoring releases.
const FORBIDDEN_RUNTIME_DEPS = ['@lili/build', '@lili/product'] as const
const RUNTIME_DEP_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const

function packageJson(): PackageJson {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'))
}

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path)
  }
  return files
}

describe('package boundary', () => {
  test('@lili/releases has no runtime dependency on core, build, or product', () => {
    const pkg = packageJson()

    for (const section of RUNTIME_DEP_SECTIONS) {
      const deps = pkg[section] ?? {}
      for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
        expect(deps[dependency]).toBeUndefined()
      }
    }
  })

  test('@lili/releases source does not import core, build, or product', () => {
    const source = sourceFiles(join(import.meta.dir, '..', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
      expect(source).not.toContain(dependency)
    }
  })

  test('package exports keep renderer implementations behind subpaths', () => {
    const exports = packageJson().exports ?? {}

    expect(exports['.']).toBeDefined()
    expect(exports['./package']).toBeDefined()
    expect(exports['./renderers']).toBeDefined()
    expect(exports['./renderers/all']).toBeDefined()
    expect(exports['./renderers/npm']).toBeDefined()
    expect(exports['./renderers/pypi']).toBeDefined()
    expect(exports['./renderers/homebrew']).toBeDefined()
    expect(exports['./renderers/scoop']).toBeDefined()
    expect(exports['./publishers']).toBeDefined()
  })

  test('root runtime export does not expose concrete renderers', async () => {
    const root = await import('../src/index.js')
    const rootSource = readFileSync(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf8')

    expect('npmRenderer' in root).toBe(false)
    expect('pypiRenderer' in root).toBe(false)
    expect('homebrewRenderer' in root).toBe(false)
    expect('scoopRenderer' in root).toBe(false)
    expect('createDefaultRendererRegistry' in root).toBe(false)
    expect(rootSource).not.toContain('./renderers/all')
    expect(rootSource).not.toContain('./renderers/npm')
    expect(rootSource).not.toContain('./renderers/pypi')
    expect(rootSource).not.toContain('./renderers/homebrew')
    expect(rootSource).not.toContain('./renderers/scoop')
  })

  test('renderer subpaths expose individual renderers and all-renderer registry', async () => {
    const npm = await import('../src/renderers/npm.js')
    const pypi = await import('../src/renderers/pypi.js')
    const homebrew = await import('../src/renderers/homebrew.js')
    const scoop = await import('../src/renderers/scoop.js')
    const all = await import('../src/renderers/all.js')

    expect(npm.npmRenderer.id).toBe('npm')
    expect(pypi.pypiRenderer.id).toBe('pypi')
    expect(homebrew.homebrewRenderer.id).toBe('homebrew')
    expect(scoop.scoopRenderer.id).toBe('scoop')
    expect(Object.keys(all.createDefaultRendererRegistry()).sort()).toEqual([
      'homebrew',
      'npm',
      'pypi',
      'scoop',
    ])
  })
})
