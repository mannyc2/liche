import type { HttpAuth } from '@liche/http'
import { authInvalid, authPermissionDenied } from './errors.js'
import type { AuthCredential } from './types.js'

export function applyAuth(headers: Headers, credential: AuthCredential): void {
  const raw = credential.secret.reveal()
  if (credential.kind === 'bearer') {
    headers.set(credential.header ?? 'Authorization', `Bearer ${raw}`)
    return
  }
  headers.set(credential.header ?? 'x-api-key', raw)
}

export function credentialHttpAuth(
  credential: AuthCredential,
  input: { requiredPermissions?: readonly string[] | undefined } = {},
): HttpAuth {
  const headers = new Headers()
  applyAuth(headers, credential)
  const requiredPermissions = input.requiredPermissions ? [...input.requiredPermissions] : []
  return {
    kind: 'resolved',
    headers: Object.fromEntries(headers.entries()),
    secrets: [credential.secret.reveal()],
    statusErrors: {
      401: authInvalid({ providerId: credential.providerId, status: 401 }),
      ...(requiredPermissions.length > 0
        ? {
            403: authPermissionDenied({
              providerId: credential.providerId,
              requiredPermissions,
              status: 403,
            }),
          }
        : undefined),
    },
  }
}
