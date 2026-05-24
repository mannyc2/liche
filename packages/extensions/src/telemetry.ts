import { appendFile } from 'node:fs/promises'
import type { CliEventSubscriber } from '@liche/core'

export type LocalTelemetrySinkOptions = {
  enabledEnvVar?: string | undefined
  fileEnvVar?: string | undefined
  env?: Record<string, string | undefined> | undefined
  append?: ((path: string, text: string) => Promise<void> | void) | undefined
}

const DEFAULT_TELEMETRY_ENABLED_ENV = 'LICHE_TELEMETRY'
const DEFAULT_TELEMETRY_FILE_ENV = 'LICHE_TELEMETRY_FILE'

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
