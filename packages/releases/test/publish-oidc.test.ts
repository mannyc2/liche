import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_NPM_REGISTRY_AUDIENCE,
  OIDC_EXECUTOR_FAILURE_CODES,
  audienceForNpmRegistry,
  executeReleasePublish,
  npmOidcExchangeUrl,
} from '../src/index.js'
import type {
  NpmPublishStep,
  OidcExchangeEnv,
  OidcIdTokenFetcher,
  PublisherExecutorRegistry,
  PypiPublishStep,
  ReleasePublishPlan,
} from '../src/index.js'

const tmp = mkdtempSync(join(tmpdir(), 'liche-releases-oidc-'))

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

type WrittenArtifact = {
  path: string
  fileName: string
  sha256: string
  size: number
}

let counter = 0

function writeArtifact(name: string, content: string): WrittenArtifact {
  counter += 1
  const bytes = new TextEncoder().encode(content)
  const path = join(tmp, `${counter}-${name}`)
  writeFileSync(path, bytes)
  return {
    path,
    fileName: name,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  }
}

type Fixture = {
  plan: ReleasePublishPlan
}

function npmOnlyPlan(): Fixture {
  const written = writeArtifact('umbrella.tgz', `npm umbrella ${counter}`)
  const step: NpmPublishStep = {
    kind: 'npm-publish',
    role: 'umbrella',
    packageId: 'npm:@liche/workers',
    ecosystem: 'npm',
    artifactPath: written.path,
    artifactFileName: written.fileName,
    sha256: written.sha256,
    size: written.size,
    name: '@liche/workers',
    version: '0.1.0',
    registry: 'https://registry.npmjs.org/',
    tag: 'latest',
    access: 'public',
  }
  return {
    plan: {
      dryRun: true,
      manifestVersion: 1,
      releaseVersion: '0.1.0',
      subject: { id: 'workers', name: 'Workers CLI', version: '0.1.0' },
      steps: [step],
    },
  }
}

function pypiOnlyPlan(): Fixture {
  const written = writeArtifact('wheel.whl', `pypi wheel ${counter}`)
  const step: PypiPublishStep = {
    kind: 'pypi-upload',
    packageId: 'pypi:liche-workers',
    ecosystem: 'pypi',
    artifactPath: written.path,
    artifactFileName: written.fileName,
    sha256: written.sha256,
    size: written.size,
    name: 'liche-workers',
    version: '0.1.0',
    repositoryUrl: 'https://upload.pypi.org/legacy/',
  }
  return {
    plan: {
      dryRun: true,
      manifestVersion: 1,
      releaseVersion: '0.1.0',
      subject: { id: 'workers', name: 'Workers CLI', version: '0.1.0' },
      steps: [step],
    },
  }
}

let npmFixture: Fixture
let pypiFixture: Fixture

beforeEach(() => {
  npmFixture = npmOnlyPlan()
  pypiFixture = pypiOnlyPlan()
})

describe('audienceForNpmRegistry', () => {
  test('returns npm:registry.npmjs.org for the default public registry', () => {
    expect(audienceForNpmRegistry('https://registry.npmjs.org/')).toBe(DEFAULT_NPM_REGISTRY_AUDIENCE)
    expect(audienceForNpmRegistry('https://registry.npmjs.org/')).toBe('npm:registry.npmjs.org')
  })

  test('strips http/https scheme and trailing slashes', () => {
    expect(audienceForNpmRegistry('https://npm.example.test/')).toBe('npm:npm.example.test')
    expect(audienceForNpmRegistry('http://npm.example.test')).toBe('npm:npm.example.test')
    expect(audienceForNpmRegistry('https://npm.example.test///')).toBe('npm:npm.example.test')
  })

  test('accepts registry hosts with paths', () => {
    expect(audienceForNpmRegistry('https://artifactory.example.test/api/npm/registry/')).toBe(
      'npm:artifactory.example.test/api/npm/registry',
    )
  })
})

describe('npmOidcExchangeUrl', () => {
  test('builds the documented exchange endpoint for unscoped packages', () => {
    expect(npmOidcExchangeUrl('https://registry.npmjs.org/', 'workers')).toBe(
      'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/workers',
    )
  })

  test('percent-encodes scoped package names', () => {
    expect(npmOidcExchangeUrl('https://registry.npmjs.org/', '@liche/workers')).toBe(
      'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/%40liche%2Fworkers',
    )
  })

  test('preserves a custom registry host', () => {
    expect(npmOidcExchangeUrl('https://npm.example.test', 'workers')).toBe(
      'https://npm.example.test/-/npm/v1/oidc/token/exchange/package/workers',
    )
  })
})

describe('OIDC_EXECUTOR_FAILURE_CODES', () => {
  test('reserves the documented executor-side OIDC failure codes', () => {
    expect([...OIDC_EXECUTOR_FAILURE_CODES]).toEqual([
      'TRUSTED_PUBLISHER_MISMATCH',
      'OIDC_EXCHANGE_FAILED',
      'OIDC_AUDIENCE_UNRESOLVABLE',
      'OIDC_TOKEN_FETCH_FAILED',
    ])
  })
})

