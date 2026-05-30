import type { CommandError, Schema } from '../types.js'

export type RuntimeValue =
  | { envVar: string; literal?: string | undefined }
  | { envVar?: string | undefined; literal: string }

export type HttpAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; envVar: string }
  | { kind: 'apiKey'; envVar: string; header: string }
  | {
      kind: 'resolved'
      headers: Record<string, string>
      secrets?: readonly string[] | undefined
      statusErrors?: { 401?: CommandError | undefined; 403?: CommandError | undefined } | undefined
    }

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type HttpOperationBind<TInput = Record<string, unknown>> = {
  path?: Array<keyof TInput & string> | undefined
  query?: Array<keyof TInput & string> | undefined
  headers?: Record<string, keyof TInput & string> | undefined
  body?: true | Array<keyof TInput & string> | false | undefined
}

export type HttpOperationRequestSpec<TInput = Record<string, unknown>> = {
  id?: string | undefined
  baseUrl: RuntimeValue | string
  auth?: HttpAuth | undefined
  method: HttpMethod
  path: string
  bind: HttpOperationBind<TInput>
  input: TInput
  inputFields?: readonly (keyof TInput & string)[] | undefined
  env?: Record<string, string | undefined> | undefined
}

export type SerializedHttpRequest = {
  url: string
  method: string
  headers: Headers
  body?: string | undefined
}

export type HttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type HttpOperationCall<
  TInput = Record<string, unknown>,
  TOutput = unknown,
> = HttpOperationRequestSpec<TInput> & {
  output: Schema<TOutput>
  fetch?: HttpFetch | undefined
  timeoutMs?: number | undefined
  safeBodyBytes?: number | undefined
}

export type RemoteErrorDetails = {
  operationId?: string | undefined
  method?: string | undefined
  url?: string | undefined
  status?: number | undefined
  statusText?: string | undefined
  requestId?: string | undefined
  bodyPreview?: string | undefined
  validation?: Array<{ path: string; message: string }> | undefined
}
