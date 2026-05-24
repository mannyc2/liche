import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { applyAuth, defineGlobal, secret } from '@liche/core'
import type {
  AuthCredential,
  AuthIdentityProbeInput,
  AuthProviderRuntime,
  CliExtension,
  CommandError,
  ContextRuntime,
  GlobalInputDefinition,
  InvocationKind,
} from '@liche/core'

export const authGlobals: readonly GlobalInputDefinition[] = Object.freeze([
  defineGlobal({
    description: 'Profile to use',
    key: 'profile',
    type: 'string',
    valueLabel: 'name',
  }),
  defineGlobal({
    description: 'Disable interactive prompts',
    flag: 'non-interactive',
    key: 'nonInteractive',
    type: 'boolean',
  }),
  defineGlobal({
    description: 'Do not read or write stored session state',
    flag: 'no-session',
    key: 'noSession',
    type: 'boolean',
  }),
])

export function auth(): CliExtension {
  return {
    globals: authGlobals,
    id: 'liche.auth',
  }
}

export type StoredProfile = {
  schemaVersion: 1
  productId: string
  providerId: string
  profile: string
  createdAt: string
  updatedAt: string
  account?: { id: string; label?: string | undefined } | undefined
  selectedContexts?: Record<string, string> | undefined
  credential?: {
    kind: 'bearer' | 'apiKey'
    accessToken?: AuthCredential['secret'] | undefined
    expiresAt?: string | undefined
    scopes?: string[] | undefined
  } | undefined
}

export interface SessionStore {
  listProfiles(productId: string, providerId: string): Promise<string[]>
  loadProfile(productId: string, providerId: string, profile: string): Promise<StoredProfile | undefined>
  saveProfile(productId: string, providerId: string, profile: string, value: StoredProfile): Promise<void>
  deleteProfile(productId: string, providerId: string, profile: string): Promise<void>
  deleteAllProfiles(productId: string, providerId: string): Promise<number>
  getActiveProfile(productId: string, providerId: string): Promise<string | undefined>
  setActiveProfile(productId: string, providerId: string, profile: string): Promise<void>
}

export type FileSessionStoreOptions = {
  lockTimeoutMs?: number | undefined
  now?: (() => Date) | undefined
  root?: string | undefined
}

export type ResolveAuthInput = {
  provider: AuthProviderRuntime
  required: boolean
  requiredScopes?: string[] | undefined
  requiredPermissions?: string[] | undefined
  productId?: string | undefined
  profile?: string | undefined
  profileEnvVar?: string | undefined
  invocation: InvocationKind
  nonInteractive?: boolean | undefined
  allowStoredSession?: boolean | undefined
  noSession?: boolean | undefined
  env?: Record<string, string | undefined> | undefined
  loginCommand?: string | undefined
  sessionStore?: SessionStore | undefined
}

export type ResolveContextInput = {
  contexts: ContextRuntime[]
  required: string[]
  explicit?: Record<string, string | undefined> | undefined
  env?: Record<string, string | undefined> | undefined
  credentialSource?: 'env' | 'session' | 'none' | undefined
  providerId?: string | undefined
  profile?: StoredProfile | undefined
  profileExplicit?: boolean | undefined
}

export type AuthRuntimeInput = {
  allowStoredSession?: boolean | undefined
  baseUrl?: AuthIdentityProbeInput['baseUrl'] | undefined
  env?: Record<string, string | undefined> | undefined
  fetch?: AuthIdentityProbeInput['fetch'] | undefined
  global?: { nonInteractive?: boolean | undefined; noSession?: boolean | undefined; profile?: string | undefined } | undefined
  invocation: InvocationKind
  loginCommand?: string | undefined
  productId: string
  profile?: string | undefined
  profileEnvVar?: string | undefined
  provider: AuthProviderRuntime
  sessionStore: SessionStore
}

type AuthStatus = {
  authenticated: boolean
  source?: 'env' | 'session' | undefined
  profile?: string | undefined
  account?: { id: string; label?: string | undefined } | undefined
  contexts?: Record<string, string> | undefined
  expiresAt?: string | undefined
  refreshAvailable?: boolean | undefined
}

type DeviceCodeResponse = {
  deviceCode: string
  expiresIn: number
  interval: number
  userCode?: string | undefined
  verificationUri?: string | undefined
}

type TokenResponse = {
  accessToken: string
  expiresIn?: number | undefined
  scope?: string | undefined
}

