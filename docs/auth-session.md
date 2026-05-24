# Auth and session requirements

Auth is part of the product catalog, not a parallel CLI feature.

Hard rule:

```txt
capabilities declare what they require
auth providers declare how credentials and context are resolved
normal operations never start login implicitly
```

This document defines the public API direction and the runtime contract. It does not create a new package.

## Package ownership

| Responsibility | Owner |
|---|---|
| Auth provider declarations | `@liche/product` product schema API; normalized into catalog |
| Permission declarations | `@liche/product`; product permissions/scopes are catalog metadata |
| Context declarations | `@liche/product`; resolved by generated code through core primitives |
| Generated `login`, `logout`, `whoami`, `switch` | `@liche/product` emits catalog capabilities; generated code implements them through `@liche/core` |
| Token resolution | `@liche/core` |
| Session/profile storage | `@liche/core` default store plus public `SessionStore` interface |
| Refresh token handling | `@liche/core` later; deferred from MVP |
| Applying auth headers | `@liche/core` HTTP operation transport |
| Structured auth errors | `@liche/core` |
| Agent/MCP auth metadata | Catalog metadata from `@liche/product`; runtime status from generated code/core |
| Release manifest auth metadata | `@liche/releases`; non-secret expectations only |
| Hosted policy/session sync | Future hosted platform only |

Do not add `@liche/auth` for MVP. Auth is too central to remote-operation CLIs to make the core generated experience feel optional or incomplete. A package boundary is allowed only if a later requirement can state what users give up by not installing it.

## Product schema API

Auth is opt-in. Omitting `auth` means no auth; `auth: Auth.none()` remains available when explicitness helps examples or tests:

```ts
import { Auth, Command, Field, Runtime, Shape, defineProduct } from "@liche/product";

export default defineProduct({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  description: "Notes API.",
  remote: { baseUrl: Runtime.literal("https://api.notes.dev") },
  auth: Auth.none(),
  commands: {
    status: Command.remoteHttp({
      summary: "Check service status",
      http: { method: "GET", path: "/status" },
      output: Shape.object({ ok: Field.boolean("OK").required() }),
    }),
  },
});
```

API key via env:

```ts
export default defineProduct({
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  auth: Auth.apiKey({
    id: "acme",
    header: "x-api-key",
    sources: [
      Auth.token.env("ACME_API_KEY", { label: "API key" }),
    ],
  }),
});
```

Bearer token via env:

```ts
export default defineProduct({
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  auth: Auth.bearer({
    id: "acme",
    sources: [
      Auth.token.env("ACME_TOKEN", { label: "Bearer token" }),
    ],
  }),
});
```

OAuth device flow plus CI token mode:

```ts
export default defineProduct({
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  auth: Auth.oauthDevice({
    id: "acme",
    token: { kind: "bearer" },
    clientId: "acme-cli",
    endpoints: {
      deviceAuthorization: "https://auth.acme.dev/oauth/device/code",
      token: "https://auth.acme.dev/oauth/token",
      revoke: "https://auth.acme.dev/oauth/revoke",
    },
    sources: [
      Auth.token.session({ profiles: true, refresh: false }),
      Auth.token.env("ACME_TOKEN", { mode: "ci", nonInteractive: true }),
    ],
    identity: Auth.identity({
      http: { method: "GET", path: "/v1/me" },
      subject: "id",
      label: "email",
    }),
    commands: Auth.commands({
      login: "login",
      logout: "logout",
      whoami: "whoami",
      switch: "switch",
    }),
  }),
});
```

Context is first-class and non-secret:

```ts
export default defineProduct({
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  contexts: {
    org: Auth.context.remote({
      label: "Organization",
      idField: "org_id",
      nameField: "name",
      list: { http: { method: "GET", path: "/v1/orgs" } },
      select: { flag: "org", env: "ACME_ORG_ID" },
    }),
    project: Auth.context.remote({
      label: "Project",
      parent: "org",
      idField: "project_id",
      nameField: "name",
      list: { http: { method: "GET", path: "/v1/orgs/{org_id}/projects" } },
      select: { flag: "project", env: "ACME_PROJECT_ID" },
    }),
  },
});
```

