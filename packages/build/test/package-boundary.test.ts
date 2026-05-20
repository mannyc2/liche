import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

type PackageJson = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const FORBIDDEN_RUNTIME_DEPS = ['@lili/product', '@lili/releases'] as const
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

describe('package boundary: @lili/build', () => {
  test('has no runtime dependency on product or releases', () => {
    const pkg = packageJson()

    for (const section of RUNTIME_DEP_SECTIONS) {
      const deps = pkg[section] ?? {}
      for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
        expect(deps[dependency]).toBeUndefined()
      }
    }
  })

  test('source does not import product or releases', () => {
    const source = sourceFiles(join(import.meta.dir, '..', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
      expect(source).not.toContain(dependency)
    }
  })
})