type StoredSessionFile = {
  schemaVersion: 1
  productId: string
  providers: Record<string, {
    activeProfile?: string | undefined
    profiles: Record<string, StoredProfileFile>
  }>
}

type StoredProfileFile = Omit<StoredProfile, 'credential'> & {
  credential?: {
    kind: 'bearer' | 'apiKey'
    accessToken?: string | undefined
    expiresAt?: string | undefined
    scopes?: string[] | undefined
  } | undefined
}

const DEFAULT_LOCK_TIMEOUT_MS = 2_000
const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/

export function createFileSessionStore(options: FileSessionStoreOptions = {}): SessionStore {
  const root = options.root ?? defaultSessionRoot()
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const now = options.now ?? (() => new Date())

  return {
    async listProfiles(productId, providerId) {
      validateIds(productId, providerId)
      const file = await readSessionFile(root, productId)
      const provider = file.providers[providerId]
      return provider ? Object.keys(provider.profiles).sort() : []
    },
    async loadProfile(productId, providerId, profile) {
      validateIds(productId, providerId)
      validateProfile(profile)
      const file = await readSessionFile(root, productId)
      return providerProfile(file, providerId, profile)
    },
    async saveProfile(productId, providerId, profile, value) {
      validateIds(productId, providerId)
      validateProfile(profile)
      await mutateSessionFile(root, productId, providerId, lockTimeoutMs, now, (file) => {
        const provider = ensureProvider(file, providerId)
        const previous = providerProfile(file, providerId, profile)
        const createdAt = value.createdAt || previous?.createdAt || now().toISOString()
        provider.profiles[profile] = toFileProfile({
          ...value,
          schemaVersion: 1,
          productId,
          providerId,
          profile,
          createdAt,
          updatedAt: value.updatedAt || now().toISOString(),
        })
        provider.activeProfile = profile
      })
    },
    async deleteProfile(productId, providerId, profile) {
      validateIds(productId, providerId)
      validateProfile(profile)
      await mutateSessionFile(root, productId, providerId, lockTimeoutMs, now, (file) => {
        const provider = file.providers[providerId]
        if (!provider) return
        delete provider.profiles[profile]
        if (provider.activeProfile === profile) {
          provider.activeProfile = Object.keys(provider.profiles).sort()[0]
        }
      })
    },
    async deleteAllProfiles(productId, providerId) {
      validateIds(productId, providerId)
      let deleted = 0
      await mutateSessionFile(root, productId, providerId, lockTimeoutMs, now, (file) => {
        const provider = file.providers[providerId]
        if (!provider) return
        deleted = Object.keys(provider.profiles).length
        provider.profiles = {}
        delete provider.activeProfile
      })
      return deleted
    },
    async getActiveProfile(productId, providerId) {
      validateIds(productId, providerId)
      const file = await readSessionFile(root, productId)
      return file.providers[providerId]?.activeProfile
    },
    async setActiveProfile(productId, providerId, profile) {
      validateIds(productId, providerId)
      validateProfile(profile)
      await mutateSessionFile(root, productId, providerId, lockTimeoutMs, now, (file) => {
        ensureProvider(file, providerId).activeProfile = profile
      })
    },
  }
}

export async function resolveAuth(input: ResolveAuthInput): Promise<AuthCredential | undefined> {
  const { provider, required, requiredScopes, requiredPermissions, invocation, env = {} } = input
  if (provider.kind === 'none') return undefined

  const envVarsTried: string[] = []
  for (const source of provider.tokenSources) {
    if (source.kind !== 'env') continue
    const mode = source.mode ?? 'any'
    if (mode === 'ci' && invocation !== 'ci') continue
    envVarsTried.push(source.envVar)
    const value = env[source.envVar]
    if (value && value.length > 0) {
      const credential = buildCredential(provider, value, source.scopes)
      assertScopes(provider.id, credential, requiredScopes, requiredPermissions)
      return credential
    }
  }

  const sessionSource = provider.tokenSources.find((source) => source.kind === 'session')
  if (sessionSource && input.sessionStore && input.productId && sessionAllowed(input)) {
    const profile = await resolveProfileName(input)
    const stored = await input.sessionStore.loadProfile(input.productId, provider.id, profile)
    const credential = credentialFromStoredProfile(provider, stored)
    if (credential) {
      if (credential.expiresAt !== undefined && Date.parse(credential.expiresAt) <= Date.now()) {
        throw authExpired({ providerId: provider.id, loginCommand: input.loginCommand })
      }
      assertScopes(provider.id, credential, requiredScopes, requiredPermissions)
      return credential
    }
  }

  if (!required) return undefined
  if (invocation === 'ci') throw authCiTokenMissing({ providerId: provider.id, envVars: envVarsTried })
  throw authMissing({
    providerId: provider.id,
    envVars: envVarsTried,
    loginCommand: input.loginCommand,
    ...(requiredPermissions ? { requiredPermissions } : undefined),
  })
}

