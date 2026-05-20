import { describe, expect, test } from 'bun:test'
import {
  CliReleaseManifestSchema,
  resolveReleaseRenderers,
} from '../src/index.js'
import type {
  CliReleaseManifest,
  CliReleaseManifestInput,
  PackageEcosystem,
  ReleaseRenderer,
} from '../src/index.js'

function baseManifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: { description: 'renderer selection test fixture' },
    subject: {
      id: 'workers',
      name: 'Workers CLI',
      version: '0.1.0',
      commit: '0123456789abcdef0123456789abcdef01234567',
      contract: {
        kind: 'product-catalog',
        digest: 'sha256:fake-catalog',
      },
    },
    release: {
      version: '0.1.0',
      createdAt: '2026-05-19T12:00:00Z',
      generatorVersion: '0.0.0',
    },
    runtime: { command: 'workers' },
    binaries: [],
  }
}

function parseManifest(): CliReleaseManifest {
  const parsed = CliReleaseManifestSchema.safeParse(baseManifestInput())
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data
}

function fixtureRenderer(
  id: PackageEcosystem,
  validate?: ReleaseRenderer['validate'],
): ReleaseRenderer {
  const renderer: ReleaseRenderer = {
    id,
    render: () => ({ packages: [], artifacts: [] }),
  }
  if (validate) renderer.validate = validate
  return renderer
}

function enabledConfig(config: unknown): boolean {
  return (
    typeof config === 'object' &&
    config !== null &&
    (config as { enabled?: unknown }).enabled === true
  )
}

describe('resolveReleaseRenderers', () => {
  test('empty selection validates no renderers', () => {
    const manifest = parseManifest()
    let validationCalls = 0
    const result = resolveReleaseRenderers({
      manifest,
      registry: {
        npm: fixtureRenderer('npm', () => {
          validationCalls += 1
          return ['this should not run']
        }),
      },
      selection: [],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.renderers).toEqual([])
    expect(validationCalls).toBe(0)
  })

  test('resolves one and many selections in caller order', () => {
    const manifest = parseManifest()
    const registry = {
      npm: fixtureRenderer('npm'),
      pypi: fixtureRenderer('pypi'),
      homebrew: fixtureRenderer('homebrew'),
    }

    const one = resolveReleaseRenderers({
      manifest,
      registry,
      selection: ['npm'],
    })
    const many = resolveReleaseRenderers({
      manifest,
      registry,
      selection: ['pypi', 'homebrew'],
    })

    expect(one.ok).toBe(true)
    expect(many.ok).toBe(true)
    if (!one.ok || !many.ok) return
    expect(one.renderers.map((renderer) => renderer.id)).toEqual(['npm'])
    expect(many.renderers.map((renderer) => renderer.id)).toEqual(['pypi', 'homebrew'])
  })

  test('all selection resolves every registered renderer in ecosystem order', () => {
    const manifest = parseManifest()
    const result = resolveReleaseRenderers({
      manifest,
      registry: {
        scoop: fixtureRenderer('scoop'),
        npm: fixtureRenderer('npm'),
        homebrew: fixtureRenderer('homebrew'),
      },
      selection: 'all',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.renderers.map((renderer) => renderer.id)).toEqual([
      'npm',
      'homebrew',
      'scoop',
    ])
  })

  test('rejects unsupported and duplicate selected renderers', () => {
    const manifest = parseManifest()
    const result = resolveReleaseRenderers({
      manifest,
      registry: { npm: fixtureRenderer('npm') },
      selection: ['npm', 'npm', 'flatpak'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.map((failure) => failure.code)).toEqual([
      'RENDERER_DUPLICATE',
      'RENDERER_UNKNOWN',
    ])
  })

  test('underconfigured selected renderers fail before staging', () => {
    const manifest = parseManifest()
    const result = resolveReleaseRenderers({
      manifest,
      registry: {
        npm: fixtureRenderer('npm', ({ config }) =>
          enabledConfig(config) ? [] : ['fixture renderer requires enabled config'],
        ),
      },
      selection: ['npm'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        renderer: 'npm',
        code: 'RENDERER_CONFIG_INVALID',
      }),
    ])
  })

  test('renderer validation exceptions become selection failures', () => {
    const manifest = parseManifest()
    const result = resolveReleaseRenderers({
      manifest,
      registry: {
        npm: fixtureRenderer('npm', () => {
          throw new Error('bad fixture config')
        }),
      },
      selection: ['npm'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        renderer: 'npm',
        code: 'RENDERER_CONFIG_INVALID',
      }),
    ])
  })

  test('publisher credentials are not part of renderer selection', () => {
    const manifest = parseManifest()
    const result = resolveReleaseRenderers({
      manifest,
      registry: {
        npm: fixtureRenderer('npm', () => []),
      },
      selection: ['npm'],
      config: { npm: { packageScope: '@acme' } },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.renderers.map((renderer) => renderer.id)).toEqual(['npm'])
  })
})
