# HTTP operation transport

`@liche/http` owns outbound HTTP operation transport (it depends on `@liche/core`, never the reverse). Handwritten CLIs and generated CLIs use the same primitives. Generated Product command wiring and server conformance build on top of it.

## NDJSON streaming for async generators

When a command's `run()` is an async generator and the client requests `Accept: application/x-ndjson`, the response is `Content-Type: application/x-ndjson`. Each yield becomes a JSON line of the form `{"type":"chunk","data":<value>}`. After the iterator completes, a final compact-JSON line containing the result envelope (`{ok, data, error, meta}`) is appended. CLI mode emits one stdout line per yield, formatted in the chosen output format (jsonl wraps each chunk in the same `{type,data}` envelope).

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

Failures throw structured core errors that the command execution path maps into the standard result/error envelope. The transport never returns `TOutput` for success and `{ ok: false }` for failure.

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
  | {
      kind: "resolved";
      headers: Record<string, string>;
      secrets?: readonly string[];
      statusErrors?: { 401?: CommandError; 403?: CommandError };
    };

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
  };
```

`inputFields` is optional because handwritten callers can rely on their own schema discipline. Generated callers pass it so dead or typoed bind entries fail before network work with `REMOTE_BIND_UNKNOWN_FIELD`.

Generated Product callers support literal, env-backed, and config-backed remote base URL sources. Config-backed values use the config provider from [config-primitive.md](./config-primitive.md) and are resolved before transport through `ctx.sources.value("config", ...)` plus `ctx.sources.source("config", ...)`.

Env-backed `bearer` and `apiKey` auth are supported for handwritten CLIs. Auth/session-aware generated CLIs resolve credentials before transport and pass `{ kind: "resolved", headers, secrets, statusErrors }` from `@liche/auth` so `callHttpOperation` only applies headers, redacts declared secrets, and reports HTTP failures. See [auth-session.md](./auth-session.md).

There is no retry. The default is no retry; the API does not preclude adding it later.

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

For env-backed transport auth, missing env is a remote config error. For auth/session-aware generated CLIs, `resolveAuth` fails before transport with an `AUTH_*` structured error such as `AUTH_MISSING` or `AUTH_CI_TOKEN_MISSING`.

Auth is product-level. Per-capability provider selection is not supported.

Secret values do not flow through CLI flags such as `--auth-env NAME=VALUE`. Conformance and runtime read inherited environment or explicit env files/target config.

When resolved auth is present, the caller provides headers and redaction secrets. Generated code does not pass raw token strings directly to transport.

Generated Product commands call this transport only when the catalog declares a product-level remote base URL source. Without that declaration, Product linting reports `catalog/remote-required` and CLI generation fails. Generated callers pass a resolved base URL sourced from a literal, env var, or declared config field while keeping auth/session resolution separate.

## Timeout

Default timeout:

```txt
timeoutMs = 30000
```

Timeout failure code:

```txt
REMOTE_TIMEOUT
```

Timeouts are marked retryable in error metadata. No automatic retry happens.

## Response parsing

Success status:

- `2xx` is success
- `204`, `205`, or empty body parses as `null`

JSON:

- parse `application/json`
- parse missing content-type only when body looks like JSON

Unsupported success body:

- non-JSON success body fails with `REMOTE_RESPONSE_UNSUPPORTED_CONTENT_TYPE`

Validation:

- parsed data is validated with `output.parse(data)`
- Zod errors are normalized into structured core errors

Raw `fetch`, `AbortError`, `JSON.parse`, and Zod errors never leak through command output.

## Error codes

Codes:

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
| 401 with auth present | `AUTH_INVALID` or `AUTH_EXPIRED` when expiry is known. Not every 401 is expiry. |
| 403 with auth present | `AUTH_PERMISSION_DENIED` when the capability declared permissions; otherwise `REMOTE_HTTP_STATUS`. |
| 401/403 without auth requirement | `REMOTE_HTTP_STATUS`. |

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

`bodyPreview` is capped and sanitized. Default cap: 4096 bytes.

Auth header values and secret env values do not appear in error details or conformance reports.

## Handwritten CLI example

```ts
import { defineCli, defineCommand, z } from "@liche/core";
import { callHttpOperation } from "@liche/http";

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
    const remoteBaseUrl = ctx.sources.value("config", "apiBaseUrl");
    if (typeof remoteBaseUrl !== "string" || remoteBaseUrl.length === 0) {
      return ctx.error({
        code: "REMOTE_CONFIG_MISSING_BASE_URL",
        message: "Remote base URL is required.",
      });
    }
    const remoteBaseUrlSource = ctx.sources.source("config", "apiBaseUrl").kind === "default" ? "schema-default" : "config";
    const data = await callHttpOperation({
      id: "users.list",
      baseUrl: remoteBaseUrl,
      auth: { kind: "none" },
      method: "GET",
      path: "/users",
      bind: { query: ["limit"] },
      input: ctx.options,
      output: usersList.output,
      env: ctx.env,
    });
    return ctx.ok(data, { execution: { mode: "remote-http", source: remoteBaseUrlSource } });
  },
});
```

Auth/session-aware generated CLIs resolve credentials before this call (see [auth-session.md](./auth-session.md)). The example above is the config-backed transport path.
