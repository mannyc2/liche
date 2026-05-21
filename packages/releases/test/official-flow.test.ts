import { describe, expect, test } from 'bun:test'
import { createOfficialFlowHandoff } from '../src/index.js'
import type { PackageRecord, VerifiedPackageArtifact } from '../src/index.js'

function pkg(id: string, ecosystem: PackageRecord['ecosystem'], kind: string, name: string): PackageRecord {
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
  ecosystem: PackageRecord['ecosystem'],
  kind: string,
  name: string,
  fileName: string,
): VerifiedPackageArtifact {
  return {
    packageId,
    path: `/tmp/release/${ecosystem}/${fileName}`,
    fileName,
    sha256: 'a'.repeat(64),
    size: 100,
    renderer: ecosystem,
    ecosystem,
    kind,
    name,
    version: '0.1.0',
  }
}

describe('createOfficialFlowHandoff', () => {
  test('emits npm package directory order without requiring workflow graph logic', () => {
    const handoff = createOfficialFlowHandoff({
      packageRoot: 'dist/release/packages',
      packages: [
        pkg('npm:@lili/workers', 'npm', 'npm-umbrella', '@lili/workers'),
        pkg('npm:@lili/workers-linux-x64', 'npm', 'npm-platform', '@lili/workers-linux-x64'),
        pkg('npm:@lili/workers-darwin-arm64', 'npm', 'npm-platform', '@lili/workers-darwin-arm64'),
      ],
      packageArtifacts: [],
    })

    expect(handoff.npm?.packageDirs).toEqual([
      {
        packageId: 'npm:@lili/workers-darwin-arm64',
        name: '@lili/workers-darwin-arm64',
        role: 'platform',
        path: 'dist/release/packages/npm/package-dirs/lili-workers-darwin-arm64',
      },
      {
        packageId: 'npm:@lili/workers-linux-x64',
        name: '@lili/workers-linux-x64',
        role: 'platform',
        path: 'dist/release/packages/npm/package-dirs/lili-workers-linux-x64',
      },
      {
        packageId: 'npm:@lili/workers',
        name: '@lili/workers',
        role: 'umbrella',
        path: 'dist/release/packages/npm/package-dirs/lili-workers',
      },
    ])
  })

  test('emits official action handoff paths for non-npm ecosystems', () => {
    const handoff = createOfficialFlowHandoff({
      packageRoot: 'dist/release/packages',
      packages: [
        pkg('pypi:lili-workers', 'pypi', 'wheel', 'lili-workers'),
        pkg('homebrew:workers', 'homebrew', 'formula', 'workers'),
        pkg('scoop:workers', 'scoop', 'scoop-manifest', 'workers'),
      ],
      packageArtifacts: [
        artifact('pypi:lili-workers', 'pypi', 'wheel', 'lili-workers', 'lili_workers-0.1.0.whl'),
        artifact('homebrew:workers', 'homebrew', 'formula', 'workers', 'workers.rb'),
        artifact('scoop:workers', 'scoop', 'scoop-manifest', 'workers', 'workers.json'),
      ],
    })

    expect(handoff.pypi?.packagesDir).toBe('dist/release/packages/pypi')
    expect(handoff.pypi?.artifacts.map((entry) => entry.fileName)).toEqual(['lili_workers-0.1.0.whl'])
    expect(handoff.homebrew?.formulae.map((entry) => entry.path)).toEqual(['/tmp/release/homebrew/workers.rb'])
    expect(handoff.scoop?.manifests.map((entry) => entry.path)).toEqual(['/tmp/release/scoop/workers.json'])
  })
})
