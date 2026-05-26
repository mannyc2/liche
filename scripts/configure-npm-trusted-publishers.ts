import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPOSITORY = 'mannyc2/liche'
const REGISTRY_URL = 'https://registry.npmjs.org'
const WORKFLOW_FILE = 'publish.yml'
const ENVIRONMENT = 'npm-production'
const TRUST_PERMISSIONS = ['createPackage'] as const
const AUTH_CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000

const PUBLIC_PACKAGES = [
  '@liche/core',
  '@liche/auth',
  '@liche/completions',
  '@liche/config',
  '@liche/mcp-installer',
  '@liche/mcp-server',
  '@liche/skills-installer',
  '@liche/skills-runtime',
  '@liche/telemetry',
  '@liche/tokens',
  '@liche/agents',
  '@liche/extensions',
  '@liche/build',
  '@liche/releases',
  '@liche/product',
] as const

function hasArg(name: string): boolean {
  return process.argv.includes(name)
}

function packageFilter(): Set<string> | null {
  const index = process.argv.indexOf('--packages')
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error('--packages requires a comma-separated package list')
  return new Set(value.split(',').map((name) => name.trim()).filter(Boolean))
}

function runCapture(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('npm', args, { encoding: 'utf8', env: process.env })
  if (result.error) throw result.error
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function trustedPublisherConfig() {
  return [
    {
      type: 'github',
      claims: {
        repository: REPOSITORY,
        workflow_ref: {
          file: WORKFLOW_FILE,
        },
        environment: ENVIRONMENT,
      },
      permissions: [...TRUST_PERMISSIONS],
    },
  ]
}

type TrustedPublisherConfig = ReturnType<typeof trustedPublisherConfig>
type TrustedPublisherRecord = TrustedPublisherConfig[number] & {
  id?: string
}

function registryAuthKeys(): Set<string> {
  const url = new URL(REGISTRY_URL)
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return new Set([`//${url.host}${pathname}:_authToken`])
}

function unquoteNpmrcValue(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function resolveEnvValue(value: string): string {
  const match = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
  if (!match) return value
  return process.env[match[1]] ?? ''
}

function authTokenFromNpmrc(path: string): string | null {
  if (!existsSync(path)) return null

  const authKeys = registryAuthKeys()
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const equalsIndex = line.indexOf('=')
    if (equalsIndex === -1) continue

    const key = line.slice(0, equalsIndex).trim()
    if (!authKeys.has(key)) continue

    const value = resolveEnvValue(unquoteNpmrcValue(line.slice(equalsIndex + 1)))
    if (value) return value
  }

  return null
}

function npmUserConfigPath(): string | null {
  const result = runCapture(['config', 'get', 'userconfig'])
  if (!result.ok) return null
  const path = result.stdout.trim()
  return path && path !== 'undefined' && path !== 'null' ? path : null
}

function npmAuthToken(): string {
  const envToken = process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN
  if (envToken) return envToken

  const paths = [
    npmUserConfigPath(),
    join(homedir(), '.npmrc'),
  ].filter((path, index, all): path is string => Boolean(path) && all.indexOf(path) === index)

  for (const path of paths) {
    const token = authTokenFromNpmrc(path)
    if (token) return token
  }

  throw new Error('No npm auth token found. Run `npm login --auth-type=web` and retry.')
}

function npmOtp(): string | undefined {
  return process.env.NPM_CONFIG_OTP ?? process.env.NPM_OTP
}

function formatRegistryError(packageName: string, response: Response, text: string): string {
  const details = text.trim()
  const notice = response.headers.get('npm-notice')?.trim()
  const auth = response.headers.get('www-authenticate')?.trim()
  const parts = [
    `${packageName}: registry returned HTTP ${response.status}`,
    auth ? `auth=${auth}` : null,
    notice ?? null,
    details || null,
  ].filter(Boolean)
  return parts.join(': ')
}

function loginUrlFromNotice(notice: string | null): string | null {
  if (!notice) return null
  return notice.match(/https:\/\/www\.npmjs\.com\/(?:auth\/cli|login)\/[A-Za-z0-9-]+/)?.[0] ?? null
}

function authChallengeUrls(text: string, notice: string | null): { authUrl: string | null; doneUrl: string | null } {
  try {
    const body = JSON.parse(text) as { authUrl?: string; doneUrl?: string }
    if (body.authUrl && body.doneUrl) return { authUrl: body.authUrl, doneUrl: body.doneUrl }
  } catch {
    // Use the npm-notice header fallback below when the body is not JSON.
  }

  return {
    authUrl: loginUrlFromNotice(notice),
    doneUrl: null,
  }
}

function maybeOpenLoginUrl(loginUrl: string): void {
  if (process.env.CI || process.platform !== 'darwin') return
  spawnSync('open', [loginUrl], { stdio: 'ignore' })
}

async function pollWebOtp(doneUrl: string, token: string): Promise<string> {
  const deadline = Date.now() + AUTH_CHALLENGE_TIMEOUT_MS

  while (Date.now() < deadline) {
    const response = await fetch(doneUrl, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'npm-command': 'trust',
      },
    })
    const text = await response.text()

    if (response.status === 200) {
      const body = JSON.parse(text) as { token?: string }
      if (!body.token) throw new Error('npm web-auth challenge completed without returning an OTP token')
      return body.token
    }

    if (response.status !== 202) {
      throw new Error(formatRegistryError('npm web-auth challenge', response, text))
    }

    const retryAfter = Number(response.headers.get('retry-after') ?? '1')
    await sleep(Math.max(1000, retryAfter * 1000))
  }

  throw new Error('Timed out waiting for npm web-auth challenge approval')
}

