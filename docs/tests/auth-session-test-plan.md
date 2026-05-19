# Test plan: auth and session

Authoritative sources: `docs/auth-session.md`, `docs/product-schema.md`, `docs/core-api-boundary.md`, `docs/http-operation-transport.md`, `docs/distribution.md`, and `docs/coverage-rewrite.md`.

## Priority order

1. Catalog normalization for auth providers, contexts, permissions, and capability requirements.
2. Secret redaction.
3. Env token resolution and structured auth errors.
4. Context resolution.
5. Generated auth command surfaces.
6. Transport integration and 401/403 mapping.
7. Session store behavior.
8. Agent/MCP metadata.
9. Release manifest auth metadata.

## Slice A: env auth and requirements

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/build/test/auth-catalog.test.ts` | `AUTH-001` | Product schema auth providers, permissions, contexts, and `requires` normalize into plain catalog data. | Auth is generated as hidden CLI behavior instead of catalog metadata. |
| `packages/core/test/secret-string.test.ts` | `AUTH-002` | `SecretString` redacts through string, JSON, error, and metadata paths; only explicit reveal returns raw value. | Token leaks through logging or envelopes. |
| `packages/core/test/resolve-auth-env.test.ts` | `AUTH-003` | Env bearer/API key resolution works across CLI/CI/agent modes and missing env returns structured errors. | CI/agent silently use sessions or raw env errors leak. |
| `packages/core/test/resolve-context.test.ts` | `AUTH-004` | Context flags beat env, env beats stored context, and stored context is used only when allowed. | Wrong org/project selected silently. |
| `packages/build/test/generated-auth-flags.test.ts` | `AUTH-011` | Auth-enabled generated CLIs get `--profile`, `--non-interactive`, and `--no-session`; no-auth CLIs do not. | Auth globals pollute public unauthenticated CLIs. |
| `packages/build/test/generated-auth-runtime.test.ts` | `AUTH-003`, `AUTH-004`, `AUTH-006` | Generated command resolves auth/context before transport and never starts login implicitly. | Generated code passes raw tokens or starts device flow from normal commands. |

## Slice B: sessions and auth commands

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/build/test/auth-command-capabilities.test.ts` | `AUTH-005` | `whoami` and `switch` emit normal catalog capabilities with auth effects, policies, and surfaces. | Auth commands are hard-coded built-ins or agent-visible mutators. |
| `packages/core/test/session-store.test.ts` | `AUTH-007` | File store uses restricted permissions, lock file, atomic write/rename, corrupt-file rename, and profile naming validation. | Corrupt sessions reset silently or concurrent writes corrupt state. |
| `packages/build/test/auth-agent-metadata.test.ts` | `AUTH-009` | Agent/MCP metadata includes auth requirements/status and excludes tokens, env values, paths, and device codes. | Agent cannot recover from auth failure or receives secrets. |

## Slice C: OAuth device login

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/build/test/oauth-device-commands.test.ts` | `AUTH-005`, `AUTH-006` | `login`/`logout` are generated capabilities only when OAuth/session source is configured. | OAuth commands appear for env-only products or as hidden built-ins. |
| `packages/core/test/oauth-device-flow.test.ts` | `AUTH-006` | Device user code appears only for interactive login; noninteractive, CI, agent, and MCP fail with `AUTH_INTERACTIVE_REQUIRED`. | Agent/CI receives device code or browser flow starts unexpectedly. |

## Transport and release

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/core/test/auth-http-status.test.ts` | `AUTH-008`, `AUTH-012` | 401/403 map according to auth requirement and known scopes; unknown scopes defer to server response. | All 401s become expired or local scope checks block valid tokens. |
| `packages/releases/test/auth-manifest.test.ts` | `AUTH-010` | Release manifest records provider IDs, modes, env var names, auth command names, context selectors, and session posture without secrets. | Release artifact leaks runtime session state or hides auth requirements. |

## Fixture rules

- Do not use real OAuth services.
- Do not write to the user's actual config directory; always pass a temporary store root.
- Do not place raw token strings in golden snapshots.
- Any expected error fixture must assert that token values, env values, user codes, and full local paths are absent.
