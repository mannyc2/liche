export type Invocation = 'cli' | 'ci' | 'agent' | 'mcp'

export type ConsentInput = {
  readonly env: Record<string, string | undefined>
  readonly cliName: string
  readonly invocation: Invocation
  readonly enabledEnvVar?: string
  readonly cliEnabledEnvVar?: string
  readonly respectDoNotTrack?: boolean
  readonly allowedInvocations?: ReadonlyArray<Invocation>
}

export type ConsentReason =
  | 'do-not-track'
  | 'liche-disabled'
  | 'cli-disabled'
  | 'invocation-disabled'
  | 'invocation-enabled'
  | 'cli-enabled'
  | 'liche-enabled'
  | 'invocation-not-allowed'
  | 'no-consent'

export type ConsentResult = {
  readonly enabled: boolean
  readonly reason: ConsentReason
  readonly source?: string
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const FALSY = new Set(['0', 'false', 'off', 'no', ''])

type Tribool = 'true' | 'false' | 'unset'

function parseTribool(raw: string | undefined): Tribool {
  if (raw === undefined) return 'unset'
  const norm = raw.toLowerCase()
  if (TRUTHY.has(norm)) return 'true'
  if (FALSY.has(norm)) return 'false'
  return 'unset'
}

function cliVarName(cliName: string): string {
  return `${cliName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TELEMETRY`
}

function invocationVarName(invocation: Invocation): string {
  return `LICHE_TELEMETRY_${invocation.toUpperCase()}`
}

export function resolveConsent(input: ConsentInput): ConsentResult {
  const {
    env,
    cliName,
    invocation,
    enabledEnvVar = 'LICHE_TELEMETRY',
    cliEnabledEnvVar = cliVarName(cliName),
    respectDoNotTrack = true,
    allowedInvocations = ['cli'],
  } = input

  if (respectDoNotTrack) {
    const dnt = env['DO_NOT_TRACK']
    if (dnt !== undefined && dnt !== '' && dnt !== '0') {
      return { enabled: false, reason: 'do-not-track', source: 'DO_NOT_TRACK' }
    }
  }

  const liche = parseTribool(env[enabledEnvVar])
  const cli = parseTribool(env[cliEnabledEnvVar])
  const invVar = invocationVarName(invocation)
  const inv = parseTribool(env[invVar])

  if (liche === 'false') return { enabled: false, reason: 'liche-disabled', source: enabledEnvVar }
  if (cli === 'false') return { enabled: false, reason: 'cli-disabled', source: cliEnabledEnvVar }
  if (inv === 'false') return { enabled: false, reason: 'invocation-disabled', source: invVar }

  if (inv === 'true') return { enabled: true, reason: 'invocation-enabled', source: invVar }

  if (!allowedInvocations.includes(invocation)) {
    return { enabled: false, reason: 'invocation-not-allowed' }
  }

  if (cli === 'true') return { enabled: true, reason: 'cli-enabled', source: cliEnabledEnvVar }
  if (liche === 'true') return { enabled: true, reason: 'liche-enabled', source: enabledEnvVar }

  return { enabled: false, reason: 'no-consent' }
}