export async function resolveContext(input: ResolveContextInput): Promise<Record<string, string>> {
  const { contexts, required, explicit = {}, env = {}, providerId = '' } = input
  const resolved: Record<string, string> = {}
  const missing: { id: string; envVar?: string | undefined; flag?: string | undefined }[] = []

  for (const id of required) {
    const ctx = contexts.find((c) => c.id === id)
    if (!ctx) {
      missing.push({ id })
      continue
    }
    const explicitValue = ctx.flag ? explicit[ctx.flag] : undefined
    const envValue = ctx.envVar ? env[ctx.envVar] : undefined
    const storedValue = input.profile && (input.credentialSource === 'session' || input.profileExplicit)
      ? input.profile.selectedContexts?.[id]
      : undefined
    const value = explicitValue ?? envValue ?? storedValue
    if (value && value.length > 0) resolved[id] = value
    else missing.push({ id, envVar: ctx.envVar, flag: ctx.flag })
  }

  if (missing.length > 0) throw authContextRequired({ providerId, contexts: missing })
  return resolved
}

export async function authWhoami(input: AuthRuntimeInput): Promise<AuthStatus> {
  const profile = input.profile ?? input.global?.profile
  const credential = await resolveAuth({
    allowStoredSession: input.allowStoredSession,
    env: input.env,
    invocation: input.invocation,
    loginCommand: input.loginCommand,
    noSession: input.global?.noSession,
    nonInteractive: input.global?.nonInteractive,
    productId: input.productId,
    profile,
    profileEnvVar: input.profileEnvVar,
    provider: input.provider,
    required: false,
    sessionStore: input.sessionStore,
  })
  if (!credential) return { authenticated: false }

  const stored = await loadProfileForCredential(input, credential, profile)
  const account = input.provider.identity && input.baseUrl
    ? await probeIdentity({
        baseUrl: input.baseUrl,
        credential,
        env: input.env,
        fetch: input.fetch,
        identity: input.provider.identity,
      }).catch(() => credential.account ?? stored?.account)
    : credential.account ?? stored?.account

  return compactStatus({
    authenticated: true,
    source: credential.source,
    profile: credential.profile ?? stored?.profile ?? profile,
    account,
    contexts: stored?.selectedContexts,
    expiresAt: credential.expiresAt,
    refreshAvailable: credential.refreshAvailable,
  })
}

export async function authSwitch(input: AuthRuntimeInput & {
  contexts: ContextRuntime[]
  values: Record<string, string | undefined>
}): Promise<{ profile: string; contexts: Record<string, string> }> {
  const profile = input.profile ?? input.global?.profile ?? await activeProfile(input)
  const selectedContexts: Record<string, string> = {}
  for (const ctx of input.contexts) {
    const value = ctx.flag ? input.values[ctx.flag] : undefined
    if (value !== undefined && value !== '') selectedContexts[ctx.id] = value
  }

  const previous = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  const now = new Date().toISOString()
  const stored: StoredProfile = {
    schemaVersion: 1,
    productId: input.productId,
    providerId: input.provider.id,
    profile,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(previous?.account ? { account: previous.account } : undefined),
    selectedContexts: {
      ...(previous?.selectedContexts ?? {}),
      ...selectedContexts,
    },
    ...(previous?.credential ? { credential: previous.credential } : undefined),
  }
  await input.sessionStore.saveProfile(input.productId, input.provider.id, profile, stored)
  await input.sessionStore.setActiveProfile(input.productId, input.provider.id, profile)
  return { profile, contexts: stored.selectedContexts ?? {} }
}