async function otpFromChallenge(
  packageName: string,
  response: Response,
  text: string,
  token: string,
): Promise<string | null> {
  const auth = response.headers.get('www-authenticate') ?? ''
  if (response.status !== 401 && response.status !== 403) return null
  if (!auth.includes('OTP')) return null

  const { authUrl, doneUrl } = authChallengeUrls(text, response.headers.get('npm-notice'))
  if (!authUrl || !doneUrl) return null

  console.log(`${packageName}: npm requires security-key approval`)
  console.log(`${packageName}: ${authUrl}`)
  console.log(`${packageName}: waiting for approval`)
  maybeOpenLoginUrl(authUrl)
  return pollWebOtp(doneUrl, token)
}

function trustedPublisherUrl(packageName: string, configId?: string): string {
  const base = `${REGISTRY_URL}/-/package/${encodeURIComponent(packageName)}/trust`
  return configId ? `${base}/${encodeURIComponent(configId)}` : base
}

async function trustedPublisherRequest(
  packageName: string,
  method: 'DELETE' | 'GET' | 'POST',
  token: string,
  body?: TrustedPublisherConfig,
  otp?: string,
  configId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'npm-auth-type': 'web',
    'npm-command': 'trust',
  }
  if (otp) headers['npm-otp'] = otp

  return fetch(trustedPublisherUrl(packageName, configId), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function trustedPublisherRequestWithAuth(
  packageName: string,
  method: 'DELETE' | 'GET' | 'POST',
  token: string,
  body?: TrustedPublisherConfig,
  otp?: string,
  configId?: string,
): Promise<{ response: Response; text: string }> {
  let response = await trustedPublisherRequest(packageName, method, token, body, otp, configId)
  let text = await response.text()

  if (!response.ok) {
    const otp = await otpFromChallenge(packageName, response, text, token)
    if (otp) {
      response = await trustedPublisherRequest(packageName, method, token, body, otp, configId)
      text = await response.text()
    }
  }

  return { response, text }
}

function isExpectedTrustedPublisher(record: TrustedPublisherRecord): boolean {
  return (
    record.type === 'github' &&
    record.claims?.repository === REPOSITORY &&
    record.claims?.workflow_ref?.file === WORKFLOW_FILE &&
    record.claims?.environment === ENVIRONMENT &&
    Array.isArray(record.permissions) &&
    record.permissions.length === TRUST_PERMISSIONS.length &&
    TRUST_PERMISSIONS.every((permission) => record.permissions?.includes(permission))
  )
}

function parseTrustedPublisherRecords(packageName: string, text: string): TrustedPublisherRecord[] {
  try {
    const body = JSON.parse(text)
    return Array.isArray(body) ? body : [body]
  } catch {
    throw new Error(`${packageName}: registry returned invalid trusted-publisher JSON`)
  }
}

async function listTrustedPublishers(
  packageName: string,
  token: string,
  otp?: string,
): Promise<TrustedPublisherRecord[]> {
  const { response, text } = await trustedPublisherRequestWithAuth(packageName, 'GET', token, undefined, otp)
  if (!response.ok) {
    throw new Error(formatRegistryError(packageName, response, text))
  }
  return parseTrustedPublisherRecords(packageName, text)
}

async function deleteTrustedPublisher(
  packageName: string,
  configId: string,
  token: string,
  otp?: string,
): Promise<void> {
  const { response, text } = await trustedPublisherRequestWithAuth(
    packageName,
    'DELETE',
    token,
    undefined,
    otp,
    configId,
  )
  if (!response.ok) {
    throw new Error(formatRegistryError(packageName, response, text))
  }
}

async function addTrustedPublisher(packageName: string, token: string, otp?: string): Promise<void> {
  const { response, text } = await trustedPublisherRequestWithAuth(
    packageName,
    'POST',
    token,
    trustedPublisherConfig(),
    otp,
  )

  if (response.status === 409) {
    console.log(`${packageName}: trusted publisher already configured; skipping`)
    return
  }

  if (!response.ok) {
    throw new Error(formatRegistryError(packageName, response, text))
  }

  const id = (() => {
    try {
      const body = JSON.parse(text)
      return Array.isArray(body) ? body[0]?.id : undefined
    } catch {
      return undefined
    }
  })()

  console.log(id ? `${packageName}: trusted publisher configured (${id})` : `${packageName}: trusted publisher configured`)
}

async function createTrustedPublisher(packageName: string, token: string, otp?: string): Promise<void> {
  const records = await listTrustedPublishers(packageName, token, otp)
  if (records.some(isExpectedTrustedPublisher)) {
    console.log(`${packageName}: trusted publisher already configured; skipping`)
    return
  }

  for (const record of records) {
    if (!record.id) throw new Error(`${packageName}: existing trusted publisher is missing an id`)
    const repository = record.claims?.repository ?? '(unknown repository)'
    console.log(`${packageName}: replacing trusted publisher for ${repository}`)
    await deleteTrustedPublisher(packageName, record.id, token, otp)
  }

  await addTrustedPublisher(packageName, token, otp)
}

async function main(): Promise<void> {
  const dryRun = hasArg('--dry-run')
  const selected = packageFilter()
  const packageNames = selected ? PUBLIC_PACKAGES.filter((name) => selected.has(name)) : [...PUBLIC_PACKAGES]
  let token: string | undefined
  const otp = npmOtp()

  if (selected && packageNames.length !== selected.size) {
    const unknown = [...selected].filter((name) => !PUBLIC_PACKAGES.includes(name as any))
    throw new Error(`Unknown package(s): ${unknown.join(', ')}`)
  }

  for (const packageName of packageNames) {
    if (dryRun) {
      console.log(`POST ${REGISTRY_URL}/-/package/${encodeURIComponent(packageName)}/trust`)
      console.log(JSON.stringify(trustedPublisherConfig(), null, 2))
      continue
    }

    console.log(`${packageName}: configuring trusted publisher`)
    token ??= npmAuthToken()
    await createTrustedPublisher(packageName, token, otp)
    await sleep(2000)
  }
}

await main()
