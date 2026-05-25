import type { CliState } from '../types.js'
import { mcpParseError } from './json-rpc.js'
import { mcpMessage } from './protocol.js'

export async function handleMcpHttp(binaryName: string, state: CliState, request: Request): Promise<Response> {
  try {
    const response = await mcpMessage(binaryName, state, await request.json())
    return response ? Response.json(response) : new Response(null, { status: 202 })
  } catch {
    return Response.json(mcpParseError(), { status: 400 })
  }
}
