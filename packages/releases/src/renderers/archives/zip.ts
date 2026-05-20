export type ZipEntry = {
  path: string
  data: Uint8Array | string
}

function bytes(data: Uint8Array | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
}

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  crcTable = table
  return table
}

function crc32(data: Buffer): number {
  const table = getCrcTable()
  let c = 0xffffffff
  for (const byte of data) {
    c = table[(c ^ byte) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(): { time: number; date: number } {
  // 1980-01-01 00:00:00, the earliest DOS timestamp ZIP accepts.
  return { time: 0, date: (0 << 9) | (1 << 5) | 1 }
}

function localZipHeader(name: Buffer, data: Buffer, crc: number): Buffer {
  const { time, date } = dosTime()
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(data.byteLength, 18)
  header.writeUInt32LE(data.byteLength, 22)
  header.writeUInt16LE(name.byteLength, 26)
  header.writeUInt16LE(0, 28)
  return Buffer.concat([header, name])
}

function centralZipHeader(name: Buffer, data: Buffer, crc: number, offset: number): Buffer {
  const { time, date } = dosTime()
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(data.byteLength, 20)
  header.writeUInt32LE(data.byteLength, 24)
  header.writeUInt16LE(name.byteLength, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(offset, 42)
  return Buffer.concat([header, name])
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50, 0)
  footer.writeUInt16LE(0, 4)
  footer.writeUInt16LE(0, 6)
  footer.writeUInt16LE(entryCount, 8)
  footer.writeUInt16LE(entryCount, 10)
  footer.writeUInt32LE(centralSize, 12)
  footer.writeUInt32LE(centralOffset, 16)
  footer.writeUInt16LE(0, 20)
  return footer
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path)
    const data = bytes(entry.data)
    const crc = crc32(data)
    const local = localZipHeader(name, data, crc)
    localChunks.push(local, data)
    centralChunks.push(centralZipHeader(name, data, crc, offset))
    offset += local.byteLength + data.byteLength
  }

  const central = Buffer.concat(centralChunks)
  const footer = endOfCentralDirectory(entries.length, central.byteLength, offset)
  return Buffer.concat([...localChunks, central, footer])
}

export function readZipEntries(archive: Uint8Array): Map<string, Uint8Array> {
  const zip = Buffer.from(archive)
  const entries = new Map<string, Uint8Array>()
  let offset = 0
  while (offset + 30 <= zip.byteLength && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8)
    if (method !== 0) throw new Error(`unsupported zip compression method ${method}`)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const fileNameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + fileNameLength + extraLength
    const dataEnd = dataStart + compressedSize
    const name = zip.subarray(nameStart, nameStart + fileNameLength).toString('utf8')
    entries.set(name, new Uint8Array(zip.subarray(dataStart, dataEnd)))
    offset = dataEnd
  }
  return entries
}
