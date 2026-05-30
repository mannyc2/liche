import type { PackageEcosystem } from '../manifest/index.js'
import { PACKAGE_ECOSYSTEMS } from '../renderers/index.js'
import type { PublishStep, ReleasePublishPlan } from './plan.js'

export const OIDC_PROVIDERS = ['github-actions', 'gitlab-ci'] as const
export type OidcProvider = (typeof OIDC_PROVIDERS)[number]

export type NpmTokenCredential = { kind: 'token'; token: string }
export type PypiTokenCredential = { kind: 'token'; token: string }
export type HomebrewTokenCredential = { kind: 'token'; githubToken: string }
export type ScoopTokenCredential = { kind: 'token'; githubToken: string }

export type OidcCredential = {
  kind: 'oidc'
  provider: OidcProvider
  audience?: string
}

export type NpmCredentials = NpmTokenCredential | OidcCredential
export type PypiCredentials = PypiTokenCredential | OidcCredential
export type HomebrewCredentials = HomebrewTokenCredential
export type ScoopCredentials = ScoopTokenCredential

export type PublisherCredentials = {
  npm?: NpmCredentials
  pypi?: PypiCredentials
  homebrew?: HomebrewCredentials
  scoop?: ScoopCredentials
}

export type PreflightReleasePublishInput = {
  plan: ReleasePublishPlan
  credentials: PublisherCredentials
}

export type PreflightFailureCode =
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_EMPTY'
  | 'CREDENTIAL_KIND_UNKNOWN'
  | 'CREDENTIAL_OIDC_UNSUPPORTED'
  | 'CREDENTIAL_OIDC_PROVIDER_INVALID'
  | 'CREDENTIAL_OIDC_AUDIENCE_INVALID'

export type PreflightFailure = {
  publisher: PackageEcosystem
  code: PreflightFailureCode
  message: string
  details?: Record<string, unknown>
}

export type PreflightReleasePublishResult =
  | { ok: true; cleared: PackageEcosystem[] }
  | { ok: false; failures: PreflightFailure[] }

const TOKEN_FIELDS: Record<PackageEcosystem, 'token' | 'githubToken'> = {
  npm: 'token',
  pypi: 'token',
  homebrew: 'githubToken',
  scoop: 'githubToken',
}

const OIDC_SUPPORTED: Record<PackageEcosystem, boolean> = {
  npm: true,
  pypi: true,
  homebrew: false,
  scoop: false,
}

const OIDC_PROVIDER_SET: ReadonlySet<string> = new Set(OIDC_PROVIDERS)

function activeEcosystems(steps: readonly PublishStep[]): PackageEcosystem[] {
  const seen = new Set<PackageEcosystem>()
  for (const step of steps) seen.add(step.ecosystem)
  return PACKAGE_ECOSYSTEMS.filter((id) => seen.has(id))
}

function checkTokenCredential(ecosystem: PackageEcosystem, supplied: Record<string, unknown>): PreflightFailure[] {
  const field = TOKEN_FIELDS[ecosystem]
  const value = supplied[field]
  if (typeof value === 'string' && value.length > 0) return []
  return [
    {
      publisher: ecosystem,
      code: 'CREDENTIAL_EMPTY',
      message: `publisher '${ecosystem}' credential '${field}' is empty`,
      details: { field },
    },
  ]
}

function checkOidcCredential(ecosystem: PackageEcosystem, supplied: Record<string, unknown>): PreflightFailure[] {
  if (!OIDC_SUPPORTED[ecosystem]) {
    return [
      {
        publisher: ecosystem,
        code: 'CREDENTIAL_OIDC_UNSUPPORTED',
        message: `publisher '${ecosystem}' does not support OIDC credentials`,
      },
    ]
  }
  const failures: PreflightFailure[] = []
  const provider = supplied['provider']
  if (typeof provider !== 'string' || !OIDC_PROVIDER_SET.has(provider)) {
    failures.push({
      publisher: ecosystem,
      code: 'CREDENTIAL_OIDC_PROVIDER_INVALID',
      message: `publisher '${ecosystem}' OIDC provider '${String(provider)}' is not supported`,
      details: { provider, supportedProviders: [...OIDC_PROVIDERS] },
    })
  }
  if ('audience' in supplied) {
    const audience = supplied['audience']
    if (typeof audience !== 'string' || audience.length === 0) {
      failures.push({
        publisher: ecosystem,
        code: 'CREDENTIAL_OIDC_AUDIENCE_INVALID',
        message: `publisher '${ecosystem}' OIDC audience must be a non-empty string when provided`,
        details: { audience },
      })
    }
  }
  return failures
}

function checkEcosystem(ecosystem: PackageEcosystem, credentials: PublisherCredentials): PreflightFailure[] {
  const supplied = credentials[ecosystem] as Record<string, unknown> | undefined
  if (!supplied) {
    return [
      {
        publisher: ecosystem,
        code: 'CREDENTIAL_MISSING',
        message: `publisher '${ecosystem}' has steps in the plan but no credentials were supplied`,
      },
    ]
  }
  const kind = supplied['kind']
  if (kind === 'token') return checkTokenCredential(ecosystem, supplied)
  if (kind === 'oidc') return checkOidcCredential(ecosystem, supplied)
  return [
    {
      publisher: ecosystem,
      code: 'CREDENTIAL_KIND_UNKNOWN',
      message: `publisher '${ecosystem}' credential kind '${String(kind)}' is not recognized`,
      details: { kind, supportedKinds: OIDC_SUPPORTED[ecosystem] ? ['token', 'oidc'] : ['token'] },
    },
  ]
}

export function preflightReleasePublish(input: PreflightReleasePublishInput): PreflightReleasePublishResult {
  const active = activeEcosystems(input.plan.steps)
  const failures: PreflightFailure[] = []
  for (const ecosystem of active) {
    failures.push(...checkEcosystem(ecosystem, input.credentials))
  }
  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, cleared: active }
}
