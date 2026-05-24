import { LicheError } from '../errors/error.js'

export const AUTH_CODES = {
  INVALID: 'AUTH_INVALID',
  PERMISSION_DENIED: 'AUTH_PERMISSION_DENIED',
} as const

export type AuthErrorCode = (typeof AUTH_CODES)[keyof typeof AUTH_CODES]

export type AuthErrorDetails = {
  providerId?: string | undefined
  requiredPermissions?: string[] | undefined
  status?: number | undefined
}

function authError(
  code: AuthErrorCode,
  message: string,
  details?: AuthErrorDetails,
  recovery: Pick<LicheError.Options, 'code_actions' | 'hint' | 'suggested_fix'> = {},
): LicheError {
  return new LicheError({ code, message, details, exitCode: 1, ...recovery })
}

export function authPermissionDenied(input: {
  providerId: string
  requiredPermissions?: string[] | undefined
  status?: number | undefined
}): LicheError {
  return authError(AUTH_CODES.PERMISSION_DENIED, 'Permission denied.', {
    providerId: input.providerId,
    requiredPermissions: input.requiredPermissions,
    status: input.status ?? 403,
  }, {
    suggested_fix: input.requiredPermissions && input.requiredPermissions.length > 0
      ? `Use credentials with these permissions: ${input.requiredPermissions.join(', ')}.`
      : 'Use credentials with permission to perform this action.',
  })
}

export function authInvalid(input: { providerId: string; status?: number | undefined }): LicheError {
  return authError(AUTH_CODES.INVALID, 'Authentication rejected by server.', {
    providerId: input.providerId,
    status: input.status ?? 401,
  }, {
    suggested_fix: 'Refresh or replace the current credential before retrying.',
  })
}
