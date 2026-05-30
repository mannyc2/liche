import { gunzipSync, gzipSync } from 'node:zlib'

export type TarEntry = {
  path: string
  data: Uint8Array | string
  mode?: number
}

function bytes(data: Uint8Array | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
}

function tarOctal(value: number, length: number): string {
  const digits = value.toString(8)
  return `${digits.padStart(length - 1, '0')}\0`
}

function assertTarPath(path: string): void {
  if (Buffer.byteLength(path) > 100) {
    throw new Error(`tar path '${path}' is longer than the supported ustar name field`)
  }
}

function tarHeader(entry: TarEntry, data: Buffer): Buffer {
  assertTarPath(entry.path)
  const header = Buffer.alloc(512)
  const mode = entry.mode ?? 0o644
  header.write(entry.path, 0, 100)
  header.write(tarOctal(mode, 8), 100, 8)
  header.write(tarOctal(0, 8), 108, 8)
  header.write(tarOctal(0, 8), 116, 8)
  header.write(tarOctal(data.byteLength, 12), 124, 12)
  header.write(tarOctal(0, 12), 136, 12)
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1)
  header.write('ustar\0', 257, 6)
  header.write('00', 263, 2)

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(tarOctal(checksum, 8), 148, 8)
  return header
}

function tarPadding(size: number): Buffer {
  const remainder = size % 512
  if (remainder === 0) return Buffer.alloc(0)
  return Buffer.alloc(512 - remainder)
}

export function createTarGz(entries: readonly TarEntry[]): Uint8Array {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const data = bytes(entry.data)
    chunks.push(tarHeader(entry, data), data, tarPadding(data.byteLength))
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks), { level: 9 })
}

function parseTarSize(raw: Buffer): number {
  const text = raw.toString('utf8').replace(/\0.*$/, '').trim()
  if (!text) return 0
  return Number.parseInt(text, 8)
}

export function readTarGzEntries(archive: Uint8Array): Map<string, Uint8Array> {
  const tar = gunzipSync(Buffer.from(archive))
  const entries = new Map<string, Uint8Array>()
  let offset = 0
  while (offset + 512 <= tar.byteLength) {
    const name = tar
      .subarray(offset, offset + 100)
      .toString('utf8')
      .replace(/\0.*$/, '')
    if (!name) break
    const size = parseTarSize(tar.subarray(offset + 124, offset + 136))
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    entries.set(name, new Uint8Array(tar.subarray(dataStart, dataEnd)))
    offset = dataStart + size + tarPadding(size).byteLength
  }
  return entries
}