Permissions are product terms, even when backed by OAuth scopes:

```ts
export default defineProduct({
  id: "acme",
  name: "Acme",
  version: "1.0.0",
  permissions: {
    "projects:read": Auth.permission.scope("projects.read"),
    "deployments:write": Auth.permission.scope("deployments.write"),
  },
  commands: {
    deploy: Command.workflow({
      summary: "Deploy a project",
      input: Shape.object({
        project_id: Field.string("Project ID").required(),
        ref: Field.string("Git ref").required(),
      }),
      output: Shape.object({
        deployment_id: Field.string("Deployment ID").required(),
      }),
      requires: {
        auth: true,
        contexts: ["org", "project"],
        permissions: ["deployments:write"],
      },
      handler: "deploy.run",
      surfaces: { cli: { command: "deploy <ref>" }, docs: true, agent: true },
    }),
  },
});
```

MVP supports one auth provider per product and product-level auth only. Per-capability provider selection, multi-provider auth, hosted policy, OAuth consent optimization, and agent-triggered login are deferred.

## Core runtime API

Core exposes small public primitives usable by handwritten and generated CLIs. Generated code may wrap them in product-specific helpers, but must not import private core subpaths.

```ts
export type SecretString = {
  readonly kind: "liche.secret";
  reveal(): string;
  toJSON(): "[redacted]";
  toString(): "[redacted]";
};

export function secret(value: string): SecretString;

export type TokenSourceSpec =
  | { kind: "env"; envVar: string; mode?: "any" | "ci"; label?: string }
  | { kind: "session"; refresh?: boolean };

export type AuthProviderRuntime = {
  id: string;
  kind: "none" | "bearer" | "apiKey" | "oauthDevice";
  header?: string;
  tokenSources: TokenSourceSpec[];
  oauthDevice?: OAuthDeviceRuntime;
  identity?: IdentityRuntime;
  session?: { enabled: boolean; profiles: boolean };
};

export type AuthCredential = {
  providerId: string;
  source: "env" | "session";
  profile?: string;
  kind: "bearer" | "apiKey";
  secret: SecretString;
  header?: string;
  account?: { id: string; label?: string };
  scopes?: string[];
  expiresAt?: string;
  refreshAvailable: boolean;
};

export type InvocationKind = "cli" | "ci" | "agent" | "mcp";

export async function resolveAuth(input: {
  provider: AuthProviderRuntime;
  required: boolean;
  requiredScopes?: string[];
  profile?: string;
  invocation: InvocationKind;
  nonInteractive?: boolean;
  allowStoredSession?: boolean;
  env?: Record<string, string | undefined>;
  sessionStore?: SessionStore;
}): Promise<AuthCredential | undefined>;

export async function resolveContext(input: {
  contexts: ContextRuntime[];
  required: string[];
  explicit?: Record<string, string | undefined>;
  env?: Record<string, string | undefined>;
  profile?: StoredProfile;
  credentialSource: "env" | "session" | "none";
}): Promise<Record<string, string>>;

export interface SessionStore {
  listProfiles(productId: string, providerId: string): Promise<string[]>;
  loadProfile(productId: string, providerId: string, profile: string): Promise<StoredProfile | undefined>;
  saveProfile(productId: string, providerId: string, profile: string, value: StoredProfile): Promise<void>;
  deleteProfile(productId: string, providerId: string, profile: string): Promise<void>;
  setActiveProfile(productId: string, providerId: string, profile: string): Promise<void>;
}

export function createFileSessionStore(options?: { root?: string }): SessionStore;

export function applyAuth(headers: Headers, credential: AuthCredential): void;
```

`SecretString` is a redaction boundary. It must not serialize, stringify, or inspect as the raw secret by accident. Only transport/session code may call `reveal()`.

