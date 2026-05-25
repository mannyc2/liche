import { appendFile } from 'node:fs/promises'
import type { CliEventSubscriber } from '@liche/core'

export type LocalTelemetrySinkOptions = {
  enabledEnvVar?: string
  fileEnvVar?: string
  env?: Record<string, string | undefined>
  append?: (path: string, text: string) => Promise<void> | void
}

const SECRET_KEY = /(?:authorization|password|secret|token|api[_-]?key|private[_-]?key)/i
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g
const INLINE = /(["']?(?:api[_-]?key|authorization|password|private[_-]?key|secret|token)["']?\s*[:=]\s*["'])[^"',\s]+(["'])?/gi

export function createLocalTelemetrySink(options: LocalTelemetrySinkOptions = {}): CliEventSubscriber {
  const {
    enabledEnvVar = 'LICHE_TELEMETRY',
    fileEnvVar = 'LICHE_TELEMETRY_FILE',
    env = Bun.env,
    append = appendFile,
  } = options
  return async (event) => {
    const flag = env[enabledEnvVar]
    if (!flag || flag === '0' || flag.toLowerCase() === 'false') return
    const path = env[fileEnvVar]
    if (!path) return
    await append(path, `${JSON.stringify(redact(event))}\n`)
  }
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(BEARER, 'Bearer [redacted]').replace(INLINE, '$1[redacted]$2')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v)
    return out
  }
  return value
}
