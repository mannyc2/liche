import { LicheError, type CommandError } from '@liche/core'

function authError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  recovery: Partial<CommandError> = {},
): LicheError {
  return new LicheError({ code, details, exitCode: 1, message, ...recovery })
}

const loginAction = (loginCommand: string | undefined, title: string) =>
  loginCommand ? [{ title, command: loginCommand }] : undefined

export function authMissing(input: {
  providerId: string
  envVars: string[]
  loginCommand?: string | undefined
  requiredPermissions?: string[] | undefined
}): LicheError {
  const remedies: string[] = []
  if (input.loginCommand) remedies.push(`run \`${input.loginCommand}\``)
  if (input.envVars.length > 0) remedies.push(`set ${input.envVars.join(' or ')}`)
  const detail = remedies.length > 0 ? `: ${remedies.join(' or ')}` : ''
  return authError(
    'AUTH_MISSING',
    `Authentication required${detail}.`,
    {
      providerId: input.providerId,
      envVars: input.envVars,
      loginCommand: input.loginCommand,
      requiredPermissions: input.requiredPermissions,
    },
    {
      code_actions: [
        ...(input.loginCommand ? [{ title: 'Log in', command: input.loginCommand }] : []),
        ...(input.envVars.length > 0
          ? [
              {
                title: 'Set auth environment',
                description: `Set ${input.envVars.join(' or ')} before retrying.`,
              },
            ]
          : []),
      ],
      suggested_fix:
        remedies.length > 0
          ? `Authenticate by ${remedies.join(' or ')} before retrying.`
          : 'Authenticate before retrying.',
    },
  )
}

export function authCiTokenMissing(input: { providerId: string; envVars: string[] }): LicheError {
  const list = input.envVars.length > 0 ? `Set ${input.envVars.join(' or ')}` : 'Configure a CI token source'
  return authError('AUTH_CI_TOKEN_MISSING', `CI token required. ${list}.`, input, {
    suggested_fix: `${list} in the CI environment before retrying.`,
  })
}

export function authContextRequired(input: {
  providerId: string
  contexts: { id: string; envVar?: string | undefined; flag?: string | undefined }[]
}): LicheError {
  const ids = input.contexts.map((c) => c.id).join(', ')
  const remedies = input.contexts.flatMap((c) => [...(c.flag ? [`--${c.flag}`] : []), ...(c.envVar ? [c.envVar] : [])])
  return authError(
    'AUTH_CONTEXT_REQUIRED',
    `Required context missing: ${ids}.`,
    {
      providerId: input.providerId,
      requiredContexts: input.contexts,
    },
    {
      suggested_fix:
        remedies.length > 0
          ? `Provide the required context with ${remedies.join(' or ')} before retrying.`
          : 'Provide the required context before retrying.',
    },
  )
}

export function authScopeMissing(input: {
  providerId: string
  missingScopes: string[]
  requiredPermissions?: string[] | undefined
}): LicheError {
  const list = input.missingScopes.join(', ')
  return authError('AUTH_SCOPE_MISSING', `Credential is missing required scopes: ${list}.`, input, {
    suggested_fix: `Use a credential with the required scopes: ${list}.`,
  })
}

export function authInvalid(input: { providerId: string; status?: number | undefined }): LicheError {
  return authError(
    'AUTH_INVALID',
    'Authentication rejected by server.',
    {
      providerId: input.providerId,
      status: input.status ?? 401,
    },
    {
      suggested_fix: 'Refresh or replace the current credential before retrying.',
    },
  )
}

export function authPermissionDenied(input: {
  providerId: string
  requiredPermissions?: string[] | undefined
  status?: number | undefined
}): LicheError {
  return authError(
    'AUTH_PERMISSION_DENIED',
    'Permission denied.',
    {
      providerId: input.providerId,
      requiredPermissions: input.requiredPermissions,
      status: input.status ?? 403,
    },
    {
      suggested_fix:
        input.requiredPermissions && input.requiredPermissions.length > 0
          ? `Use credentials with these permissions: ${input.requiredPermissions.join(', ')}.`
          : 'Use credentials with permission to perform this action.',
    },
  )
}

export function authExpired(input: { providerId: string; loginCommand?: string | undefined }): LicheError {
  return authError('AUTH_EXPIRED', 'Authentication expired.', input, {
    code_actions: loginAction(input.loginCommand, 'Log in again'),
    suggested_fix: input.loginCommand
      ? `Run \`${input.loginCommand}\` and retry the command.`
      : 'Refresh the expired credential and retry the command.',
  })
}

export function authInteractiveRequired(input: { providerId: string; loginCommand?: string | undefined }): LicheError {
  return authError('AUTH_INTERACTIVE_REQUIRED', 'Interactive login is required for this command.', input, {
    code_actions: loginAction(input.loginCommand, 'Log in interactively'),
    suggested_fix: input.loginCommand
      ? `Run \`${input.loginCommand}\` in an interactive terminal before retrying.`
      : 'Run an interactive login flow before retrying.',
  })
}

export function authSessionCorrupt(input: { providerId?: string; profile?: string } = {}): LicheError {
  return authError('AUTH_SESSION_CORRUPT', 'Stored auth session is corrupt.', input)
}

export function authSessionLocked(input: { providerId?: string; profile?: string }): LicheError {
  return authError('AUTH_SESSION_LOCKED', 'Stored auth session is locked by another process.', input, {
    suggested_fix: 'Wait for the other process to finish, then retry.',
  })
}
