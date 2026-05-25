import { createHash } from 'node:crypto'

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export function sha256Base64Url(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('base64url')
}
