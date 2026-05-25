import { sha256Hex } from './crypto.js'
import { readBytes } from './fs-bytes.js'

export type VerifyExpect = { sha256: string; size: number }

export type VerifyBytesResult =
  | { ok: true; bytes: Uint8Array; sha256: string; size: number }
  | { ok: false; kind: 'read' }
  | { ok: false; kind: 'size'; size: number }
  | { ok: false; kind: 'sha256'; sha256: string; size: number }

export async function verifyBytesAt(path: string, expect: VerifyExpect): Promise<VerifyBytesResult> {
  const bytes = await readBytes(path)
  if (!bytes) return { ok: false, kind: 'read' }
  const size = bytes.byteLength
  if (size !== expect.size) return { ok: false, kind: 'size', size }
  const sha256 = sha256Hex(bytes)
  if (sha256 !== expect.sha256) return { ok: false, kind: 'sha256', sha256, size }
  return { ok: true, bytes, sha256, size }
}
