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

  test('umbrella source does not reach into internal core paths or forbidden packages', () => {
    const source = sourceFiles(join(import.meta.dir, '..', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/packages\/core\/src/)
    expect(source).not.toMatch(/@liche\/core\/src/)
    for (const dependency of FORBIDDEN_RUNTIME_DEPS) {
      expect(source).not.toContain(dependency)
    }
  })

  test('umbrella re-exports each leaf package without exposing subpaths', async () => {
    const exports = packageJson().exports ?? {}
    const root = await import('../src/index.js')
    const auth = await import('@liche/auth')
    const config = await import('@liche/config')
    const agents = await import('@liche/agents')
    const completions = await import('@liche/completions')
    const mcpInstaller = await import('@liche/mcp-installer')
    const mcpServer = await import('@liche/mcp-server')
    const skillsInstaller = await import('@liche/skills-installer')
    const skillsRuntime = await import('@liche/skills-runtime')
    const telemetry = await import('@liche/telemetry')

    expect(exports['.']).toBeDefined()
    for (const subpath of [
      './auth',
      './config',
      './agents',
      './completions',
      './mcp-installer',
      './mcp-server',
      './skills-installer',
      './skills-runtime',
      './telemetry',
      './support',
    ]) {
      expect(exports[subpath]).toBeUndefined()
    }
    expect(root.auth).toBe(auth.auth)
    expect(root.config).toBe(config.config)
    expect(root.agents).toBe(agents.agents)
    expect(root.llms).toBe(agents.llms)
    expect(root.completions).toBe(completions.completions)
    expect(root.mcpInstaller).toBe(mcpInstaller.mcpInstaller)
    expect(root.mcpServer).toBe(mcpServer.mcpServer)
    expect(root.skillsInstaller).toBe(skillsInstaller.skillsInstaller)
    expect(root.skillsRuntime).toBe(skillsRuntime.skillsRuntime)
    expect(root.jsonlFileSink).toBe(telemetry.jsonlFileSink)
    expect('runLocalDoctor' in root).toBe(false)
  })
})