export async function logoutAuthSession(input: AuthRuntimeInput & { all?: boolean | undefined }): Promise<{
  authenticated: false
  deleted: number
  profile?: string | undefined
}> {
  if (input.all) {
    const deleted = await input.sessionStore.deleteAllProfiles(input.productId, input.provider.id)
    return { authenticated: false, deleted }
  }
  const profile = input.profile ?? input.global?.profile ?? await activeProfile(input)
  const exists = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  await input.sessionStore.deleteProfile(input.productId, input.provider.id, profile)
  return { authenticated: false, deleted: exists ? 1 : 0, profile }
}

export async function oauthDeviceLogin(input: AuthRuntimeInput & { interactive?: boolean | undefined }): Promise<AuthStatus & {
  verificationUri?: string | undefined
  userCode?: string | undefined
}> {
  const oauth = input.provider.oauthDevice
  if (!oauth) throw authInvalid({ providerId: input.provider.id })
  if (input.invocation !== 'cli' || input.global?.nonInteractive || input.interactive === false) {
    throw authInteractiveRequired({ providerId: input.provider.id, loginCommand: input.loginCommand })
  }

  const profile = input.profile ?? input.global?.profile ?? await activeProfile(input)
  const device = await requestDeviceCode(oauth.endpoints.deviceAuthorization, {
    client_id: oauth.clientId,
    ...(oauth.scopes?.length ? { scope: oauth.scopes.join(' ') } : undefined),
  }, input.fetch)
  const token = await pollDeviceToken(oauth.endpoints.token, {
    client_id: oauth.clientId,
    device_code: device.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  }, {
    expiresIn: device.expiresIn,
    fetch: input.fetch,
    interval: device.interval,
    providerId: input.provider.id,
  })

  const expiresAt = token.expiresIn !== undefined
    ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
    : undefined
  const credential: AuthCredential = {
    providerId: input.provider.id,
    source: 'session',
    profile,
    kind: input.provider.tokenKind === 'apiKey' || input.provider.kind === 'apiKey' ? 'apiKey' : 'bearer',
    secret: secret(token.accessToken),
    header: input.provider.header,
    expiresAt,
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : oauth.scopes,
    refreshAvailable: false,
  }
  const account = input.provider.identity && input.baseUrl
    ? await probeIdentity({
        baseUrl: input.baseUrl,
        credential,
        env: input.env,
        fetch: input.fetch,
        identity: input.provider.identity,
      }).catch(() => undefined)
    : undefined

  const now = new Date().toISOString()
  const previous = await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
  await input.sessionStore.saveProfile(input.productId, input.provider.id, profile, {
    schemaVersion: 1,
    productId: input.productId,
    providerId: input.provider.id,
    profile,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(account ? { account } : previous?.account ? { account: previous.account } : undefined),
    ...(previous?.selectedContexts ? { selectedContexts: previous.selectedContexts } : undefined),
    credential: {
      kind: credential.kind,
      accessToken: credential.secret,
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : undefined),
      ...(credential.scopes ? { scopes: credential.scopes } : undefined),
    },
  })
  await input.sessionStore.setActiveProfile(input.productId, input.provider.id, profile)

  return compactStatus({
    authenticated: true,
    source: 'session',
    profile,
    account,
    expiresAt,
    refreshAvailable: false,
    verificationUri: device.verificationUri,
    userCode: device.userCode,
  })
}

function authError(code: string, message: string, details?: Record<string, unknown>, recovery: Partial<CommandError> = {}): CommandError {
  return {
    code,
    details,
    exitCode: 1,
    message,
    ...recovery,
  }
}

function authMissing(input: {
  providerId: string
  envVars: string[]
  loginCommand?: string | undefined
  requiredPermissions?: string[] | undefined
}): CommandError {
  const remedies: string[] = []
  if (input.loginCommand) remedies.push(`run \`${input.loginCommand}\``)
  if (input.envVars.length > 0) remedies.push(`set ${input.envVars.join(' or ')}`)
  const message = remedies.length > 0
    ? `Authentication required: ${remedies.join(' or ')}.`
    : 'Authentication required.'
  return authError('AUTH_MISSING', message, {
    providerId: input.providerId,
    envVars: input.envVars,
    loginCommand: input.loginCommand,
    requiredPermissions: input.requiredPermissions,
  }, {
    code_actions: [
      ...(input.loginCommand ? [{ title: 'Log in', command: input.loginCommand }] : []),
      ...(input.envVars.length > 0 ? [{
        title: 'Set auth environment',
        description: `Set ${input.envVars.join(' or ')} before retrying.`,
      }] : []),
    ],
    suggested_fix: remedies.length > 0
      ? `Authenticate by ${remedies.join(' or ')} before retrying.`
      : 'Authenticate before retrying.',
  })
}

