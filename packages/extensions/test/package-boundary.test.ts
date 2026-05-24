import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

type PackageJson = {
  dependencies?: Record<string, string>
  exports?: Record<string, unknown>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const FORBIDDEN_RUNTIME_DEPS = ['@liche/build', '@liche/product', '@liche/releases'] as const
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

describe('package boundary: @liche/extensions', () => {
  test('has no runtime dependency on product, build, or releases', () => {
    const pkg = packageJson()

    for (const section of RUNTIME_DEP_SECTIONS) {
      const deps = pkg[section] ?? {}
      for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
        expect(deps[dependency]).toBeUndefined()
      }
    }
  })

  test('imports only the public core package path', () => {
    const source = sourceFiles(join(import.meta.dir, '..', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(source).toContain('@liche/core')
    expect(source).not.toMatch(/packages\/core\/src/)
    expect(source).not.toMatch(/@liche\/core\/src/)
    for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
      expect(source).not.toContain(dependency)
    }
  })

  test('exports lanes as package subpaths', async () => {
    const exports = packageJson().exports ?? {}
    const root = await import('../src/index.js')
    const auth = await import('../src/auth.js')
    const config = await import('../src/config.js')
    const helpers = await import('../src/helpers.js')
    const support = await import('../src/support.js')

    expect(exports['.']).toBeDefined()
    expect(exports['./auth']).toBeDefined()
    expect(exports['./config']).toBeDefined()
    expect(exports['./agents']).toBeDefined()
    expect(exports['./completions']).toBeDefined()
    expect(exports['./mcp']).toBeDefined()
    expect(exports['./skills']).toBeDefined()
    expect(exports['./support']).toBeDefined()
    expect(root.auth).toBe(auth.auth)
    expect(root.config).toBe(config.config)
    expect(root.agents).toBe(helpers.agents)
    expect(root.completions).toBe(helpers.completions)
    expect(root.mcpInstaller).toBe(helpers.mcpInstaller)
    expect(root.skillsInstaller).toBe(helpers.skillsInstaller)
    expect(root.runLocalDoctor).toBe(support.runLocalDoctor)
  })
})
