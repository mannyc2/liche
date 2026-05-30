import { z, parseSchema } from '@liche/core'

const cliEventTypeSchema = z.string()
const streamKindSchema = z.enum(['tty', 'pipe', 'file', 'socket', 'char', 'closed'])

export const wireEventSchema = z.object({
  attributes: z.record(z.string(), z.unknown()).optional(),
  cli: z.object({ name: z.string(), version: z.string().optional() }),
  command: z.object({ id: z.string(), path: z.array(z.string()) }).optional(),
  completion: z.object({ shell: z.string().optional(), suggestionCount: z.number().optional() }).optional(),
  durationMs: z.number().optional(),
  error: z
    .object({
      code: z.string(),
      exitCode: z.number().optional(),
      fieldErrorCount: z.number().optional(),
      retryable: z.boolean().optional(),
      status: z.number().optional(),
    })
    .optional(),
  exitCode: z.number().optional(),
  format: z.string(),
  formatExplicit: z.boolean(),
  occurredAt: z.string(),
  streams: z.object({ stdin: streamKindSchema, stdout: streamKindSchema, stderr: streamKindSchema }),
  result: z.enum(['success', 'user_error', 'system_error', 'canceled']).optional(),
  surface: z
    .object({
      kind: z.enum(['command', 'completion', 'parse', 'terminal']),
      name: z.string().optional(),
    })
    .optional(),
  type: cliEventTypeSchema,
  telemetry: z.object({
    schemaVersion: z.literal(1),
    sessionId: z.string(),
    runId: z.string(),
    sdk: z.object({ name: z.string(), version: z.string() }),
    runtime: z.object({
      name: z.string(),
      version: z.string(),
      platform: z.string(),
      arch: z.string(),
    }),
  }),
})

export type WireEvent = z.infer<typeof wireEventSchema>

export type ParseResult =
  | { ok: true; event: WireEvent }
  | { ok: false; eventType: string; path: string; message: string }

export type Validator = {
  parse(input: unknown): ParseResult
  readonly stats: Readonly<{ dropped: number }>
}

type ValidatorOptions = {
  warn?: (message: string) => void
}

export function createValidator(options: ValidatorOptions = {}): Validator {
  const warn = options.warn ?? ((m: string) => console.warn(m))
  const warned = new Set<string>()
  let dropped = 0

  const parse = (input: unknown): ParseResult => {
    try {
      const event = parseSchema(wireEventSchema, input) as WireEvent
      return { ok: true, event }
    } catch (err) {
      dropped += 1
      const { eventType, path, message } = extractFailure(input, err)
      if (!warned.has(eventType)) {
        warned.add(eventType)
        warn(`[telemetry] validation.dropped type=${eventType} at=${path} ${message}`)
      }
      return { ok: false, eventType, path, message }
    }
  }

  return {
    parse,
    get stats() {
      return Object.freeze({ dropped })
    },
  }
}

function extractFailure(input: unknown, err: unknown): { eventType: string; path: string; message: string } {
  const eventType =
    input && typeof input === 'object' && 'type' in input && typeof input.type === 'string'
      ? (input as { type: string }).type
      : '<unknown>'
  const fieldErrors =
    err && typeof err === 'object' && 'fieldErrors' in err && Array.isArray(err.fieldErrors)
      ? (err as { fieldErrors: Array<{ path?: string; message?: string }> }).fieldErrors
      : []
  const first = fieldErrors[0]
  const path = first?.path ?? '$'
  const message = first?.message ?? (err instanceof Error ? err.message : String(err))
  return { eventType, path, message }
}