function authCiTokenMissing(input: { providerId: string; envVars: string[] }): CommandError {
  const message = input.envVars.length > 0
    ? `CI token required. Set ${input.envVars.join(' or ')}.`
    : 'CI token required.'
  return authError('AUTH_CI_TOKEN_MISSING', message, {
    providerId: input.providerId,
    envVars: input.envVars,
  }, {
    suggested_fix: input.envVars.length > 0
      ? `Set ${input.envVars.join(' or ')} in the CI environment before retrying.`
      : 'Configure a CI token source before retrying.',
  })
}

function authContextRequired(input: {
  providerId: string
  contexts: { id: string; envVar?: string | undefined; flag?: string | undefined }[]
}): CommandError {
  const ids = input.contexts.map((c) => c.id).join(', ')
  return authError('AUTH_CONTEXT_REQUIRED', `Required context missing: ${ids}.`, {
    providerId: input.providerId,
    requiredContexts: input.contexts,
  }, {
    suggested_fix: contextFix(input.contexts),
  })
}

function authScopeMissing(input: {
  providerId: string
  missingScopes: string[]
  requiredPermissions?: string[] | undefined
}): CommandError {
  return authError('AUTH_SCOPE_MISSING', `Credential is missing required scopes: ${input.missingScopes.join(', ')}.`, {
    providerId: input.providerId,
    missingScopes: input.missingScopes,
    requiredPermissions: input.requiredPermissions,
  }, {
    suggested_fix: `Use a credential with the required scopes: ${input.missingScopes.join(', ')}.`,
  })
}

function authInvalid(input: { providerId: string; status?: number | undefined }): CommandError {
  return authError('AUTH_INVALID', 'Authentication rejected by server.', {
    providerId: input.providerId,
    status: input.status ?? 401,
  }, {
    suggested_fix: 'Refresh or replace the current credential before retrying.',
  })
}

function authExpired(input: { providerId: string; loginCommand?: string | undefined }): CommandError {
  return authError('AUTH_EXPIRED', 'Authentication expired.', {
    providerId: input.providerId,
    loginCommand: input.loginCommand,
  }, {
    code_actions: input.loginCommand ? [{ title: 'Log in again', command: input.loginCommand }] : undefined,
    suggested_fix: input.loginCommand
      ? `Run \`${input.loginCommand}\` and retry the command.`
      : 'Refresh the expired credential and retry the command.',
  })
}

function authInteractiveRequired(input: { providerId: string; loginCommand?: string | undefined }): CommandError {
  return authError('AUTH_INTERACTIVE_REQUIRED', 'Interactive login is required for this command.', {
    providerId: input.providerId,
    loginCommand: input.loginCommand,
  }, {
    code_actions: input.loginCommand ? [{ title: 'Log in interactively', command: input.loginCommand }] : undefined,
    suggested_fix: input.loginCommand
      ? `Run \`${input.loginCommand}\` in an interactive terminal before retrying.`
      : 'Run an interactive login flow before retrying.',
  })
}

function authSessionCorrupt(input: { providerId?: string; profile?: string }): CommandError {
  return authError('AUTH_SESSION_CORRUPT', 'Stored auth session is corrupt.', {
    providerId: input.providerId,
    profile: input.profile,
  })
}

function authSessionLocked(input: { providerId?: string; profile?: string }): CommandError {
  return authError('AUTH_SESSION_LOCKED', 'Stored auth session is locked by another process.', {
    providerId: input.providerId,
    profile: input.profile,
  }, {
    suggested_fix: 'Wait for the other process to finish, then retry.',
  })
}

function contextFix(contexts: { id: string; envVar?: string | undefined; flag?: string | undefined }[]): string {
  const remedies = contexts.flatMap((context) => [
    ...(context.flag ? [`--${context.flag}`] : []),
    ...(context.envVar ? [context.envVar] : []),
  ])
  if (remedies.length === 0) return 'Provide the required context before retrying.'
  return `Provide the required context with ${remedies.join(' or ')} before retrying.`
}

