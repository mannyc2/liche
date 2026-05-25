import { applyAuth } from '../auth/resolve.js'
import { remoteError } from './errors.js'
import type { HttpAuth } from './types.js'

export function applyTransportAuth(
  headers: Headers,
  auth: HttpAuth,
  env: Record<string, string | undefined>,
  operationId: string | undefined,
  secrets: string[],
): void {
  if (auth.kind === 'none') return
  if (auth.kind === 'resolved') {
    const secret = auth.credential.secret.reveal()
    secrets.push(secret)
    applyAuth(headers, auth.credential)
    return
  }
  const value = env[auth.envVar]
  if (!value) {
    throw remoteError('REMOTE_CONFIG_MISSING_AUTH', 'Remote auth environment variable is not set.', {
      operationId,
    }, { envVar: auth.envVar })
  }
  secrets.push(value)
  if (auth.kind === 'bearer') {
    headers.set('authorization', `Bearer ${value}`)
    return
  }
  headers.set(auth.header, value)
}

export function collectAuthSecrets(
  auth: HttpAuth | undefined,
  env: Record<string, string | undefined>,
  secrets: string[],
): void {
  if (!auth || auth.kind === 'none') return
  if (auth.kind === 'resolved') {
    secrets.push(auth.credential.secret.reveal())
    return
  }
  const value = env[auth.envVar]
  if (value) secrets.push(value)
}
