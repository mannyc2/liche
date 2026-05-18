import type { CliState } from '../types.js'
import { mcpMessage } from './protocol.js'

export async function handleMcpHttp(binaryName: string, state: CliState, request: Request): Promise<Response> {
  return Response.json(await mcpMessage(binaryName, state, await request.json()))
}
