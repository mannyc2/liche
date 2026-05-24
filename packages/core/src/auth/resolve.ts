import type { AuthCredential } from './types.js'

export function applyAuth(headers: Headers, credential: AuthCredential): void {
  const raw = credential.secret.reveal()
  if (credential.kind === 'bearer') {
    headers.set(credential.header ?? 'Authorization', `Bearer ${raw}`)
    return
  }
  headers.set(credential.header ?? 'x-api-key', raw)
}
