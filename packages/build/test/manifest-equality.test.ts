import { describe, expect, test } from 'bun:test'
import type { GeneratedSurfaceManifest } from '../src/index.js'
import { hashString } from '../src/index.js'
import { manifestEqualForSurface } from '../src/manifest.js'

function baseManifest(): GeneratedSurfaceManifest {
  return {
    manifestVersion: 1,
    schema: {
      name: 'workers',
      version: '1.0.0',
      digest: 'sha256:aaaa',
    },
    generatorVersion: '0.0.0',
    surfaces: [
      {
        id: 'cli',
        source: 'catalog',
        inputDigest: 'sha256:1111',
        generationOptionsDigest: 'sha256:2222',
        outputDigest: 'sha256:3333',
        artifacts: ['workers.generated.ts', 'workers.generated.manifest.json'],
      },
      {
        id: 'openapi',
        source: 'openapi',
        inputDigest: 'sha256:4444',
        generationOptionsDigest: 'sha256:5555',
        outputDigest: 'sha256:6666',
        artifacts: ['openapi.json'],
      },
    ],
  }
}

function withSurfacePatch(
  m: GeneratedSurfaceManifest,
  id: string,
  patch: Partial<GeneratedSurfaceManifest['surfaces'][number]>,
): GeneratedSurfaceManifest {
  return {
    ...m,
    surfaces: m.surfaces.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }
}

describe('hashString', () => {
  test('produces a sha256:<hex> string of length 71', () => {
    const h = hashString('hello')
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test('is deterministic for the same input', () => {
    expect(hashString('hello')).toBe(hashString('hello'))
  })

  test('differs for different inputs', () => {
    expect(hashString('hello')).not.toBe(hashString('Hello'))
    expect(hashString('hello')).not.toBe(hashString('hello '))
  })
})

describe('manifestEqualForSurface — equal manifests', () => {
  test('identical manifests return ok: true for both declared surfaces', () => {
    const m = baseManifest()
    expect(manifestEqualForSurface(m, m, 'cli')).toEqual({ ok: true })
    expect(manifestEqualForSurface(m, m, 'openapi')).toEqual({ ok: true })
  })

  test('manifests that differ only in an unrequested surface still return ok for the requested one', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'openapi', { outputDigest: 'sha256:dead' })
    expect(manifestEqualForSurface(expected, actual, 'cli')).toEqual({ ok: true })
  })
})

describe('manifestEqualForSurface — top-level mismatch reasons', () => {
  test('manifestVersion mismatch reports a reason mentioning manifestVersion', () => {
    const expected = baseManifest()
    const actual = { ...expected, manifestVersion: 1 as const }
    // simulate a forward-version drift by reading raw types loosely
    const drift: GeneratedSurfaceManifest = { ...actual }
    ;(drift as { manifestVersion: number }).manifestVersion = 2
    const r = manifestEqualForSurface(expected, drift, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons.some((s) => s.includes('manifestVersion changed'))).toBe(true)
    }
  })

  test('schema name mismatch reports a reason mentioning schema name', () => {
    const expected = baseManifest()
    const actual = { ...expected, schema: { ...expected.schema, name: 'workers-v2' } }
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons.some((s) => s.includes('schema name changed'))).toBe(true)
    }
  })

  test('schema version mismatch reports a reason mentioning schema version', () => {
    const expected = baseManifest()
    const actual = { ...expected, schema: { ...expected.schema, version: '2.0.0' } }
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons.some((s) => s.includes('schema version changed'))).toBe(true)
    }
  })

  test('schema digest mismatch reports a reason mentioning schema digest', () => {
    const expected = baseManifest()
    const actual = { ...expected, schema: { ...expected.schema, digest: 'sha256:bbbb' } }
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons.some((s) => s.includes('schema digest changed'))).toBe(true)
    }
  })

  test('generatorVersion mismatch reports a reason mentioning generatorVersion', () => {
    const expected = baseManifest()
    const actual = { ...expected, generatorVersion: '0.0.1' }
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons.some((s) => s.includes('generatorVersion changed'))).toBe(true)
    }
  })
})

describe('manifestEqualForSurface — surface-scoped mismatch reasons', () => {
  test('missing surface on one side short-circuits with a single reason', () => {
    const expected = baseManifest()
    const actual = { ...expected, surfaces: expected.surfaces.filter((s) => s.id !== 'cli') }
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toEqual([`surface 'cli' missing from one side`])
    }
  })

  test('inputDigest mismatch on the targeted surface is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', { inputDigest: 'sha256:ffff' })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' inputDigest changed`)
    }
  })

  test('source mismatch on the targeted surface is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', { source: 'openapi' })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' source changed`)
    }
  })

  test('generationOptionsDigest mismatch on the targeted surface is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', { generationOptionsDigest: 'sha256:9999' })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' generationOptionsDigest changed`)
    }
  })

  test('outputDigest mismatch on the targeted surface is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', { outputDigest: 'sha256:7777' })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' output digest mismatch`)
    }
  })

  test('artifacts list mismatch (actual shorter than expected) is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', { artifacts: ['workers.generated.ts'] })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' artifacts changed`)
    }
  })

  test('artifacts list mismatch (actual is a strict prefix of an extended expected) is reported', () => {
    // expected.artifacts is a prefix of actual.artifacts — exercises the
    // length-guard in stringArraysEqual (the `a.every` fallback would not catch this).
    const expected = withSurfacePatch(baseManifest(), 'cli', {
      artifacts: ['workers.generated.ts'],
    })
    const actual = withSurfacePatch(baseManifest(), 'cli', {
      artifacts: ['workers.generated.ts', 'workers.generated.manifest.json'],
    })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' artifacts changed`)
    }
  })

  test('artifacts list mismatch (same length, different order/content) is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', {
      artifacts: ['workers.generated.manifest.json', 'workers.generated.ts'],
    })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' artifacts changed`)
    }
  })

  test('artifacts list with single-element substitution is reported', () => {
    const expected = baseManifest()
    const actual = withSurfacePatch(expected, 'cli', {
      artifacts: ['workers.generated.ts', 'workers.different.json'],
    })
    const r = manifestEqualForSurface(expected, actual, 'cli')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons).toContain(`surface 'cli' artifacts changed`)
    }
  })
})
