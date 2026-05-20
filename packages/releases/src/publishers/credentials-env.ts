import type { PackageEcosystem } from '../manifest.js'
import type { PublisherCredentials } from './preflight.js'

export const PUBLISHER_ENV_NAMES = {
  npm: { token: 'NPM_TOKEN' },
  pypi: { token: 'PYPI_API_TOKEN' },
  homebrew: { githubToken: 'HOMEBREW_GITHUB_TOKEN' },
  scoop: { githubToken: 'SCOOP_GITHUB_TOKEN' },
} as const

export type PublisherEnvNames = typeof PUBLISHER_ENV_NAMES

export type EnvRecord = Record<string, string | undefined>

function readNonEmpty(env: EnvRecord, name: string): string | undefined {
  const value = env[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const LOADERS: {
  [E in PackageEcosystem]: (env: EnvRecord) => PublisherCredentials[E] | undefined
} = {
  npm: (env) => {
    const token = readNonEmpty(env, PUBLISHER_ENV_NAMES.npm.token)
    return token ? { token } : undefined
  },
  pypi: (env) => {
    const token = readNonEmpty(env, PUBLISHER_ENV_NAMES.pypi.token)
    return token ? { token } : undefined
  },
  homebrew: (env) => {
    const githubToken = readNonEmpty(env, PUBLISHER_ENV_NAMES.homebrew.githubToken)
    return githubToken ? { githubToken } : undefined
  },
  scoop: (env) => {
    const githubToken = readNonEmpty(env, PUBLISHER_ENV_NAMES.scoop.githubToken)
    return githubToken ? { githubToken } : undefined
  },
}

export function loadPublisherCredentialsFromEnv(env: EnvRecord): PublisherCredentials {
  const credentials: PublisherCredentials = {}
  const npm = LOADERS.npm(env)
  if (npm) credentials.npm = npm
  const pypi = LOADERS.pypi(env)
  if (pypi) credentials.pypi = pypi
  const homebrew = LOADERS.homebrew(env)
  if (homebrew) credentials.homebrew = homebrew
  const scoop = LOADERS.scoop(env)
  if (scoop) credentials.scoop = scoop
  return credentials
}
