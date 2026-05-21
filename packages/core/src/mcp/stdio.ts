import type { CliState, ServeOptions } from '../types.js'
import { mcpMessage, mcpParseError } from './protocol.js'

export async function serveMcp(binaryName: string, state: CliState, options: ServeOptions = {}): Promise<void> {
  const out = options.stdout ?? ((s: string) => void Bun.stdout.write(s))
  const stdin = (options.stdin ?? Bun.stdin.stream()) as AsyncIterable<string | Uint8Array>
  const decoder = new TextDecoder()
  let buffer = ''

  async function emit(line: string) {
    if (!line.trim()) return
    try {
      const response = await mcpMessage(binaryName, state, JSON.parse(line))
      if (response) out(`${JSON.stringify(response)}\n`)
    } catch {
      out(`${JSON.stringify(mcpParseError())}\n`)
    }
  }

  for await (const chunk of stdin) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) await emit(line)
  }
  if (buffer) await emit(buffer)
}
