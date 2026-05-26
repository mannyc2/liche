export type StringRule = {
  readonly name: string
  readonly pattern: RegExp
  readonly replace?: string
}

export type RedactionOptions = {
  readonly extraSecretKeys?: ReadonlyArray<RegExp>
  readonly extraStringPatterns?: ReadonlyArray<RegExp | StringRule>
  readonly redactor?: (value: unknown) => unknown
}

export type RedactionPolicy = {
  readonly ruleNames: ReadonlyArray<string>
  readonly redact: (value: unknown) => unknown
}

const SENTINEL = '[redacted]'
const FIELD_NAME_RULE = 'field-name-secrets'

const BUILT_IN_STRING_RULES: ReadonlyArray<StringRule> = [
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g },
  { name: 'github-pat-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { name: 'github-pat-classic', pattern: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g },
  { name: 'aws-akia', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'stripe', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g },
  { name: 'slack', pattern: /\bxox[abporse]-[A-Za-z0-9-]{10,}\b|\bxoxe\.[A-Za-z0-9-]+\b|\bxapp-[A-Za-z0-9-]+\b|\bxwfp-[A-Za-z0-9-]+\b/g },
  { name: 'google-api', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: 'openai', pattern: /\bsk-(?:proj-|svcacct-|None-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'npm', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'jwt', pattern: /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    name: 'inline-secret-value',
    pattern: /(["']?(?:api[_-]?key|authorization|password|private[_-]?key|secret|token)["']?\s*[:=]\s*["'])[^"',\s]+(["'])?/gi,
    replace: `$1${SENTINEL}$2`,
  },
]

const BUILT_IN_SECRET_KEY = /(?:authorization|password|secret|token|api[_-]?key|private[_-]?key)/i

function normalizeRule(entry: RegExp | StringRule, index: number): StringRule {
  return entry instanceof RegExp ? { name: `extra-string-${index}`, pattern: entry } : entry
}

export function createRedactionPolicy(options: RedactionOptions = {}): RedactionPolicy {
  const stringRules: ReadonlyArray<StringRule> = Object.freeze([
    ...BUILT_IN_STRING_RULES,
    ...(options.extraStringPatterns ?? []).map(normalizeRule),
  ])
  const secretKeyTests: ReadonlyArray<RegExp> = [BUILT_IN_SECRET_KEY, ...(options.extraSecretKeys ?? [])]
  const isSecretKey = (key: string): boolean => secretKeyTests.some((rx) => rx.test(key))

  const redactString = (input: string): string => {
    let out = input
    for (const rule of stringRules) {
      out = out.replace(rule.pattern, rule.replace ?? SENTINEL)
    }
    return out
  }

  const redactValueOfKey = (value: unknown): unknown => {
    if (typeof value === 'string') return SENTINEL
    if (Array.isArray(value)) return [SENTINEL]
    if (value !== null && typeof value === 'object') return { [SENTINEL]: true }
    return SENTINEL
  }

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return redactString(value)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = isSecretKey(k) ? redactValueOfKey(v) : walk(v)
      }
      return out
    }
    return value
  }

  const redact = options.redactor
    ? (value: unknown): unknown => options.redactor!(walk(value))
    : walk

  return {
    ruleNames: Object.freeze([...stringRules.map((r) => r.name), FIELD_NAME_RULE]),
    redact,
  }
}
