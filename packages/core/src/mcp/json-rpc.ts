export function validateJsonRpc(message: any):
  | { ok: true; id: string | number; notification: false }
  | { ok: true; notification: true }
  | { ok: false; response: ReturnType<typeof jsonRpcError> } {
  if (!isRecord(message)) return { ok: false, response: jsonRpcError(undefined, -32600, 'Invalid Request') }
  const id = validRequestId(message['id']) ? message['id'] : undefined

  if (message['jsonrpc'] !== '2.0') return { ok: false, response: jsonRpcError(id, -32600, 'Invalid Request') }
  if (typeof message['method'] !== 'string') return { ok: false, response: jsonRpcError(id, -32600, 'Invalid Request') }

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return { ok: true, notification: true }
  if (!validRequestId(message['id'])) return { ok: false, response: jsonRpcError(undefined, -32600, 'Invalid Request') }
  return { ok: true, id: message['id'], notification: false }
}

export function jsonRpcError(id: string | number | undefined, code: number, message: string) {
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? undefined : { id }),
    error: { code, message },
  }
}

export function mcpParseError() {
  return jsonRpcError(undefined, -32700, 'Parse error')
}

export function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validRequestId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))
}
