# Server conformance requirements

`@lili/product` owns server conformance.

Conformance verifies that an owned external HTTP deployment implements HTTP-backed product schema capabilities. It is separate from generated-file drift checks.

## Command contract

```sh
li-product conform ./lili.schema.ts \
  --base-url http://localhost:5173 \
  --report .lili/conformance.json
```

Options:

```txt
--base-url <url>
--env <name>
--capability <glob>
--fixture <path>
--report <path>
--format json|toon
--include-destructive
--require-all
--fail-on-skip
--timeout-ms <number>
--concurrency <number>
```

Do not add an option that passes secret values directly on the command line. Use inherited env, env files, or named targets.

## Separation from drift check

```txt
li-product generate --check
  Hermetic generated-file freshness and provenance check.
  Does not need a server.

li-product conform
  Live or fixture server-vs-schema verification.
  Needs a base URL or target.
```

These commands must stay separate.

## Conformance cases

Schema examples are enough for read-only capabilities.

Explicit fixture files are required for destructive or confirmation-required capabilities.

```ts
export type ConformanceCase = {
  name: string;
  capability: string;

  argv: string[];
  input: unknown;

  target?: {
    baseUrl?: string;
    headers?: Record<string, string>;
  };

  expectRequest?: {
    method: string;
    path: string;
    query?: Record<string, string | string[]>;
    headers?: Record<string, string>;
    body?: unknown;
  };

  expectResponse?: {
    status?: number;
    body?: unknown;
  };

  safety?: {
    destructive: boolean;
    requiresOptIn: boolean;
    setup?: string;
    teardown?: string;
  };
};
```

Fixture example:

```ts
import type { ConformanceCase } from "@lili/product";

export default [
  {
    name: "projects.list read-only",
    capability: "projects.list",
    argv: ["projects", "list", "--limit", "2", "--json"],
    input: { limit: 2 },
    expectRequest: {
      method: "GET",
      path: "/api/projects",
      query: { limit: "2" },
    },
  },
] satisfies ConformanceCase[];
```

## What gets checked

For every case:

1. Parse `argv` through the generated command parser.
2. Validate parsed input with the capability input schema.
3. Assert parsed input equals fixture input.
4. Serialize HTTP request through the core pure serializer.
5. Assert request method/path/query/header/body matches `expectRequest`, if provided.
6. Apply base URL and auth.
7. Send request.
8. Parse response.
9. Validate response with output schema.
10. Record structured pass/fail/skip.

Conformance must use the same serializer as `callHttpOperation`.

## Destructive capability safety

Default behavior:

| Capability | Default |
|---|---|
| `idempotent: true`, `destructive: false` | May run when example exists. |
| `destructive: true` | Skip unless explicit fixture and `--include-destructive`. |
| `requiresConfirmation: true` | Skip unless explicit fixture and `--include-destructive`. |
| No example/fixture | Skip with reason, never pass silently. |
| Missing auth/baseUrl | Fail as configuration error. |

A destructive fixture must name the target. No destructive capability runs against a generic `--base-url` by accident.

## Report schema

```ts
export const ConformanceReport = z.object({
  reportVersion: z.literal(1),

  catalog: z.object({
    name: z.string(),
    version: z.string(),
    contractDigest: z.string(),
  }),

  target: z.object({
    baseUrl: z.string(),
    env: z.string().optional(),
  }),

  run: z.object({
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number(),
  }),

  summary: z.object({
    passed: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    total: z.number().int(),
  }),

  cases: z.array(
    z.object({
      capability: z.string(),
      name: z.string(),
      status: z.enum(["passed", "failed", "skipped"]),
      reason: z.string().optional(),

      request: z
        .object({
          method: z.string(),
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
          bodyPreview: z.string().optional(),
        })
        .optional(),

      response: z
        .object({
          status: z.number().optional(),
          contentType: z.string().optional(),
          bodyPreview: z.string().optional(),
        })
        .optional(),

      errors: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            path: z.string().optional(),
          }),
        )
        .default([]),
    }),
  ),
});
```

Reports must not include raw secret values.

## Read-only flow

```sh
bun run dev-server
li-product conform ./lili.schema.ts \
  --base-url http://localhost:5173 \
  --capability "projects.*" \
  --report .lili/conformance.local.json
```

Expected behavior:

```txt
projects.list:
  argv parses
  input validates
  request serializes to GET /api/projects?limit=2
  response parses as JSON
  response validates against output schema
  case passes

projects.delete:
  skipped because destructive and no explicit opt-in
```

## Tests

Required tests:

- `conform` is separate from `generate --check`
- read-only examples run by default
- destructive capabilities skip by default
- destructive capabilities require fixture plus opt-in
- argv/input mismatch fails
- HTTP binding mismatch fails before network
- non-2xx response becomes structured failure
- malformed JSON becomes structured failure
- schema-invalid JSON becomes structured failure
- missing example is skipped, not passed
- report summary counts are correct
- report contains no raw secrets
