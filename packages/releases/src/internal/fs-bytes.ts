// readBytes returns null on any read failure (including missing files); callers
// translate null into their own typed failure. readBinary throws — used by
// renderers that have already verified the file exists.

export async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

export async function readBinary(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).arrayBuffer())
}
