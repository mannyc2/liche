import { appendFile, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { CliEventSubscriber } from '../types.js'

export type LocalDoctorPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'

export type LocalDoctorInput = {
  cliName: string
  version?: string | undefined
  env?: Record<string, string | undefined> | undefined
  packageManagers?: readonly LocalDoctorPackageManager[] | undefined
}

export type LocalDoctorCheckStatus = 'pass' | 'warn' | 'fail'

export type LocalDoctorCheck = {
  id: string
  status: LocalDoctorCheckStatus
  message: string
  details?: Record<string, unknown> | undefined
}

export type LocalDoctorReport = {
  cli: {
    name: string
    version?: string | undefined
  }
  checks: LocalDoctorCheck[]
  summary: {
    pass: number
    warn: number
    fail: number
  }
}

export type LocalTelemetrySinkOptions = {
  enabledEnvVar?: string | undefined
  fileEnvVar?: string | undefined
  env?: Record<string, string | undefined> | undefined
  append?: ((path: string, text: string) => Promise<void> | void) | undefined
}

const DEFAULT_PACKAGE_MANAGERS: readonly LocalDoctorPackageManager[] = ['bun', 'npm', 'pnpm', 'yarn']
const DEFAULT_TELEMETRY_ENABLED_ENV = 'LICHE_TELEMETRY'
const DEFAULT_TELEMETRY_FILE_ENV = 'LICHE_TELEMETRY_FILE'

export async function runLocalDoctor(input: LocalDoctorInput): Promise<LocalDoctorReport> {
  const env = input.env ?? (Bun.env as Record<string, string | undefined>)
  const checks: LocalDoctorCheck[] = []
  const pathEntries = splitPath(env['PATH'])
  checks.push(pathEntries.length > 0
    ? {
        id: 'path.present',
        status: 'pass',
        message: 'PATH is configured.',
        details: { entries: pathEntries.length },
      }
    : {
        id: 'path.present',
        status: 'fail',
        message: 'PATH is empty or missing.',
      })

  checks.push(pathEntries.some((entry) => entry.endsWith(`${delimiter === ';' ? '\\' : '/'}node_modules${delimiter === ';' ? '\\' : '/'}.bin`) || entry.includes('node_modules/.bin'))
    ? {
        id: 'path.local-bin',
        status: 'pass',
        message: 'PATH includes a local node_modules/.bin entry.',
      }
    : {
        id: 'path.local-bin',
        status: 'warn',
        message: 'PATH does not include a local node_modules/.bin entry.',
      })

  for (const manager of input.packageManagers ?? DEFAULT_PACKAGE_MANAGERS) {
    const found = await findOnPath(manager, pathEntries)
    checks.push(found
      ? {
          id: `package-manager.${manager}`,
          status: 'pass',
          message: `${manager} is available on PATH.`,
          details: { path: found },
        }
      : {
          id: `package-manager.${manager}`,
          status: manager === 'bun' ? 'fail' : 'warn',
          message: `${manager} was not found on PATH.`,
        })
  }

  return {
    cli: {
      name: input.cliName,
      ...(input.version === undefined ? {} : { version: input.version }),
    },
    checks,
    summary: countChecks(checks),
  }
}

export function createLocalTelemetrySink(options: LocalTelemetrySinkOptions = {}): CliEventSubscriber {
  const enabledEnvVar = options.enabledEnvVar ?? DEFAULT_TELEMETRY_ENABLED_ENV
  const fileEnvVar = options.fileEnvVar ?? DEFAULT_TELEMETRY_FILE_ENV
  const env = options.env ?? (Bun.env as Record<string, string | undefined>)
  const append = options.append ?? ((path: string, text: string) => appendFile(path, text))
  return async (event) => {
    if (!isTruthy(env[enabledEnvVar])) return
    const path = env[fileEnvVar]
    if (!path) return
    await append(path, `${JSON.stringify(redactTelemetryValue(event))}\n`)
  }
}

function redactTelemetryValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactTelemetryValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? '[redacted]' : redactTelemetryValue(child)
    }
    return out
  }
  return value
}

function countChecks(checks: readonly LocalDoctorCheck[]): LocalDoctorReport['summary'] {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  }
}

function splitPath(value: string | undefined): string[] {
  return (value ?? '').split(delimiter).map((entry) => entry.trim()).filter(Boolean)
}

async function findOnPath(name: string, pathEntries: readonly string[]): Promise<string | undefined> {
  const candidates = process.platform === 'win32' ? [name, `${name}.cmd`, `${name}.exe`] : [name]
  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const path = join(entry, candidate)
      if (await isFile(path)) return path
    }
  }
  return undefined
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

function isSecretKey(key: string): boolean {
  return /(?:authorization|password|secret|token|api[_-]?key|private[_-]?key)/i.test(key)
}

function redactString(value: string): string {
  let out = value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]')
  out = out.replace(/(["']?(?:api[_-]?key|authorization|password|private[_-]?key|secret|token)["']?\s*[:=]\s*["'])[^"',\s]+(["'])?/gi, '$1[redacted]$2')
  return out
}
