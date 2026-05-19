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

  test('hand-edit to manifest fails check', async () => {
    await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const path = join(dir, MANIFEST_FILE)
    const manifest = JSON.parse(await Bun.file(path).text())
    manifest.surfaces[0].inputDigest = 'sha256:0000'
    await Bun.write(path, JSON.stringify(manifest, null, 2))

    const check = await checkAgainstDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    expect(check.ok).toBe(false)
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

  test('manifest shape records the product header and source=catalog', async () => {
    const result = await generateToDir(product, { outDir: dir, generatorVersion: '0.0.0' })
    const m = result.manifest
    expect(m.manifestVersion).toBe(1)
    expect(m.schema.name).toBe('workers')
    expect(m.schema.version).toBe('1.0.0')
    expect(m.schema.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(m.generatorVersion).toBe('0.0.0')
    expect(m.surfaces).toHaveLength(1)
    const s = m.surfaces[0]!
    expect(s.id).toBe('cli')
    expect(s.source).toBe('catalog')
    expect(s.inputDigest).toBe(canonicalDigest(normalizeProduct(product)))
    expect(s.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(s.generationOptionsDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(s.artifacts).toEqual([GEN_FILE])
  })
})
