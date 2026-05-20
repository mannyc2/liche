import { describe, expect, test } from 'bun:test'
import {
  CliReleaseManifestSchema,
  planReleasePublish,
  preflightReleasePublish,
} from '../src/index.js'
import type {
  CliReleaseManifest,
  CliReleaseManifestInput,
  PackageRecord,
  PublisherConfigMap,
  PublisherCredentials,
  ReleasePublishPlan,
  VerifiedPackageArtifact,
} from '../src/index.js'

const ZERO_HASH = '0'.repeat(64)

function manifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: { description: 'publish preflight test fixture' },
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
  const parsed = CliReleaseManifestSchema.safeParse(manifestInput())
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data
}

function pkg(
  id: string,
  ecosystem: PackageRecord['ecosystem'],
  kind: string,
  name: string,
): PackageRecord {
  return { id, renderer: ecosystem, ecosystem, kind, name, version: '0.1.0' }
}

function artifact(
  packageId: string,
  ecosystem: VerifiedPackageArtifact['ecosystem'],
  kind: string,
  name: string,
  fileName: string,
  size: number,
): VerifiedPackageArtifact {
  return {
    packageId,
    path: `/tmp/release/${ecosystem}/${fileName}`,
    fileName,
    sha256: ZERO_HASH,
    size,
    renderer: ecosystem,
    ecosystem,
    kind,
    name,
    version: '0.1.0',
  }
}

function buildFullPlan(): ReleasePublishPlan {
  const packages: PackageRecord[] = [
    pkg('npm:@lili/workers', 'npm', 'npm-umbrella', '@lili/workers'),
    pkg('npm:@lili/workers-linux-x64', 'npm', 'npm-platform', '@lili/workers-linux-x64'),
    pkg('pypi:lili-workers', 'pypi', 'pypi-wheel', 'lili-workers'),
    pkg('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers'),
    pkg('scoop:workers', 'scoop', 'scoop-manifest', 'workers'),
  ]
  const artifacts: VerifiedPackageArtifact[] = [
    artifact('npm:@lili/workers', 'npm', 'npm-umbrella', '@lili/workers', 'lili-workers-0.1.0.tgz', 1024),
    artifact('npm:@lili/workers-linux-x64', 'npm', 'npm-platform', '@lili/workers-linux-x64', 'lili-workers-linux-x64-0.1.0.tgz', 2048),
    artifact('pypi:lili-workers', 'pypi', 'pypi-wheel', 'lili-workers', 'lili_workers-0.1.0-py3-none-any.whl', 4096),
    artifact('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers', 'workers.rb', 512),
    artifact('scoop:workers', 'scoop', 'scoop-manifest', 'workers', 'workers.json', 256),
  ]
  const config: PublisherConfigMap = {
    homebrew: { tap: { owner: 'lili', repo: 'homebrew-tap' } },
    scoop: { bucket: { owner: 'lili', repo: 'scoop-bucket' } },
  }
  const result = planReleasePublish({
    manifest: parseManifest(),
    packages,
    artifacts,
    selection: 'all',
    config,
  })
  if (!result.ok) throw new Error('fixture plan must succeed')
  return result.plan
}

function fullCredentials(): PublisherCredentials {
  return {
    npm: { token: 'npm-token-value' },
    pypi: { token: 'pypi-token-value' },
    homebrew: { githubToken: 'github-token-value' },
    scoop: { githubToken: 'github-token-value' },
  }
}

function singleEcosystemPlan(ecosystem: PackageRecord['ecosystem']): ReleasePublishPlan {
  const id = `${ecosystem}:demo`
  const name = ecosystem === 'npm' ? '@lili/demo' : 'demo'
  const kind =
    ecosystem === 'npm'
      ? 'npm-umbrella'
      : ecosystem === 'pypi'
        ? 'pypi-wheel'
        : ecosystem === 'homebrew'
          ? 'homebrew-formula'
          : 'scoop-manifest'
  const fileName =
    ecosystem === 'npm'
      ? 'demo-0.1.0.tgz'
      : ecosystem === 'pypi'
        ? 'demo-0.1.0-py3-none-any.whl'
        : ecosystem === 'homebrew'
          ? 'demo.rb'
          : 'demo.json'
  const config: PublisherConfigMap = {
    homebrew: { tap: { owner: 'lili', repo: 'homebrew-tap' } },
    scoop: { bucket: { owner: 'lili', repo: 'scoop-bucket' } },
  }
  const result = planReleasePublish({
    manifest: parseManifest(),
    packages: [pkg(id, ecosystem, kind, name)],
    artifacts: [artifact(id, ecosystem, kind, name, fileName, 64)],
    selection: [ecosystem],
    config,
  })
  if (!result.ok) throw new Error(`fixture plan for ${ecosystem} must succeed`)
  return result.plan
}

describe('preflightReleasePublish', () => {
  test('passes when every active ecosystem has non-empty credentials', () => {
    const plan = buildFullPlan()
    const result = preflightReleasePublish({ plan, credentials: fullCredentials() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleared).toEqual(['npm', 'pypi', 'homebrew', 'scoop'])
  })

  test('reports every missing publisher credential at once', () => {
    const plan = buildFullPlan()
    const result = preflightReleasePublish({ plan, credentials: {} })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.map((failure) => failure.publisher)).toEqual([
      'npm',
      'pypi',
      'homebrew',
      'scoop',
    ])
    for (const failure of result.failures) {
      expect(failure.code).toBe('CREDENTIAL_MISSING')
    }
  })

  test('treats empty-string tokens as missing-credential failures', () => {
    const plan = buildFullPlan()
    const result = preflightReleasePublish({
      plan,
      credentials: {
        npm: { token: '' },
        pypi: { token: 'pypi-token-value' },
        homebrew: { githubToken: '' },
        scoop: { githubToken: 'github-token-value' },
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'npm',
        code: 'CREDENTIAL_EMPTY',
        message: `publisher 'npm' credential 'token' is empty`,
        details: { field: 'token' },
      },
      {
        publisher: 'homebrew',
        code: 'CREDENTIAL_EMPTY',
        message: `publisher 'homebrew' credential 'githubToken' is empty`,
        details: { field: 'githubToken' },
      },
    ])
  })

  test('ignores credentials for publishers that have no steps', () => {
    const plan = singleEcosystemPlan('pypi')
    const result = preflightReleasePublish({
      plan,
      credentials: {
        npm: { token: '' },
        pypi: { token: 'pypi-token-value' },
        homebrew: { githubToken: '' },
        scoop: { githubToken: '' },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleared).toEqual(['pypi'])
  })

  test('cleared ecosystems follow canonical order regardless of plan order', () => {
    const plan = buildFullPlan()
    const result = preflightReleasePublish({ plan, credentials: fullCredentials() })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleared).toEqual(['npm', 'pypi', 'homebrew', 'scoop'])
  })

  test('clears only the ecosystems present in a partial-selection plan', () => {
    const plan = singleEcosystemPlan('homebrew')
    const result = preflightReleasePublish({
      plan,
      credentials: { homebrew: { githubToken: 'github-token-value' } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleared).toEqual(['homebrew'])
  })
})
