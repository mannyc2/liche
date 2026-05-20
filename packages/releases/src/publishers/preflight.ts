import type { PackageEcosystem } from '../manifest.js'
import { PACKAGE_ECOSYSTEMS } from '../renderers/index.js'
import type { PublishStep, ReleasePublishPlan } from './plan.js'

export type NpmCredentials = {
  token: string
}

export type PypiCredentials = {
  token: string
}

export type HomebrewCredentials = {
  githubToken: string
}

export type ScoopCredentials = {
  githubToken: string
}

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

export type PreflightFailure = {
  publisher: PackageEcosystem
  code: PreflightFailureCode
  message: string
  details?: Record<string, unknown>
}

export type PreflightReleasePublishResult =
  | { ok: true; cleared: PackageEcosystem[] }
  | { ok: false; failures: PreflightFailure[] }

type CredentialField<E extends PackageEcosystem> = E extends 'npm'
  ? keyof NpmCredentials
  : E extends 'pypi'
    ? keyof PypiCredentials
    : E extends 'homebrew'
      ? keyof HomebrewCredentials
      : E extends 'scoop'
        ? keyof ScoopCredentials
        : never

type CredentialSchema = {
  [E in PackageEcosystem]: { secrets: ReadonlyArray<CredentialField<E>> }
}

const CREDENTIAL_SCHEMA: CredentialSchema = {
  npm: { secrets: ['token'] },
  pypi: { secrets: ['token'] },
  homebrew: { secrets: ['githubToken'] },
  scoop: { secrets: ['githubToken'] },
}

function activeEcosystems(steps: readonly PublishStep[]): PackageEcosystem[] {
  const seen = new Set<PackageEcosystem>()
  for (const step of steps) seen.add(step.ecosystem)
  return PACKAGE_ECOSYSTEMS.filter((id) => seen.has(id))
}

function checkEcosystem(
  ecosystem: PackageEcosystem,
  credentials: PublisherCredentials,
): PreflightFailure[] {
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
  const failures: PreflightFailure[] = []
  for (const field of CREDENTIAL_SCHEMA[ecosystem].secrets) {
    const value = supplied[field]
    if (typeof value !== 'string' || value.length === 0) {
      failures.push({
        publisher: ecosystem,
        code: 'CREDENTIAL_EMPTY',
        message: `publisher '${ecosystem}' credential '${field}' is empty`,
        details: { field },
      })
    }
  }
  return failures
}

export function preflightReleasePublish(
  input: PreflightReleasePublishInput,
): PreflightReleasePublishResult {
  const active = activeEcosystems(input.plan.steps)
  const failures: PreflightFailure[] = []
  for (const ecosystem of active) {
    failures.push(...checkEcosystem(ecosystem, input.credentials))
  }
  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, cleared: active }
}