async function resolveProfileName(input: ResolveAuthInput): Promise<string> {
  if (input.profile) return input.profile
  if (input.profileEnvVar) {
    const fromEnv = input.env?.[input.profileEnvVar]
    if (fromEnv) return fromEnv
  }
  if (input.productId && input.sessionStore) {
    const active = await input.sessionStore.getActiveProfile(input.productId, input.provider.id)
    if (active) return active
  }
  return 'default'
}

function sessionAllowed(input: ResolveAuthInput): boolean {
  if (input.noSession) return false
  if (input.allowStoredSession !== undefined) return input.allowStoredSession
  if (input.invocation === 'cli') return true
  if (input.invocation === 'agent' || input.invocation === 'mcp') return !!input.profile
  return false
}

function buildCredential(provider: AuthProviderRuntime, raw: string, scopes: string[] | undefined): AuthCredential {
  const kind: 'bearer' | 'apiKey' = provider.kind === 'apiKey' ? 'apiKey' : 'bearer'
  const credential: AuthCredential = {
    providerId: provider.id,
    source: 'env',
    kind,
    secret: secret(raw),
    header: provider.header,
    refreshAvailable: false,
  }
  if (scopes) credential.scopes = [...scopes]
  return credential
}

function credentialFromStoredProfile(
  provider: AuthProviderRuntime,
  profile: StoredProfile | undefined,
): AuthCredential | undefined {
  const stored = profile?.credential
  const token = stored?.accessToken
  if (!profile || !stored || !token) return undefined
  return {
    providerId: provider.id,
    source: 'session',
    profile: profile.profile,
    kind: stored.kind,
    secret: token,
    header: provider.header,
    account: profile.account,
    scopes: stored.scopes,
    expiresAt: stored.expiresAt,
    refreshAvailable: false,
  }
}

function assertScopes(
  providerId: string,
  credential: AuthCredential,
  requiredScopes: string[] | undefined,
  requiredPermissions: string[] | undefined,
): void {
  if (!requiredScopes || requiredScopes.length === 0 || !credential.scopes) return
  const missing = requiredScopes.filter((s) => !credential.scopes!.includes(s))
  if (missing.length > 0) {
    throw authScopeMissing({
      providerId,
      missingScopes: missing,
      ...(requiredPermissions ? { requiredPermissions } : undefined),
    })
  }
}

function defaultSessionRoot(env: Record<string, string | undefined> = process.env): string {
  if (env['LICHE_HOME']) return env['LICHE_HOME']
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'liche')
  if (platform() === 'win32') return join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'liche')
  return join(env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'liche')
}

async function mutateSessionFile(
  root: string,
  productId: string,
  providerId: string,
  lockTimeoutMs: number,
  now: () => Date,
  mutate: (file: StoredSessionFile) => void,
): Promise<void> {
  const filePath = sessionFilePath(root, productId)
  await mkdir(dirname(filePath), { mode: 0o700, recursive: true })
  await withLock(`${filePath}.lock`, lockTimeoutMs, providerId, async () => {
    const file = await readSessionFile(root, productId)
    mutate(file)
    await writeSessionFile(filePath, file, now)
  })
}

async function readSessionFile(root: string, productId: string): Promise<StoredSessionFile> {
  const filePath = sessionFilePath(root, productId)
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return emptyFile(productId)
    throw error
  }

  try {
    const raw = JSON.parse(text) as StoredSessionFile
    if (raw.schemaVersion !== 1 || raw.productId !== productId || !raw.providers || typeof raw.providers !== 'object') {
      throw new Error('invalid session file')
    }
    return hydrateFile(raw)
  } catch {
    const corruptPath = `${filePath}.corrupt.${Date.now()}`
    await rename(filePath, corruptPath).catch(() => undefined)
    throw authSessionCorrupt({})
  }
}

async function writeSessionFile(filePath: string, file: StoredSessionFile, now: () => Date): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}.${now().getTime()}`
  await writeFile(tmp, `${JSON.stringify(dehydrateFile(file), null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, filePath)
  await chmodBestEffort(filePath, 0o600)
  await chmodBestEffort(dirname(filePath), 0o700)
}

async function withLock<T>(lockPath: string, timeoutMs: number, providerId: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  let handle: Awaited<ReturnType<typeof open>> | undefined
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600)
    } catch (error) {
      if (!isExists(error)) throw error
      if (Date.now() - startedAt >= timeoutMs) throw authSessionLocked({ providerId })
      await sleep(25)
    }
  }

  try {
    return await fn()
  } finally {
    await handle.close().catch(() => undefined)
    await rm(lockPath, { force: true }).catch(() => undefined)
  }
}

