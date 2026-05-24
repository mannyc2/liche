import { describe, expect, test } from 'bun:test'
import {
  PUBLISHER_ENV_NAMES,
  loadPublisherCredentialsFromEnv,
  preflightReleasePublish,
} from '../src/index.js'
import type {
  HomebrewPublishStep,
  PypiPublishStep,
  ReleasePublishPlan,
} from '../src/index.js'

const ZERO_HASH = '0'.repeat(64)

function singleStepPlan(step: ReleasePublishPlan['steps'][number]): ReleasePublishPlan {
  return {
    dryRun: true,
    manifestVersion: 1,
    releaseVersion: '0.1.0',
    subject: { id: 'workers', name: 'Workers CLI', version: '0.1.0' },
    steps: [step],
  }
}

function pypiPlan(): ReleasePublishPlan {
  const step: PypiPublishStep = {
    kind: 'pypi-upload',
    packageId: 'pypi:liche-workers',
    ecosystem: 'pypi',
    artifactPath: '/tmp/release/pypi/lili_workers-0.1.0-py3-none-any.whl',
    artifactFileName: 'lili_workers-0.1.0-py3-none-any.whl',
    sha256: ZERO_HASH,
    size: 1,
    name: 'liche-workers',
    version: '0.1.0',
    repositoryUrl: 'https://upload.pypi.org/legacy/',
  }
  return singleStepPlan(step)
}

function homebrewPlan(): ReleasePublishPlan {
  const step: HomebrewPublishStep = {
    kind: 'homebrew-write-formula',
    packageId: 'homebrew:workers',
    ecosystem: 'homebrew',
    artifactPath: '/tmp/release/homebrew/workers.rb',
    artifactFileName: 'workers.rb',
    sha256: ZERO_HASH,
    size: 1,
    name: 'workers',
    version: '0.1.0',
    tap: { owner: 'liche', repo: 'homebrew-tap', branch: 'main' },
    targetPath: 'Formula/workers.rb',
  }
  return singleStepPlan(step)
}

describe('loadPublisherCredentialsFromEnv', () => {
  test('reads every publisher token under the canonical env var names', () => {
    const credentials = loadPublisherCredentialsFromEnv({
      NPM_TOKEN: 'npm-value',
      PYPI_API_TOKEN: 'pypi-value',
      HOMEBREW_GITHUB_TOKEN: 'homebrew-value',
      SCOOP_GITHUB_TOKEN: 'scoop-value',
    })
    expect(credentials).toEqual({
      npm: { kind: 'token', token: 'npm-value' },
      pypi: { kind: 'token', token: 'pypi-value' },
      homebrew: { kind: 'token', githubToken: 'homebrew-value' },
      scoop: { kind: 'token', githubToken: 'scoop-value' },
    })
  })

  test('omits publishers whose env var is absent', () => {
    const credentials = loadPublisherCredentialsFromEnv({
      NPM_TOKEN: 'npm-value',
      HOMEBREW_GITHUB_TOKEN: 'homebrew-value',
    })
    expect(credentials).toEqual({
      npm: { kind: 'token', token: 'npm-value' },
      homebrew: { kind: 'token', githubToken: 'homebrew-value' },
    })
  })

  test('treats empty-string env values as absent', () => {
    const credentials = loadPublisherCredentialsFromEnv({
      NPM_TOKEN: '',
      PYPI_API_TOKEN: 'pypi-value',
      HOMEBREW_GITHUB_TOKEN: '',
      SCOOP_GITHUB_TOKEN: undefined,
    })
    expect(credentials).toEqual({ pypi: { kind: 'token', token: 'pypi-value' } })
  })

  test('returns an empty PublisherCredentials when no relevant env vars are present', () => {
    const credentials = loadPublisherCredentialsFromEnv({
      OTHER_TOKEN: 'noise',
      PATH: '/usr/bin',
    })
    expect(credentials).toEqual({})
  })

  test('ignores env vars that are not on the canonical list', () => {
    const credentials = loadPublisherCredentialsFromEnv({
      NPM_AUTH_TOKEN: 'wrong-name',
      GITHUB_TOKEN: 'wrong-name',
      PYPI_TOKEN: 'wrong-name',
    })
    expect(credentials).toEqual({})
  })

  test('output feeds preflightReleasePublish without any reshaping', () => {
    const plan = pypiPlan()
    const credentials = loadPublisherCredentialsFromEnv({ PYPI_API_TOKEN: 'pypi-value' })
    const result = preflightReleasePublish({ plan, credentials })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cleared).toEqual(['pypi'])
  })

  test('preflight surfaces missing publishers when env vars are absent', () => {
    const plan = homebrewPlan()
    const credentials = loadPublisherCredentialsFromEnv({})
    const result = preflightReleasePublish({ plan, credentials })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        publisher: 'homebrew',
        code: 'CREDENTIAL_MISSING',
        message: `publisher 'homebrew' has steps in the plan but no credentials were supplied`,
      },
    ])
  })

  test('exposes the canonical env names so callers can document them', () => {
    expect(PUBLISHER_ENV_NAMES).toEqual({
      npm: { token: 'NPM_TOKEN' },
      pypi: { token: 'PYPI_API_TOKEN' },
      homebrew: { githubToken: 'HOMEBREW_GITHUB_TOKEN' },
      scoop: { githubToken: 'SCOOP_GITHUB_TOKEN' },
    })
  })
})
