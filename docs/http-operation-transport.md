# HTTP operation transport requirements

`@lili/core` owns outbound HTTP operation transport. Both handwritten CLIs and generated CLIs use the same primitives.

## NDJSON streaming for async generators

When a command's `run()` is an async generator and the client requests `Accept: application/x-ndjson`, the response is `Content-Type: application/x-ndjson`. Each yield becomes a JSON line of the form `{"type":"chunk","data":<value>}`. After the iterator completes, a final compact-JSON line containing the result envelope (`{ok, data, meta}`) is appended. CLI mode emits one stdout line per yield, formatted in the chosen output format (jsonl wraps each chunk in the same `{type,data}` envelope).

Behavior IDs: `STREAM-001`.

The first landed slice is the core serializer plus network transport. Generated Product command wiring and server conformance still build on top of it.

## Public primitives

API:

```ts
export function serializeHttpOperationRequest<TInput>(
  options: HttpOperationRequestSpec<TInput>,
): SerializedHttpRequest;

export async function callHttpOperation<TInput, TOutput>(
  options: HttpOperationCall<TInput, TOutput>,
): Promise<TOutput>;
```

`callHttpOperation` returns parsed output on success.

Failures must throw structured core errors that the existing command execution path can map into the standard result/error envelope. Do not make the transport sometimes return `TOutput` and sometimes return `{ ok: false }`.

## Types

```ts
import type { z } from "zod";

export type RuntimeValue =
  | { envVar: string; literal?: string }
  | { envVar?: string; literal: string };

export type HttpAuth =
  | { kind: "none" }
  | { kind: "bearer"; envVar: string }
  | { kind: "apiKey"; envVar: string; header: string }
  | { kind: "resolved"; credential: AuthCredential };

export type HttpOperationBind<TInput = Record<string, unknown>> = {
  path?: Array<keyof TInput & string>;
  query?: Array<keyof TInput & string>;
  headers?: Record<string, keyof TInput & string>;
  body?: true | Array<keyof TInput & string>;
};

export type HttpOperationRequestSpec<TInput> = {
  id?: string;
  baseUrl: RuntimeValue | string;
  auth?: HttpAuth;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bind: HttpOperationBind<TInput>;
  input: TInput;
  inputFields?: Array<keyof TInput & string>;
  env?: Record<string, string | undefined>;
};

export type SerializedHttpRequest = {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
};

export type HttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HttpOperationCall<TInput, TOutput> =
  HttpOperationRequestSpec<TInput> & {
    output: z.ZodType<TOutput>;
    fetch?: HttpFetch;
    timeoutMs?: number;
    safeBodyBytes?: number;
    requiredPermissions?: string[];
  };
```

`inputFields` is optional because handwritten callers can rely on their own schema discipline. Generated callers should pass it so dead or typoed bind entries fail before network work with `REMOTE_BIND_UNKNOWN_FIELD`.

The first landed transport slice intentionally excludes config-backed runtime values and supports `env` and `literal`. Config-backed values are the next generated-wiring slice and must use the first-class config primitive from `docs/config-primitive.md`, not an ad hoc loader lookup.

Env-backed `bearer` and `apiKey` auth remain supported for handwritten CLIs and the first generated auth slice. Auth/session-aware generated CLIs should resolve credentials before transport and pass `{ kind: "resolved", credential }` so `callHttpOperation` only applies headers and reports HTTP failures. See `docs/auth-session.md`.

Retry policy is also not part of the first transport slice. The default is no retry. The API should not preclude retries later, but initial behavior should prove serialization, fetch, timeout, parsing, validation, and structured errors first.

## Request serialization

`bind.path`:

- replaces `{field}` segments in `path`
- missing values fail before network work
- values are URL path encoded

`bind.query`:

- adds URL search params
- arrays repeat the key
- `undefined` is omitted
- `false`, `0`, and empty strings are preserved
- `null` fails unless explicit nullable serialization is added later

`bind.headers`:

- maps header name to input field name
- values must serialize to scalar string, number, or boolean
- `undefined` headers are omitted
- authorization, accept, and content-type policy should come from transport/auth/media type, not arbitrary input unless explicitly allowed

`bind.body: true`:

- JSON body is all input fields not already bound to path/query/header

`bind.body: string[]`:

- JSON body is only those fields

No body:

- `GET` and `DELETE` default to no body
- `POST`, `PUT`, and `PATCH` require `body` unless input is empty

Binding conflicts fail before network work unless a later explicit rule allows duplicate placement.

## Runtime config and auth

Resolve base URL and auth before network work.

Required failures:

| Case | Code |
|---|---|
| base URL env missing | `REMOTE_CONFIG_MISSING_BASE_URL` |
| base URL invalid | `REMOTE_CONFIG_INVALID_BASE_URL` |
| auth env missing | `REMOTE_CONFIG_MISSING_AUTH` |

For env-backed transport auth, missing env remains a remote config error. For auth/session-aware generated CLIs, `resolveAuth` should fail before transport with an `AUTH_*` structured error such as `AUTH_MISSING` or `AUTH_CI_TOKEN_MISSING`.

Auth is product-level for MVP. Per-capability provider selection remains a non-goal until a concrete use case requires it.

Do not pass secret values through CLI flags such as `--auth-env NAME=VALUE`. Conformance and runtime should read inherited environment or explicit env files/target config with clear handling.

When a resolved credential is present, `applyAuth` mutates headers. Generated code must not pass raw token strings to transport.