function emptyFile(productId: string): StoredSessionFile {
  return { schemaVersion: 1, productId, providers: {} }
}

function ensureProvider(file: StoredSessionFile, providerId: string): StoredSessionFile['providers'][string] {
  file.providers[providerId] ??= { profiles: {} }
  return file.providers[providerId]!
}

function providerProfile(file: StoredSessionFile, providerId: string, profile: string): StoredProfile | undefined {
  const stored = file.providers[providerId]?.profiles[profile]
  return stored ? fromFileProfile(stored) : undefined
}

function fromFileProfile(profile: StoredProfileFile): StoredProfile {
  const { credential: rawCredential, ...rest } = profile
  const out: StoredProfile = { ...rest }
  if (rawCredential) {
    out.credential = {
      kind: rawCredential.kind,
      ...(rawCredential.accessToken ? { accessToken: secret(rawCredential.accessToken) } : undefined),
      ...(rawCredential.expiresAt ? { expiresAt: rawCredential.expiresAt } : undefined),
      ...(rawCredential.scopes ? { scopes: [...rawCredential.scopes] } : undefined),
    }
  }
  return out
}

function toFileProfile(profile: StoredProfile): StoredProfileFile {
  const { credential: rawCredential, ...rest } = profile
  const out: StoredProfileFile = { ...rest }
  if (rawCredential) {
    out.credential = {
      kind: rawCredential.kind,
      ...(rawCredential.accessToken ? { accessToken: rawCredential.accessToken.reveal() } : undefined),
      ...(rawCredential.expiresAt ? { expiresAt: rawCredential.expiresAt } : undefined),
      ...(rawCredential.scopes ? { scopes: [...rawCredential.scopes] } : undefined),
    }
  }
  return out
}

function hydrateFile(file: StoredSessionFile): StoredSessionFile {
  const out = emptyFile(file.productId)
  for (const [providerId, provider] of Object.entries(file.providers)) {
    out.providers[providerId] = {
      ...(provider.activeProfile ? { activeProfile: provider.activeProfile } : undefined),
      profiles: {},
    }
    for (const [profile, value] of Object.entries(provider.profiles ?? {})) {
      out.providers[providerId]!.profiles[profile] = toFileProfile(fromFileProfile(value))
    }
  }
  return out
}

function dehydrateFile(file: StoredSessionFile): StoredSessionFile {
  const out = emptyFile(file.productId)
  for (const [providerId, provider] of Object.entries(file.providers)) {
    out.providers[providerId] = {
      ...(provider.activeProfile ? { activeProfile: provider.activeProfile } : undefined),
      profiles: {},
    }
    for (const [profile, value] of Object.entries(provider.profiles)) {
      out.providers[providerId]!.profiles[profile] = toFileProfile(fromFileProfile(value))
    }
  }
  return out
}

function sessionFilePath(root: string, productId: string): string {
  validateProductId(productId)
  return join(root, 'sessions', `${productId}.json`)
}

function validateIds(productId: string, providerId: string): void {
  validateProductId(productId)
  if (!providerId || providerId.includes('/') || providerId.includes('\\')) {
    throw new Error(`Invalid provider id: ${providerId}`)
  }
}

function validateProductId(productId: string): void {
  if (!productId || productId.includes('/') || productId.includes('\\')) {
    throw new Error(`Invalid product id: ${productId}`)
  }
}

function validateProfile(profile: string): void {
  if (!PROFILE_RE.test(profile)) throw new Error(`Invalid auth profile name: ${profile}`)
}

async function chmodBestEffort(path: string, mode: number): Promise<void> {
  if (platform() === 'win32') return
  try {
    await chmod(path, mode)
  } catch {
    // Permission hardening is best effort on filesystems that do not support POSIX mode bits.
  }
}

async function probeIdentity(input: AuthIdentityProbeInput): Promise<{ id: string; label?: string | undefined }> {
  const url = new URL(input.identity.http.path, resolveBaseUrl(input.baseUrl, input.env ?? {}))
  const headers = new Headers({ accept: 'application/json' })
  applyAuth(headers, input.credential)
  const fetcher = input.fetch ?? fetch
  const response = await fetcher(url.toString(), { headers, method: input.identity.http.method })
  if (!response.ok) throw authInvalid({ providerId: input.credential.providerId, status: response.status })
  const body = await response.json()
  const id = valueAt(body, input.identity.subject)
  if (id === undefined || id === null || id === '') throw authInvalid({ providerId: input.credential.providerId })
  const label = input.identity.label ? valueAt(body, input.identity.label) : undefined
  return {
    id: String(id),
    ...(label !== undefined && label !== null && label !== '' ? { label: String(label) } : undefined),
  }
}