`resolveAuth`, `resolveContext`, `SessionStore`, `createFileSessionStore`, `secret`, and `applyAuth` are public top-level `@liche/core` APIs once the auth slice lands.

Structured auth errors:

```txt
AUTH_MISSING
AUTH_EXPIRED
AUTH_INVALID
AUTH_INTERACTIVE_REQUIRED
AUTH_CI_TOKEN_MISSING
AUTH_CONTEXT_REQUIRED
AUTH_SCOPE_MISSING
AUTH_PERMISSION_DENIED
AUTH_TOKEN_SOURCE_UNAVAILABLE
AUTH_SESSION_CORRUPT
AUTH_SESSION_LOCKED
AUTH_REFRESH_FAILED
```

No raw token, API key, refresh token, auth header, device user code, session file content, or full local session path may appear in error details, logs, conformance reports, release manifests, MCP metadata, or generated docs.

## Global generated flags and invocation

Generated CLIs that opt into auth/session add these global flags:

| Flag | Meaning |
|---|---|
| `--profile <name>` | Select stored profile for this invocation. |
| `--non-interactive` | Disable prompts, browser opens, and device-flow login. |
| `--no-session` | Ignore stored sessions for this invocation. |

Context declarations add named flags such as `--org` or `--project`; do not add a generic `--context key=value` flag in MVP.

Invocation kind is passed explicitly by generated entrypoints:

- normal CLI entrypoint: `"cli"`
- CI mode: `"ci"` when `--non-interactive` is set with CI env or generated CI wrapper chooses it
- generated MCP server/tool call: `"mcp"`
- generated agent surface invocation: `"agent"`

Plain CLI may infer CI from common env vars as a fallback, but generated MCP/agent wrappers must pass the invocation kind explicitly.

## Session storage

Default file store root:

| Platform | Root |
|---|---|
| Env override | `LICHE_HOME` |
| macOS | `~/Library/Application Support/liche` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/liche` |
| Windows | `%APPDATA%\\liche` |

File:

```txt
<root>/sessions/<productId>.json
```

Requirements:

- directory mode `0700` and file mode `0600` on Unix
- best-effort restricted permissions on Windows
- profile names match `/^[A-Za-z0-9._-]{1,64}$/`
- default profile is `default`
- writes use lock file plus temp-write/rename
- lock timeout throws `AUTH_SESSION_LOCKED`
- corrupted JSON is renamed to `<file>.corrupt.<timestamp>` and throws `AUTH_SESSION_CORRUPT`
- `logout` deletes stored credential/session data for the selected profile and never touches env vars
- `logout --all` deletes all profiles for that provider

Stored file shape:

```ts
type StoredSessionFile = {
  schemaVersion: 1;
  productId: string;
  providers: Record<string, {
    activeProfile?: string;
    profiles: Record<string, StoredProfile>;
  }>;
};

