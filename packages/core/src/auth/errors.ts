import { LiliError } from '../errors/error.js'

export const AUTH_CODES = {
  MISSING: 'AUTH_MISSING',
  CI_TOKEN_MISSING: 'AUTH_CI_TOKEN_MISSING',
  INVALID: 'AUTH_INVALID',
  EXPIRED: 'AUTH_EXPIRED',
  CONTEXT_REQUIRED: 'AUTH_CONTEXT_REQUIRED',
  SCOPE_MISSING: 'AUTH_SCOPE_MISSING',
  PERMISSION_DENIED: 'AUTH_PERMISSION_DENIED',
  INTERACTIVE_REQUIRED: 'AUTH_INTERACTIVE_REQUIRED',
  TOKEN_SOURCE_UNAVAILABLE: 'AUTH_TOKEN_SOURCE_UNAVAILABLE',
  SESSION_CORRUPT: 'AUTH_SESSION_CORRUPT',
  SESSION_LOCKED: 'AUTH_SESSION_LOCKED',
} as const

export type AuthErrorCode = (typeof AUTH_CODES)[keyof typeof AUTH_CODES]

export type AuthErrorDetails = {
  providerId?: string | undefined
  envVars?: string[] | undefined
  loginCommand?: string | undefined
  requiredContexts?: { id: string; envVar?: string | undefined; flag?: string | undefined }[] | undefined
  requiredPermissions?: string[] | undefined
  missingScopes?: string[] | undefined
  profile?: string | undefined
  status?: number | undefined
}

function authError(code: AuthErrorCode, message: string, details?: AuthErrorDetails, hint?: string): LiliError {
  return new LiliError({ code, message, hint, details, exitCode: 1 })
}

export function authMissing(input: {
  providerId: string
  envVars: string[]
  loginCommand?: string | undefined
  requiredPermissions?: string[] | undefined
}): LiliError {
  const remedies: string[] = []
  if (input.loginCommand) remedies.push(`run \`${input.loginCommand}\``)
  if (input.envVars.length > 0) remedies.push(`set ${input.envVars.join(' or ')}`)
  const message =
    remedies.length > 0
      ? `Authentication required: ${remedies.join(' or ')}.`
      : 'Authentication required.'
  return authError(AUTH_CODES.MISSING, message, {
    providerId: input.providerId,
    envVars: input.envVars,
    loginCommand: input.loginCommand,
    requiredPermissions: input.requiredPermissions,
  })
}

export function authCiTokenMissing(input: { providerId: string; envVars: string[] }): LiliError {
  const message =
    input.envVars.length > 0
      ? `CI token required. Set ${input.envVars.join(' or ')}.`
      : 'CI token required.'
  return authError(AUTH_CODES.CI_TOKEN_MISSING, message, {
    providerId: input.providerId,
    envVars: input.envVars,
  })
}

export function authContextRequired(input: {
  providerId: string
  contexts: { id: string; envVar?: string | undefined; flag?: string | undefined }[]
}): LiliError {
  const ids = input.contexts.map((c) => c.id).join(', ')
  const message = `Required context missing: ${ids}.`
  return authError(AUTH_CODES.CONTEXT_REQUIRED, message, {
    providerId: input.providerId,
    requiredContexts: input.contexts,
  })
}

export function authScopeMissing(input: {
  providerId: string
  missingScopes: string[]
  requiredPermissions?: string[] | undefined
}): LiliError {
  const message = `Credential is missing required scopes: ${input.missingScopes.join(', ')}.`
  return authError(AUTH_CODES.SCOPE_MISSING, message, {
    providerId: input.providerId,
    missingScopes: input.missingScopes,
    requiredPermissions: input.requiredPermissions,
  })
}

export function authPermissionDenied(input: {
  providerId: string
  requiredPermissions?: string[] | undefined
  status?: number | undefined
}): LiliError {
  return authError(AUTH_CODES.PERMISSION_DENIED, 'Permission denied.', {
    providerId: input.providerId,
    requiredPermissions: input.requiredPermissions,
    status: input.status ?? 403,
  })
}

export function authInvalid(input: { providerId: string; status?: number | undefined }): LiliError {
  return authError(AUTH_CODES.INVALID, 'Authentication rejected by server.', {
    providerId: input.providerId,
    status: input.status ?? 401,
  })
}

export function authExpired(input: { providerId: string; loginCommand?: string | undefined }): LiliError {
  return authError(AUTH_CODES.EXPIRED, 'Authentication expired.', {
    providerId: input.providerId,
    loginCommand: input.loginCommand,
  })
}

export function authInteractiveRequired(input: { providerId: string; loginCommand?: string | undefined }): LiliError {
  return authError(AUTH_CODES.INTERACTIVE_REQUIRED, 'Interactive login is required for this command.', {
    providerId: input.providerId,
    loginCommand: input.loginCommand,
  })
}

export function authSessionCorrupt(input: { providerId?: string; profile?: string }): LiliError {
  return authError(AUTH_CODES.SESSION_CORRUPT, 'Stored auth session is corrupt.', {
    providerId: input.providerId,
    profile: input.profile,
  })
}

export function authSessionLocked(input: { providerId?: string; profile?: string }): LiliError {
  return authError(AUTH_CODES.SESSION_LOCKED, 'Stored auth session is locked by another process.', {
    providerId: input.providerId,
    profile: input.profile,
  })
}