async function loadProfileForCredential(
  input: AuthRuntimeInput,
  credential: AuthCredential,
  requestedProfile: string | undefined,
): Promise<StoredProfile | undefined> {
  if (input.global?.noSession) return undefined
  const profile = credential.profile ?? requestedProfile
  if (!profile) return undefined
  return await input.sessionStore.loadProfile(input.productId, input.provider.id, profile)
}

async function activeProfile(input: AuthRuntimeInput): Promise<string> {
  return input.profile
    ?? input.global?.profile
    ?? (input.profileEnvVar ? input.env?.[input.profileEnvVar] : undefined)
    ?? await input.sessionStore.getActiveProfile(input.productId, input.provider.id)
    ?? 'default'
}

async function requestDeviceCode(
  endpoint: string,
  body: Record<string, string>,
  fetcher: AuthIdentityProbeInput['fetch'],
): Promise<DeviceCodeResponse> {
  const response = await postForm(endpoint, body, fetcher)
  if (!response.ok) throw authInvalid({ providerId: 'oauth-device', status: response.status })
  const raw = await response.json() as Record<string, unknown>
  const deviceCode = raw['device_code']
  if (typeof deviceCode !== 'string' || deviceCode.length === 0) {
    throw authInvalid({ providerId: 'oauth-device', status: response.status })
  }
  const verificationUri = raw['verification_uri_complete'] ?? raw['verification_uri']
  return {
    deviceCode,
    expiresIn: Number(raw['expires_in'] ?? 900),
    interval: Number(raw['interval'] ?? 5),
    ...(typeof raw['user_code'] === 'string' ? { userCode: raw['user_code'] } : undefined),
    ...(typeof verificationUri === 'string' ? { verificationUri } : undefined),
  }
}

async function pollDeviceToken(
  endpoint: string,
  body: Record<string, string>,
  options: { expiresIn: number; fetch?: AuthIdentityProbeInput['fetch']; interval: number; providerId: string },
): Promise<TokenResponse> {
  const startedAt = Date.now()
  let interval = Math.max(1, options.interval)
  while (Date.now() - startedAt < options.expiresIn * 1000) {
    const response = await postForm(endpoint, body, options.fetch)
    const parsed = await response.json().catch(() => ({})) as Record<string, unknown>
    if (response.ok && typeof parsed['access_token'] === 'string') {
      return {
        accessToken: parsed['access_token'],
        ...(parsed['expires_in'] !== undefined ? { expiresIn: Number(parsed['expires_in']) } : undefined),
        ...(typeof parsed['scope'] === 'string' ? { scope: parsed['scope'] } : undefined),
      }
    }
    if (parsed['error'] === 'authorization_pending') {
      await sleep(interval * 1000)
      continue
    }
    if (parsed['error'] === 'slow_down') {
      interval += 5
      await sleep(interval * 1000)
      continue
    }
    throw authInvalid({ providerId: options.providerId, status: response.status })
  }
  throw authInvalid({ providerId: options.providerId })
}

async function postForm(
  endpoint: string,
  body: Record<string, string>,
  fetcher: AuthIdentityProbeInput['fetch'],
): Promise<Response> {
  const params = new URLSearchParams(body)
  return await (fetcher ?? fetch)(endpoint, {
    body: params,
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })
}

function resolveBaseUrl(value: AuthIdentityProbeInput['baseUrl'], env: Record<string, string | undefined>): string {
  if (typeof value === 'string') return value
  if (value.envVar) return env[value.envVar] ?? value.literal ?? ''
  return value.literal ?? ''
}

function valueAt(input: unknown, path: string): unknown {
  let cursor = input as any
  for (const part of path.split('.')) {
    if (!part) continue
    cursor = cursor?.[part]
  }
  return cursor
}

function compactStatus<T extends AuthStatus>(status: T): T {
  return JSON.parse(JSON.stringify(status)) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as any).code === 'ENOENT'
}

function isExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as any).code === 'EEXIST'
}