type StoredProfile = {
  schemaVersion: 1;
  productId: string;
  providerId: string;
  profile: string;
  createdAt: string;
  updatedAt: string;
  account?: { id: string; label?: string };
  selectedContexts?: Record<string, string>;
  credential?: {
    kind: "bearer" | "apiKey";
    accessToken?: SecretString;
    expiresAt?: string;
    scopes?: string[];
  };
};
```

MVP may store access tokens in the file store with restricted permissions. MVP must not store refresh tokens. OS keychain integration is future work.

## Resolution order

Profile selection:

1. `--profile`
2. `<PRODUCT_ENV_PREFIX>_PROFILE`
3. stored active profile
4. `default`

Credential resolution:

1. `Auth.none()` returns no credential.
2. Env token source, when its env var is present.
3. Stored session for selected profile, only when allowed for invocation.
4. Fail. Normal commands never start login implicitly.

Context resolution:

1. Explicit command flags/input such as `--org` or `--project`.
2. Context env vars such as `ACME_ORG_ID`.
3. Stored selected context from profile only when using a session credential or when `--profile` was explicit.
4. Fail with `AUTH_CONTEXT_REQUIRED`.

Invocation rules:

| Invocation | Credential behavior |
|---|---|
| Human CLI | Env beats session; no implicit login. |
| `--non-interactive` | Env beats session; valid stored session allowed; no prompts/device flow. |
| CI | Env only by default; stored sessions ignored. |
| Agent/MCP | Env only unless launch config explicitly pins `profile` or `allowStoredSession`. |
| Explicit profile | Selects stored profile/context; env credential still beats stored credential. |

When env credentials and stored context are combined through explicit `--profile`, `whoami --json` and result metadata must show different credential and context sources.

## Generated auth capabilities

Auth commands are generated catalog capabilities, not handwritten built-ins. They are emitted only when the auth provider opts into the relevant feature.

| Command | Emitted when | Agent-visible? |
|---|---|---:|
| `whoami` | identity endpoint or local status is declared | yes |
| `switch` | contexts exist and sessions/profiles are enabled | no |
| `login` | OAuth device flow and session source are enabled | no |
| `logout` | session source is enabled | no |

Normalized capability shape examples:

```ts
{
  id: "auth.login",
  kind: "command",
  family: "auth",
  generated: true,
  input: { profile?: "string" },
  output: {
    authenticated: "boolean",
    profile: "string",
    account?: "object",
    expiresAt?: "string",
  },
  effects: { kind: "auth-session-write", writesCredentials: true },
  policy: { localOnly: true, interactive: true, nonInteractive: false },
  surfaces: { cli: { command: "login" }, docs: true, agent: false, openapi: false },
  permissions: [],
}
```

```ts
{
  id: "auth.whoami",
  kind: "command",
  family: "auth",
  generated: true,
  input: { profile?: "string" },
  output: {
    authenticated: "boolean",
    source?: "env|session",
    profile?: "string",
    account?: "object",
    contexts?: "object",
  },
  effects: { kind: "auth-session-read" },
  policy: { localOnly: true, redactsSecrets: true },
  surfaces: { cli: { command: "whoami" }, docs: true, agent: true, openapi: false },
  permissions: [],
}
```

`logout` uses `effects.kind: "auth-session-delete"`. `switch` uses `effects.kind: "auth-context-write"`. These auth effect kinds are first-class effects, not overloaded `write` or `exec` behavior.

## Generated CLI errors

Auth errors use the standard generated failure envelope under `--json`:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_MISSING",
    "message": "Authentication required. Run `acme login` or set ACME_TOKEN.",
    "details": {
      "providerId": "acme",
      "envVars": ["ACME_TOKEN"],
      "loginCommand": "acme login",
      "requiredPermissions": ["deployments:write"]
    }
  }
}
```

Required mappings:

| Case | Code | Notes |
|---|---|---|
| Missing human auth | `AUTH_MISSING` | Include login command only if generated. |
| Missing CI token | `AUTH_CI_TOKEN_MISSING` | Include env var names only. |
| Expired token, no refresh | `AUTH_EXPIRED` | Include login command if generated. |
| Expired token, future refresh enabled and refresh fails | `AUTH_REFRESH_FAILED` | Deferred from MVP. |
| Missing org/project | `AUTH_CONTEXT_REQUIRED` | Include required contexts, env names, and switch example. |
| Known missing local scope | `AUTH_SCOPE_MISSING` | Only when credential scopes are known. |
| Server 401 with auth present | `AUTH_INVALID` or `AUTH_EXPIRED` | Do not assume every 401 is expiry. |
| Server 403 | `AUTH_PERMISSION_DENIED` | Include product permission names, not secrets. |
| Device flow from noninteractive terminal | `AUTH_INTERACTIVE_REQUIRED` | `login` only. |
| Agent calls auth-required command | same envelope | No browser/device flow. |

Server-side permission checks remain authoritative. Local scope checks are best-effort only when scopes are known.

## Device flow UX

OAuth device flow is explicit-login only. Normal auth-required operations never start it.

`login` may display these human-only fields:

- verification URI
- user code
- expiry
- polling interval
- cancellation instructions

