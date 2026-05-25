import { describe, expect, test } from 'bun:test'
import * as Artifacts from '../src/package/verify-artifact.js'
import * as Binary from '../src/package/verify-binary.js'
import * as Manifest from '../src/manifest/schema.js'
import * as Package from '../src/package/index.js'
import * as Publishers from '../src/publishers/index.js'
import * as Renderers from '../src/renderers/index.js'
import * as RenderersAll from '../src/renderers/all.js'
import * as RenderersHomebrew from '../src/renderers/homebrew.js'
import * as RenderersNpm from '../src/renderers/npm.js'
import * as RenderersPypi from '../src/renderers/pypi.js'
import * as RenderersScoop from '../src/renderers/scoop.js'
import * as Root from '../src/index.js'
import * as Yank from '../src/yank.js'

const ROOT_PUBLIC_VALUES = [
  'BuildRecordSchema',
  'CliReleaseManifestSchema',
  'DEFAULT_NPM_REGISTRY_AUDIENCE',
  'OIDC_EXECUTOR_FAILURE_CODES',
  'OIDC_PROVIDERS',
  'PACKAGE_ECOSYSTEMS',
  'PUBLISHER_ENV_NAMES',
  'ReleasesConfigSchema',
  'audienceForNpmRegistry',
  'createOfficialFlowHandoff',
  'defineReleasesConfig',
  'executeReleasePublish',
  'isPackageEcosystem',
  'loadPublisherCredentialsFromEnv',
  'manifestFromBuildRecord',
  'npmOidcExchangeUrl',
  'packageRelease',
  'parseBuildRecord',
  'parseCliReleaseManifest',
  'planReleasePublish',
  'planReleaseYank',
  'preflightReleasePublish',
  'resolveReleaseRenderers',
  'verifyPackageArtifacts',
  'verifyReleaseBinaries',
].sort()

describe('public API snapshot', () => {
  test('packages/releases root public value exports match the frozen surface', () => {
    expect(Object.keys(Root).sort()).toEqual(ROOT_PUBLIC_VALUES)
  })

  test('packages/releases documented subpath value exports match the frozen surface', () => {
    expect(Object.keys(Manifest).sort()).toEqual(['CliReleaseManifestSchema', 'parseCliReleaseManifest'])
    expect(Object.keys(Binary).sort()).toEqual(['verifyReleaseBinaries'])
    expect(Object.keys(Artifacts).sort()).toEqual(['verifyPackageArtifacts'])
    expect(Object.keys(Package).sort()).toEqual(['packageRelease'])
    expect(Object.keys(Yank).sort()).toEqual(['planReleaseYank'])
    expect(Object.keys(Renderers).sort()).toEqual(['PACKAGE_ECOSYSTEMS', 'isPackageEcosystem', 'resolveReleaseRenderers'])
    expect(Object.keys(RenderersAll).sort()).toEqual([
      'createDefaultRendererRegistry',
      'homebrewRenderer',
      'npmRenderer',
      'pypiRenderer',
      'scoopRenderer',
    ])
    expect(Object.keys(RenderersNpm).sort()).toEqual(['npmRenderer'])
    expect(Object.keys(RenderersPypi).sort()).toEqual(['pypiRenderer'])
    expect(Object.keys(RenderersHomebrew).sort()).toEqual(['homebrewRenderer'])
    expect(Object.keys(RenderersScoop).sort()).toEqual(['scoopRenderer'])
    expect(Object.keys(Publishers).sort()).toEqual([
      'DEFAULT_NPM_REGISTRY_AUDIENCE',
      'OIDC_EXECUTOR_FAILURE_CODES',
      'OIDC_PROVIDERS',
      'PUBLISHER_ENV_NAMES',
      'audienceForNpmRegistry',
      'executeReleasePublish',
      'loadPublisherCredentialsFromEnv',
      'npmOidcExchangeUrl',
      'planReleasePublish',
      'preflightReleasePublish',
    ])
  })
})
