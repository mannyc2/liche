import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalDigest,
  checkAgainstDir,
  generateToDir,
  normalizeProduct,
} from '../src/index.js'
import product from './fixtures/workers.product.js'

const GEN_FILE = 'lili.generated.ts'
const OPENAPI_FILE = 'lili.generated.openapi.json'
const COMMANDS_FILE = 'lili.generated.commands.json'
const MCP_FILE = 'lili.generated.mcp.json'
const AGENT_FILE = 'lili.generated.agent.md'
const DOCS_FILE = 'lili.generated.docs.md'
const CONFIG_FILE = 'lili.generated.config.schema.json'
const CATALOG_FILE = 'lili.generated.catalog.json'
const DISCOVERY_FILE = 'lili.generated.discovery.json'
const MANIFEST_FILE = 'lili.generated.manifest.json'

describe('generate --check drift detection', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lili-gen-check-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('fresh generate then check is in sync', async () => {
    const result = await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(result.manifest.manifestVersion).toBe(1)
    expect(result.manifest.surfaces[0]!.id).toBe('cli')
    expect(result.manifest.surfaces[0]!.artifacts).toEqual([GEN_FILE])
    expect(result.manifest.surfaces[1]!.id).toBe('openapi')
    expect(result.manifest.surfaces[1]!.source).toBe('openapi')
    expect(result.manifest.surfaces[1]!.artifacts).toEqual([OPENAPI_FILE])
    expect(result.manifest.surfaces.map((surface) => surface.id)).toEqual([
      'cli',
      'openapi',
      'command-manifest',
      'mcp-tools',
      'agent-reference',
      'docs-reference',
      'config-schema',
      'catalog',
      'discovery',
    ])
    expect(result.manifest.surfaces.map((surface) => surface.artifacts[0])).toEqual([
      GEN_FILE,
      OPENAPI_FILE,
      COMMANDS_FILE,
      MCP_FILE,
      AGENT_FILE,
      DOCS_FILE,
      CONFIG_FILE,
      CATALOG_FILE,
      DISCOVERY_FILE,
    ])
    const discovery = JSON.parse(result.artifacts.discovery!.contents)
    expect(discovery.ops.release).toMatchObject({
      version: '1.0.0',
      latestVersion: '1.1.0',
      channel: 'stable',
      installManagers: ['bun', 'npm'],
      yankedVersions: ['0.9.0'],
    })

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(true)
  })

  test('hand-edit to generated file fails check with output digest mismatch', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, GEN_FILE)
    const before = await Bun.file(path).text()
    await Bun.write(path, before.replace("'script'", "'script-edited'"))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift.some((d) => d.includes("surface 'cli' output digest mismatch"))).toBe(true)
  })

  test('hand-edit to openapi file fails check with openapi surface mismatch', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, OPENAPI_FILE)
    const before = await Bun.file(path).text()
    await Bun.write(path, before.replace('"Workers"', '"Workers-edited"'))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift.some((d) => d.includes("surface 'openapi' output digest mismatch"))).toBe(true)
  })

  test('hand-edit to command manifest fails check with command-manifest surface mismatch', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, COMMANDS_FILE)
    const before = await Bun.file(path).text()
    await Bun.write(path, before.replace('"workers"', '"workers-edited"'))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift.some((d) => d.includes("surface 'command-manifest' output digest mismatch"))).toBe(true)
  })

  test('hand-edit to docs reference fails check with docs-reference surface mismatch', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, DOCS_FILE)
    const before = await Bun.file(path).text()
    await Bun.write(path, before.replace('Workers CLI reference', 'Edited CLI reference'))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift.some((d) => d.includes("surface 'docs-reference' output digest mismatch"))).toBe(true)
  })

  test('hand-edit to manifest fails check', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, MANIFEST_FILE)
    const manifest = JSON.parse(await Bun.file(path).text())
    manifest.surfaces[0].inputDigest = 'sha256:0000'
    await Bun.write(path, JSON.stringify(manifest, null, 2))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
  })

  test('hand-edit to manifest auth metadata fails check', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, MANIFEST_FILE)
    const manifest = JSON.parse(await Bun.file(path).text())
    manifest.auth.providers[0].id = 'edited-auth'
    await Bun.write(path, JSON.stringify(manifest, null, 2))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift).toContain('manifest auth metadata changed')
  })

  test('hand-edit to openapi surface manifest metadata fails check', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, MANIFEST_FILE)
    const manifest = JSON.parse(await Bun.file(path).text())
    manifest.surfaces[1].source = 'catalog'
    manifest.surfaces[1].artifacts = ['renamed.openapi.json']
    await Bun.write(path, JSON.stringify(manifest, null, 2))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift).toContain("surface 'openapi' source changed")
    expect(check.drift).toContain("surface 'openapi' artifacts changed")
  })

  test('missing files fail check with clear messages', async () => {
    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('expected drift')
    expect(check.drift.join('\n')).toMatch(/generated file missing/)
  })

  test('changing surfaceId option changes generationOptionsDigest without changing inputDigest', async () => {
    const a = await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0', surfaceId: 'cli' })
    const dir2 = mkdtempSync(join(tmpdir(), 'lili-gen-check-2-'))
    try {
      const b = await generateToDir(product, { outDir: dir2, generatorVersion: '0.0.0', surfaceId: 'cli-alt' })
      expect(a.manifest.surfaces[0]!.inputDigest).toBe(b.manifest.surfaces[0]!.inputDigest)
      expect(a.manifest.surfaces[0]!.generationOptionsDigest).not.toBe(
        b.manifest.surfaces[0]!.generationOptionsDigest,
      )
      expect(a.manifest.surfaces[0]!.outputDigest).not.toBe(b.manifest.surfaces[0]!.outputDigest)
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  test('duplicate surface ids are rejected before writing artifacts', async () => {
    await expect(
      generateToDir(product, {
        outDir: dir,
        generatorVersion: '0.0.0',
        surfaceId: 'same',
        openapiSurfaceId: 'same',
      }),
    ).rejects.toThrow(/surface ids must be unique/)
  })

  test('duplicate surface artifact filenames are rejected before writing artifacts', async () => {
    await expect(
      generateToDir(product, {
        outDir: dir,
        generatorVersion: '0.0.0',
        generatedFileName: 'same.out',
        openapiFileName: 'same.out',
      }),
    ).rejects.toThrow(/artifact filenames must be unique/)
  })

  test('manifest shape records the product header and both surfaces', async () => {
    const result = await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const m = result.manifest
    expect(m.manifestVersion).toBe(1)
    expect(m.schema.name).toBe('workers')
    expect(m.schema.version).toBe('1.0.0')
    expect(m.schema.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(m.generatorVersion).toBe('0.0.0')
    expect(m.surfaces).toHaveLength(9)

    const expectedInputDigest = canonicalDigest(normalizeProduct(product))

    const cli = m.surfaces[0]!
    expect(cli.id).toBe('cli')
    expect(cli.source).toBe('catalog')
    expect(cli.inputDigest).toBe(expectedInputDigest)
    expect(cli.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(cli.generationOptionsDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(cli.artifacts).toEqual([GEN_FILE])

    const openapi = m.surfaces[1]!
    expect(openapi.id).toBe('openapi')
    expect(openapi.source).toBe('openapi')
    expect(openapi.inputDigest).toBe(expectedInputDigest)
    expect(openapi.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(openapi.outputDigest).not.toBe(cli.outputDigest)
    expect(openapi.generationOptionsDigest).not.toBe(cli.generationOptionsDigest)
    expect(openapi.artifacts).toEqual([OPENAPI_FILE])

    const byId = new Map(m.surfaces.map((surface) => [surface.id, surface]))
    expect(byId.get('command-manifest')?.source).toBe('catalog')
    expect(byId.get('command-manifest')?.artifacts).toEqual([COMMANDS_FILE])
    expect(byId.get('mcp-tools')?.source).toBe('catalog')
    expect(byId.get('mcp-tools')?.artifacts).toEqual([MCP_FILE])
    expect(byId.get('agent-reference')?.source).toBe('catalog')
    expect(byId.get('agent-reference')?.artifacts).toEqual([AGENT_FILE])
    expect(byId.get('docs-reference')?.source).toBe('catalog')
    expect(byId.get('docs-reference')?.artifacts).toEqual([DOCS_FILE])
    expect(byId.get('config-schema')?.source).toBe('catalog')
    expect(byId.get('config-schema')?.artifacts).toEqual([CONFIG_FILE])
    expect(byId.get('catalog')?.source).toBe('catalog')
    expect(byId.get('catalog')?.artifacts).toEqual([CATALOG_FILE])
    expect(byId.get('discovery')?.source).toBe('catalog')
    expect(byId.get('discovery')?.artifacts).toEqual([DISCOVERY_FILE])
  })
})