Normal operations never start device flow. `--non-interactive`, CI, agent, and MCP invocations fail with `AUTH_INTERACTIVE_REQUIRED` instead of printing user codes or opening browsers.

MVP device flow stores access tokens only. Refresh tokens, refresh rotation, and automatic retry after 401 are deferred. Future refresh may refresh before request when the stored token is expired or near expiry; do not retry mutating operations after a 401 unless a later idempotency-aware requirement explicitly allows it.

## HTTP transport integration

Generated code resolves auth and context before calling transport:

```ts
const credential = await resolveAuth({
  provider: acmeAuth,
  required: true,
  requiredScopes: ["deployments.write"],
  profile: ctx.global.profile,
  invocation: ctx.invocation,
  nonInteractive: ctx.global.nonInteractive,
  env: ctx.env,
  sessionStore,
});

const context = await resolveContext({
  contexts: acmeContexts,
  required: ["org", "project"],
  explicit: ctx.options,
  env: ctx.env,
  profile: credential?.source === "session" ? profile : undefined,
  credentialSource: credential?.source ?? "none",
});

return await callHttpOperation({
  id: "deployments.create",
  baseUrl: { envVar: "ACME_API_URL" },
  auth: credential ? { kind: "resolved", credential } : { kind: "none" },
  method: "POST",
  path: "/orgs/{org_id}/projects/{project_id}/deployments",
  bind: { path: ["org_id", "project_id"], body: true },
  input: { ...ctx.options, ...context },
  output: deploymentOutput,
  env: ctx.env,
});
```

`callHttpOperation` accepts resolved credentials after the auth slice lands. It applies headers through `applyAuth`. It must not accept raw token strings directly in generated code.

## Agent and MCP metadata

Agents may see non-secret auth state:

```ts
{
  auth: {
    required: true,
    providerId: "acme",
    authenticated: true,
    source: "env",
    profile: "work",
    accountLabel: "dev@example.com",
    contexts: { org: "org_123", project: "prj_456" },
    grantedScopes: ["projects.read"],
    requiredPermissions: ["deployments:write"],
    expiresAt: "2026-05-19T18:00:00Z",
    refreshAvailable: false,
    loginCommand: "acme login"
  }
}
```

Expose only values that are useful for safe planning and recovery. Never expose token values, refresh tokens, API keys, authorization headers, env var values, device user codes, session file contents, keychain references, raw HTTP auth failures with secrets, or full local filesystem paths.

`login`, `logout`, and `switch` are not agent-visible by default. `whoami` may be agent-visible because it is local, read-only, and redacted.

## Release manifest fields

`@liche/releases` records auth/session expectations, never secrets:

```ts
auth: {
  providers: [{
    id: "acme",
    kind: "oauthDevice",
    credentialTransport: "bearer",
    modes: ["env", "session", "oauth-device"],
    envVars: [{ name: "ACME_TOKEN", purpose: "bearer-token" }],
    commands: {
      login: "login",
      logout: "logout",
      whoami: "whoami",
      switch: "switch"
    },
    contexts: [
      { id: "org", envVar: "ACME_ORG_ID", flag: "org" },
      { id: "project", envVar: "ACME_PROJECT_ID", flag: "project" }
    ],
    sessionStorage: {
      used: true,
      profiles: true,
      storesAccessTokens: true,
      storesRefreshTokens: false,
      keychainRequired: false
    },
    requiredRuntimeCapabilities: ["env", "filesystem", "tty-for-login"]
  }]
}
```

No selected profile, selected org/project value, token, refresh token, account email, or session path belongs in the release manifest.

## MVP staging

### Slice A: env auth and requirements

- one provider per product
- `Auth.none`, `Auth.apiKey`, and `Auth.bearer`
- env token resolution only
- `requires.auth`, `requires.contexts`, and `requires.permissions`
- context via explicit flags and env vars
- structured auth errors
- `SecretString` and `applyAuth`
- release manifest auth metadata

### Slice B: file sessions and context

