import { describe, expect, test } from 'bun:test'
import {
  CliReleaseManifestSchema,
  planReleasePublish,
} from '../src/index.js'
import type {
  CliReleaseManifest,
  CliReleaseManifestInput,
  PackageRecord,
  PublisherConfigMap,
  VerifiedPackageArtifact,
} from '../src/index.js'

const ZERO_HASH = '0'.repeat(64)

function manifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: { description: 'publish plan test fixture' },
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
  return {
    id,
    renderer: ecosystem,
    ecosystem,
    kind,
    name,
    version: '0.1.0',
  }
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

function fullFixture() {
  const packages: PackageRecord[] = [
    pkg('npm:@liche/workers', 'npm', 'npm-umbrella', '@liche/workers'),
    pkg('npm:@liche/workers-linux-x64', 'npm', 'npm-platform', '@liche/workers-linux-x64'),
    pkg('npm:@liche/workers-darwin-arm64', 'npm', 'npm-platform', '@liche/workers-darwin-arm64'),
    pkg('npm:@liche/workers-win32-x64', 'npm', 'npm-platform', '@liche/workers-win32-x64'),
    pkg('pypi:liche-workers', 'pypi', 'pypi-wheel', 'liche-workers'),
    pkg('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers'),
    pkg('scoop:workers', 'scoop', 'scoop-manifest', 'workers'),
  ]
  const artifacts: VerifiedPackageArtifact[] = [
    artifact('npm:@liche/workers', 'npm', 'npm-umbrella', '@liche/workers', 'liche-workers-0.1.0.tgz', 1024),
    artifact('npm:@liche/workers-linux-x64', 'npm', 'npm-platform', '@liche/workers-linux-x64', 'liche-workers-linux-x64-0.1.0.tgz', 2048),
    artifact('npm:@liche/workers-darwin-arm64', 'npm', 'npm-platform', '@liche/workers-darwin-arm64', 'liche-workers-darwin-arm64-0.1.0.tgz', 2048),
    artifact('npm:@liche/workers-win32-x64', 'npm', 'npm-platform', '@liche/workers-win32-x64', 'liche-workers-win32-x64-0.1.0.tgz', 2048),
    artifact('pypi:liche-workers', 'pypi', 'pypi-wheel', 'liche-workers', 'lili_workers-0.1.0-py3-none-any.whl', 4096),
    artifact('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers', 'workers.rb', 512),
    artifact('scoop:workers', 'scoop', 'scoop-manifest', 'workers', 'workers.json', 256),
  ]
  return { packages, artifacts }
}

function defaultConfig(): PublisherConfigMap {
  return {
    homebrew: { tap: { owner: 'liche', repo: 'homebrew-tap' } },
    scoop: { bucket: { owner: 'liche', repo: 'scoop-bucket' } },
  }
}