describe('executeReleasePublish OIDC dispatch', () => {
  test('OIDC_CONTEXT_MISSING when an active OIDC credential has no exchange env', async () => {
    const credentials = { npm: { kind: 'oidc', provider: 'github-actions' } as const }
    const result = await executeReleasePublish({
      plan: npmFixture.plan,
      credentials: credentials,
      executors: { npm: () => ({ ok: true }) },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('OIDC_CONTEXT_MISSING')
    expect(result.failure.ecosystem).toBe('npm')
    expect(result.failure.stepIndex).toBe(0)
    expect(result.completed).toEqual([])
  })

  test('token-kind credentials run without an OIDC exchange env', async () => {
    const result = await executeReleasePublish({
      plan: npmFixture.plan,
      credentials: { npm: { kind: 'token', token: 'npm-token-value' } },
      executors: { npm: () => ({ ok: true }) },
    })
    expect(result.ok).toBe(true)
  })

  test('passes the exact OidcExchangeEnv object through to npm and pypi executors', async () => {
    const seen: { npm?: unknown; pypi?: unknown } = {}
    const fetcher: OidcIdTokenFetcher = async () => ({ ok: true, token: 'stub-jwt' })
    const oidc: OidcExchangeEnv = { idTokenFetcher: fetcher }
    const executors: PublisherExecutorRegistry = {
      npm: (input) => {
        seen.npm = input.oidc
        return { ok: true }
      },
      pypi: (input) => {
        seen.pypi = input.oidc
        return { ok: true }
      },
    }

    const npmResult = await executeReleasePublish({
      plan: npmFixture.plan,
      credentials: { npm: { kind: 'oidc', provider: 'github-actions' } },
      executors,
      oidc,
    })
    expect(npmResult.ok).toBe(true)
    expect(seen.npm).toBe(oidc)

    const pypiResult = await executeReleasePublish({
      plan: pypiFixture.plan,
      credentials: { pypi: { kind: 'oidc', provider: 'github-actions' } },
      executors,
      oidc,
    })
    expect(pypiResult.ok).toBe(true)
    expect(seen.pypi).toBe(oidc)
  })

  test('token-kind credentials still receive the OidcExchangeEnv when one is supplied', async () => {
    let received: OidcExchangeEnv | undefined
    const oidc: OidcExchangeEnv = { idTokenFetcher: async () => ({ ok: true, token: 'unused' }) }
    const result = await executeReleasePublish({
      plan: npmFixture.plan,
      credentials: { npm: { kind: 'token', token: 'npm-token-value' } },
      executors: {
        npm: (input) => {
          received = input.oidc
          return { ok: true }
        },
      },
      oidc,
    })
    expect(result.ok).toBe(true)
    expect(received).toBe(oidc)
  })

  test('executor surfaces TRUSTED_PUBLISHER_MISMATCH through EXECUTOR_FAILED.details.executorCode', async () => {
    const oidc: OidcExchangeEnv = { idTokenFetcher: async () => ({ ok: true, token: 'jwt' }) }
    const result = await executeReleasePublish({
      plan: npmFixture.plan,
      credentials: { npm: { kind: 'oidc', provider: 'github-actions' } },
      executors: {
        npm: () => ({
          ok: false,
          failure: {
            code: 'TRUSTED_PUBLISHER_MISMATCH',
            message: 'workflow filename does not match the configured trusted publisher',
            details: { configured: 'release.yml', observed: 'publish.yml' },
          },
        }),
      },
      oidc,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('EXECUTOR_FAILED')
    expect(result.failure.details).toEqual({
      executorCode: 'TRUSTED_PUBLISHER_MISMATCH',
      configured: 'release.yml',
      observed: 'publish.yml',
    })
  })

  test('idTokenFetcher failures are executor-owned (reported as OIDC_TOKEN_FETCH_FAILED via EXECUTOR_FAILED)', async () => {
    const oidc: OidcExchangeEnv = {
      idTokenFetcher: async () => ({ ok: false, reason: 'ACTIONS_ID_TOKEN_REQUEST_TOKEN missing' }),
    }
    const result = await executeReleasePublish({
      plan: npmFixture.plan,
      credentials: { npm: { kind: 'oidc', provider: 'github-actions' } },
      executors: {
        npm: async (input) => {
          const audience = audienceForNpmRegistry(input.step.registry)
          const idToken = await input.oidc!.idTokenFetcher(audience)
          if (!idToken.ok) {
            return {
              ok: false,
              failure: {
                code: 'OIDC_TOKEN_FETCH_FAILED',
                message: `could not fetch OIDC ID token: ${idToken.reason}`,
                details: { audience, reason: idToken.reason },
              },
            }
          }
          return { ok: true }
        },
      },
      oidc,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('EXECUTOR_FAILED')
    expect(result.failure.details).toEqual({
      executorCode: 'OIDC_TOKEN_FETCH_FAILED',
      audience: 'npm:registry.npmjs.org',
      reason: 'ACTIONS_ID_TOKEN_REQUEST_TOKEN missing',
    })
  })
})