- `SessionStore` and `createFileSessionStore`
- profiles and active profile
- access-token file storage with restricted permissions
- stored selected context
- generated `whoami` and `switch`
- `--profile`, `--non-interactive`, `--no-session`

### Slice C: OAuth device login

- generated `login` and `logout`
- OAuth device code polling
- access-token storage only
- no refresh tokens
- no keychain dependency
- no implicit login from normal operations

Deferred: multi-provider auth, per-capability provider selection, refresh-token rotation, OS keychain integration, hosted policy/session sync, OAuth consent optimization, remote context pickers, and agent-triggered login.

## Implementation status

Slice A landed in Phase 3D-A (next-plan.md). The behavior in this doc is authoritative; the notes below trace the implementation:

- `@liche/core`: `SecretString` + `secret()` (`packages/core/src/auth/secret.ts`); env-only `resolveAuth`, `resolveContext`, and `applyAuth` (`packages/core/src/auth/resolve.ts`); `AUTH_MISSING` / `AUTH_CI_TOKEN_MISSING` / `AUTH_CONTEXT_REQUIRED` / `AUTH_SCOPE_MISSING` / `AUTH_PERMISSION_DENIED` / `AUTH_INVALID` / `AUTH_EXPIRED` factories built on internal `LicheError` (`packages/core/src/auth/errors.ts`) and normalized to public `CommandError` objects at the executor boundary. `LicheError.details` and `CommandError.details` carry structured auth payloads through the envelope. `RunContext.invocation` carries `cli` / `ci` / `agent` / `mcp` into generated code so CI-mode token sources are reachable without process-global env mutation.
- `@liche/product`: `Auth.none|bearer|apiKey`, `Auth.token.env`, `Auth.permission.scope`, `Auth.context.env|remote` (`packages/product/src/auth.ts`); `defineProduct({ auth, permissions, contexts })` (`packages/product/src/product.ts`); structured `requires: { auth, contexts, permissions }` slot replaces the old `permission?: string` field on capabilities; `normalizeProduct` validates capability `requires` against declared contexts, declared product permissions, and auth posture (`packages/product/src/catalog.ts`); `buildAuthManifest` emits the per-provider auth block on the generated surface manifest (`packages/product/src/manifest.ts`).
- Generated CLI (`packages/product/src/generate-cli.ts`): when a capability declares `requires.auth` or `requires.contexts`, the generator imports `resolveAuth` / `resolveContext` from `@liche/core`, emits top-level `PRODUCT_ID` / `PROFILE_ENV_VAR` / `AUTH_PROVIDER` / `CONTEXTS` constants, injects each declared context flag as an optional `z.string()` option so `resolveContext` can apply flag > env > stored profile fallback, parses only the env vars needed by that capability through the command env schema, passes `ctx.invocation` / `ctx.global` / `ctx.env` / required permissions / mapped scopes into `resolveAuth`, and resolves auth/context before remote dispatch. Generated command manifests and MCP `tools/list` include non-secret auth requirement metadata (`required`, `status`, provider id, env var names, contexts, permissions, scopes). Products with `Auth.none()` and no auth/context requirements still avoid auth-runtime imports.
- Slice B/C now landed: `@liche/core` exposes `SessionStore`, `createFileSessionStore`, profile/session helpers, identity probing, and OAuth device login helpers. The file store writes restricted JSON under `LICHE_HOME` or the platform config root, supports active profiles and selected contexts, quarantines corrupt files, and throws `AUTH_SESSION_CORRUPT` / `AUTH_SESSION_LOCKED` where appropriate. Generated CLIs parse `--profile`, `--non-interactive`, and `--no-session`, emit generated `whoami` / `switch` / `login` / `logout` commands when the auth provider opts in, and hide interactive `login` / `logout` / `switch` from MCP tools. Normal auth-required commands still call `resolveAuth` only; CLI/CI/agent/MCP paths never start OAuth device login implicitly.

Still deferred: refresh tokens, refresh rotation, OS keychain integration, remote context picker/list runtime calls, hosted policy/session sync, and agent-triggered login.
