import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { authSessionCorrupt, authSessionLocked } from './errors.js'
import { secret } from './secret.js'
import type { SessionStore, StoredProfile } from './types.js'

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

export type FileSessionStoreOptions = {
  lockTimeoutMs?: number | undefined
  now?: (() => Date) | undefined
  root?: string | undefined
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

function defaultSessionRoot(env: Record<string, string | undefined> = process.env): string {
  if (env['LILI_HOME']) return env['LILI_HOME']
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'lili')
  if (platform() === 'win32') return join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'lili')
  return join(env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'lili')
}

function isValidProfileName(profile: string): boolean {
  return PROFILE_RE.test(profile)
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
  if (!isValidProfileName(profile)) throw new Error(`Invalid auth profile name: ${profile}`)
}

async function chmodBestEffort(path: string, mode: number): Promise<void> {
  if (platform() === 'win32') return
  try {
    await chmod(path, mode)
  } catch {
    // Permission hardening is best effort on filesystems that do not support
    // POSIX mode bits, such as some mounted development volumes.
  }
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