Generated Product commands call this transport only when the catalog declares a product-level remote base URL source. Without that declaration, generated `remote-http` and resource-operation commands keep returning the explicit `REMOTE_NOT_IMPLEMENTED` Phase 4 stub rather than inventing an implicit base URL rule. When a remote base URL is declared, generated callers pass a resolved base URL sourced from a literal, env var, or declared config field while keeping auth/session resolution separate.

## Timeout

Default timeout:

```txt
timeoutMs = 30000
```

Timeout failure code:

```txt
REMOTE_TIMEOUT
```

Timeouts should be marked retryable in error metadata, but no retry should occur unless a future retry policy explicitly opts in.

## Response parsing

Success status:

- `2xx` is success
- `204`, `205`, or empty body parses as `null`

JSON:

- parse `application/json`
- parse missing content-type only when body looks like JSON

Unsupported success body:

- non-JSON success body fails with `REMOTE_RESPONSE_UNSUPPORTED_CONTENT_TYPE` unless the operation explicitly allows text in a later extension

Validation:

- validate parsed data with `output.parse(data)`
- Zod errors must be normalized into structured core errors

No raw `fetch`, `AbortError`, `JSON.parse`, or Zod errors may leak through command output.

## Error codes

Required codes:

```txt
REMOTE_CONFIG_MISSING_BASE_URL
REMOTE_CONFIG_INVALID_BASE_URL
REMOTE_CONFIG_MISSING_AUTH
REMOTE_BIND_MISSING_PATH_PARAM
REMOTE_BIND_UNKNOWN_FIELD
REMOTE_BIND_CONFLICT
REMOTE_REQUEST_SERIALIZATION
REMOTE_TIMEOUT
REMOTE_NETWORK
REMOTE_HTTP_STATUS
REMOTE_RESPONSE_UNSUPPORTED_CONTENT_TYPE
REMOTE_RESPONSE_MALFORMED
REMOTE_RESPONSE_SCHEMA
```

HTTP status handling with auth:

| Status | Mapping |
|---|---|
| 401 with auth present | `AUTH_INVALID` or `AUTH_EXPIRED` when expiry is known; do not assume all 401s are expiry. |
| 403 with auth present | `AUTH_PERMISSION_DENIED` when the capability declared permissions; otherwise `REMOTE_HTTP_STATUS`. |
| 401/403 without auth requirement | `REMOTE_HTTP_STATUS`. |

Future retry support may add:

```txt
REMOTE_RETRY_EXHAUSTED
```

## Error details

Structured details should support:

```ts
type RemoteErrorDetails = {
  operationId?: string;
  method?: string;
  url?: string;
  status?: number;
  statusText?: string;
  requestId?: string;
  bodyPreview?: string;
  validation?: Array<{ path: string; message: string }>;
};
```

`bodyPreview` must be capped and sanitized. Default cap: 4096 bytes.

Do not include auth header values or secret env values in error details or conformance reports.

## Handwritten CLI example

```ts
import { callHttpOperation, defineCli, defineCommand, z } from "@lili/core";

const input = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const output = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
    }),
  ),
});

export const cli = defineCli({
  name: "acme",
  commands: [
    defineCommand({
      path: ["users", "list"],
      input: { options: input },
      output,
      safety: {
        auth: "required",
        destructive: false,
        idempotent: true,
        interactive: "never",
        openWorld: true,
        readOnly: true,
      },
      async run({ ctx }) {
        return await callHttpOperation({
          id: "users.list",
          baseUrl: { envVar: "ACME_API_URL" },
          auth: { kind: "bearer", envVar: "ACME_TOKEN" },
          method: "GET",
          path: "/users",
          bind: { query: ["limit"] },
          input: ctx.options,
          output,
          env: ctx.env,
        });
      },
    }),
  ],
});
```

## Generated CLI example

```ts
defineCommand({
  path: ["users", "list"],
  summary: "List users",
  input: { options: usersList.input },
  output: usersList.output,
  async run({ ctx }) {
    const data = await callHttpOperation({
      id: "users.list",
      baseUrl: contract.remote.baseUrl,
      auth: contract.remote.auth,
      method: "GET",
      path: "/users",
      bind: { query: ["limit"] },
      input: ctx.options,
      output: usersList.output,
      env: ctx.env,
    });
    return ctx.ok(data, { execution: { mode: "remote-http", source: "schema-default" } });
  },
});
```

Auth/session-aware generated CLIs resolve credentials before this call, as shown in `docs/auth-session.md`. The example above is the env-backed transport path.

## Tests

Required tests:

- serialize path/query/header/body correctly
- preserve `false`, `0`, and empty strings
- arrays repeat query params
- missing base URL becomes `REMOTE_CONFIG_MISSING_BASE_URL`
- invalid base URL becomes `REMOTE_CONFIG_INVALID_BASE_URL`
- missing env-backed transport auth becomes `REMOTE_CONFIG_MISSING_AUTH`; auth/session-aware generated CLIs fail earlier with `AUTH_*`
- missing/unknown/conflicting bind fields fail before network
- network failure becomes `REMOTE_NETWORK`
- timeout becomes `REMOTE_TIMEOUT`
- non-2xx becomes `REMOTE_HTTP_STATUS` with safe body preview
- bad JSON becomes `REMOTE_RESPONSE_MALFORMED`
- output mismatch becomes `REMOTE_RESPONSE_SCHEMA`
- raw platform/library errors never appear in result text