describe('planReleasePublish', () => {
  test('derives an ordered plan from a release manifest plus verified artifacts', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: 'all',
      config: defaultConfig(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.plan.dryRun).toBe(true)
    expect(result.plan.manifestVersion).toBe(1)
    expect(result.plan.releaseVersion).toBe('0.1.0')
    expect(result.plan.subject).toEqual({
      id: 'workers',
      name: 'Workers CLI',
      version: '0.1.0',
    })

    const stepShapes = result.plan.steps.map((step) => ({
      kind: step.kind,
      packageId: step.packageId,
    }))
    expect(stepShapes).toEqual([
      { kind: 'npm-publish', packageId: 'npm:@liche/workers-darwin-arm64' },
      { kind: 'npm-publish', packageId: 'npm:@liche/workers-linux-x64' },
      { kind: 'npm-publish', packageId: 'npm:@liche/workers-win32-x64' },
      { kind: 'npm-publish', packageId: 'npm:@liche/workers' },
      { kind: 'pypi-upload', packageId: 'pypi:liche-workers' },
      { kind: 'homebrew-write-formula', packageId: 'homebrew:workers' },
      { kind: 'scoop-write-manifest', packageId: 'scoop:workers' },
    ])
  })

  test('npm platforms come before umbrella and share registry/tag/access defaults', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['npm'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const npmSteps = result.plan.steps.filter((step) => step.kind === 'npm-publish')
    expect(npmSteps.length).toBe(4)
    expect(npmSteps.map((step) => step.role)).toEqual([
      'platform',
      'platform',
      'platform',
      'umbrella',
    ])
    for (const step of npmSteps) {
      if (step.kind !== 'npm-publish') continue
      expect(step.registry).toBe('https://registry.npmjs.org/')
      expect(step.tag).toBe('latest')
      expect(step.access).toBe('public')
    }
  })

  test('honors npm registry/tag/access overrides', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['npm'],
      config: {
        npm: {
          registry: 'https://npm.example.test/',
          tag: 'next',
          access: 'restricted',
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    for (const step of result.plan.steps) {
      if (step.kind !== 'npm-publish') continue
      expect(step.registry).toBe('https://npm.example.test/')
      expect(step.tag).toBe('next')
      expect(step.access).toBe('restricted')
    }
  })

  test('pypi step references the verified wheel artifact', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['pypi'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.steps).toEqual([
      {
        kind: 'pypi-upload',
        packageId: 'pypi:liche-workers',
        ecosystem: 'pypi',
        artifactPath: '/tmp/release/pypi/lili_workers-0.1.0-py3-none-any.whl',
        artifactFileName: 'lili_workers-0.1.0-py3-none-any.whl',
        sha256: ZERO_HASH,
        size: 4096,
        name: 'liche-workers',
        version: '0.1.0',
        repositoryUrl: 'https://upload.pypi.org/legacy/',
      },
    ])
  })

  test('homebrew step writes the formula at Formula/<name>.rb on the tap default branch', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['homebrew'],
      config: defaultConfig(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.steps).toEqual([
      {
        kind: 'homebrew-write-formula',
        packageId: 'homebrew:workers',
        ecosystem: 'homebrew',
        artifactPath: '/tmp/release/homebrew/workers.rb',
        artifactFileName: 'workers.rb',
        sha256: ZERO_HASH,
        size: 512,
        name: 'workers',
        version: '0.1.0',
        tap: { owner: 'liche', repo: 'homebrew-tap', branch: 'main' },
        targetPath: 'Formula/workers.rb',
      },
    ])
  })

  test('scoop step writes the manifest at bucket/<name>.json on the bucket default branch', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['scoop'],
      config: defaultConfig(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.steps).toEqual([
      {
        kind: 'scoop-write-manifest',
        packageId: 'scoop:workers',
        ecosystem: 'scoop',
        artifactPath: '/tmp/release/scoop/workers.json',
        artifactFileName: 'workers.json',
        sha256: ZERO_HASH,
        size: 256,
        name: 'workers',
        version: '0.1.0',
        bucket: { owner: 'liche', repo: 'scoop-bucket', branch: 'main' },
        targetPath: 'bucket/workers.json',
      },
    ])
  })

  test("selection 'all' skips ecosystems with no packages", () => {
    const manifest = parseManifest()
    const packages: PackageRecord[] = [pkg('pypi:liche-workers', 'pypi', 'pypi-wheel', 'liche-workers')]
    const artifacts: VerifiedPackageArtifact[] = [
      artifact('pypi:liche-workers', 'pypi', 'pypi-wheel', 'liche-workers', 'lili_workers-0.1.0-py3-none-any.whl', 1),
    ]
    const result = planReleasePublish({ manifest, packages, artifacts, selection: 'all' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.steps.map((step) => step.kind)).toEqual(['pypi-upload'])
  })

  test('unknown publisher in explicit selection fails', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['npm', 'cargo'],
      config: defaultConfig(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'cargo',
        code: 'PUBLISHER_UNKNOWN',
        message: `publisher 'cargo' is not a supported package ecosystem`,
      },
    ])
  })

  test('duplicate publisher in explicit selection fails', () => {
    const manifest = parseManifest()
    const { packages, artifacts } = fullFixture()
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['npm', 'npm'],
      config: defaultConfig(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'npm',
        code: 'PUBLISHER_DUPLICATE',
        message: `publisher 'npm' was selected more than once`,
      },
    ])
  })

  test('missing artifact for a package fails', () => {
    const manifest = parseManifest()
    const packages: PackageRecord[] = [pkg('npm:@liche/workers', 'npm', 'npm-umbrella', '@liche/workers')]
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts: [],
      selection: ['npm'],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'npm',
        code: 'PUBLISHER_ARTIFACT_MISSING',
        message: `publisher 'npm' has no verified artifact for package 'npm:@liche/workers'`,
        details: { packageId: 'npm:@liche/workers' },
      },
    ])
  })

  test('homebrew without tap config fails', () => {
    const manifest = parseManifest()
    const packages: PackageRecord[] = [pkg('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers')]
    const artifacts: VerifiedPackageArtifact[] = [
      artifact('homebrew:workers', 'homebrew', 'homebrew-formula', 'workers', 'workers.rb', 512),
    ]
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['homebrew'],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'homebrew',
        code: 'PUBLISHER_CONFIG_MISSING',
        message: `publisher 'homebrew' requires a tap config (owner/repo)`,
      },
    ])
  })

  test('scoop without bucket config fails', () => {
    const manifest = parseManifest()
    const packages: PackageRecord[] = [pkg('scoop:workers', 'scoop', 'scoop-manifest', 'workers')]
    const artifacts: VerifiedPackageArtifact[] = [
      artifact('scoop:workers', 'scoop', 'scoop-manifest', 'workers', 'workers.json', 256),
    ]
    const result = planReleasePublish({
      manifest,
      packages,
      artifacts,
      selection: ['scoop'],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'scoop',
        code: 'PUBLISHER_CONFIG_MISSING',
        message: `publisher 'scoop' requires a bucket config (owner/repo)`,
      },
    ])
  })

  test('npm package with unknown kind fails', () => {
    const manifest = parseManifest()
    const packages: PackageRecord[] = [pkg('npm:weird', 'npm', 'npm-something-new', 'weird')]
    const artifacts: VerifiedPackageArtifact[] = [
      artifact('npm:weird', 'npm', 'npm-something-new', 'weird', 'weird-0.1.0.tgz', 10),
    ]
    const result = planReleasePublish({ manifest, packages, artifacts, selection: ['npm'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'npm',
        code: 'PUBLISHER_PACKAGE_UNGROUPED',
        message: `npm package 'npm:weird' has unknown kind 'npm-something-new'`,
        details: { packageId: 'npm:weird', kind: 'npm-something-new' },
      },
    ])
  })
})
