# Auth and sessions

Auth is part of the product catalog, not a parallel CLI feature.

```txt
capabilities declare what they require
auth providers declare how credentials and context are resolved
normal operations never start login implicitly
```

This document defines the public API and the runtime contract. Auth workflows live in `@liche/auth`; core keeps the redaction and transport-safety primitives.

## Package ownership

| Responsibility | Owner |
|---|---|
| Auth provider declarations | `@liche/product` schema API; normalized into catalog |
| Permission declarations | `@liche/product`; permissions/scopes are catalog metadata |
| Context declarations | `@liche/product`; resolved by generated code through `@liche/auth` |
| Generated `login`, `logout`, `whoami`, `switch` | `@liche/product` emits catalog capabilities; generated code implements them through `@liche/auth` |
| Token resolution | `@liche/auth` |
| Session/profile storage | `@liche/auth` file store plus public `SessionStore` interface |
| Applying auth headers | `@liche/core` HTTP operation transport |
| Structured auth errors | `@liche/core` |
| Agent/MCP auth metadata | Catalog metadata from `@liche/product`; runtime status from generated code and extensions |
| Release manifest auth metadata | `@liche/releases`; non-secret expectations only |

Auth-free CLIs do not import the auth extension. `@liche/product` only pulls in `@liche/auth` when the normalized catalog declares an auth provider, so products with `Auth.none()` and no contexts produce auth-free generated code.

## Product schema API

Auth is opt-in. Omitting `auth` means no auth; `auth: Auth.none()` is available when explicitness helps examples or tests:

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

One auth provider per product. Auth is declared at the product level, not per capability.

## Core runtime API

Core (`@liche/core`) exposes the redaction/transport primitives — `SecretString`, `TokenSourceSpec`, `AuthProviderRuntime`, `AuthCredential`, etc. The auth runtime itself — `resolveAuth`, `resolveContext`, session stores, OAuth device flows, and the `InvocationKind` discriminator that gates interactive auth flows — lives in `@liche/auth`, the only consumer that actually branches on those values. Generated code may wrap either in product-specific helpers, but does not import private core subpaths.

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

export function credentialHttpAuth(
  credential: AuthCredential,
  input?: { requiredPermissions?: readonly string[] },
): HttpAuth;
```

`SecretString` is a redaction boundary. It does not serialize, stringify, or inspect as the raw secret by accident. Only transport/session code calls `reveal()`.

`resolveAuth`, `resolveContext`, `applyAuth`, `credentialHttpAuth`, `SessionStore`, and `createFileSessionStore` are exported from `@liche/auth`. `secret` is the only auth-adjacent public top-level `@liche/core` API.

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

No raw token, API key, refresh token, auth header, device user code, session file content, or full local session path appears in error details, logs, conformance reports, release manifests, MCP metadata, or generated docs.

## Global generated flags and invocation

Generated CLIs that opt into auth/session add these global flags:

| Flag | Meaning |
|---|---|
| `--profile <name>` | Select stored profile for this invocation. |
| `--non-interactive` | Disable prompts, browser opens, and device-flow login. |
| `--no-session` | Ignore stored sessions for this invocation. |

Context declarations add named flags such as `--org` or `--project`. There is no generic `--context key=value` flag.

Invocation kind is passed explicitly by generated entrypoints:

- normal CLI entrypoint: `"cli"`
- CI mode: `"ci"` when `--non-interactive` is set with CI env or the generated CI wrapper chooses it
- generated MCP server/tool call: `"mcp"`
- generated agent surface invocation: `"agent"`

Plain CLI may infer CI from common env vars as a fallback. Generated MCP and agent wrappers pass the invocation kind explicitly.

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

Behavior:

- directory mode `0700` and file mode `0600` on Unix; best-effort restricted permissions on Windows
- profile names match `/^[A-Za-z0-9._-]{1,64}$/`
- default profile is `default`
- writes use a lock file plus temp-write/rename
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

Access tokens are stored in the file store with restricted permissions. Refresh tokens are not stored, and there is no OS keychain integration.

## Resolution order

Profile selection:

1. `--profile`
2. `<PRODUCT_ENV_PREFIX>_PROFILE`
3. stored active profile
4. `default`

Credential resolution:

1. `Auth.none()` returns no credential.
2. Env token source, when its env var is present.
3. Stored session for the selected profile, only when allowed for the invocation.
4. Fail. Normal commands never start login implicitly.

Context resolution:

1. Explicit command flags/input such as `--org` or `--project`.
2. Context env vars such as `ACME_ORG_ID`.
3. Stored selected context from the profile, only when using a session credential or when `--profile` was explicit.
4. Fail with `AUTH_CONTEXT_REQUIRED`.

Invocation rules:

| Invocation | Credential behavior |
|---|---|
| Human CLI | Env beats session; no implicit login. |
| `--non-interactive` | Env beats session; valid stored session allowed; no prompts/device flow. |
| CI | Env only by default; stored sessions ignored. |
| Agent/MCP | Env only unless launch config explicitly pins `profile` or `allowStoredSession`. |
| Explicit profile | Selects stored profile/context; env credential still beats stored credential. |

When env credentials and stored context are combined through explicit `--profile`, `whoami --json` and result metadata show different credential and context sources.

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

Mappings:

| Case | Code | Notes |
|---|---|---|
| Missing human auth | `AUTH_MISSING` | Include login command only if generated. |
| Missing CI token | `AUTH_CI_TOKEN_MISSING` | Include env var names only. |
| Expired token, no refresh | `AUTH_EXPIRED` | Include login command if generated. |
| Missing org/project | `AUTH_CONTEXT_REQUIRED` | Include required contexts, env names, and switch example. |
| Known missing local scope | `AUTH_SCOPE_MISSING` | Only when credential scopes are known. |
| Server 401 with auth present | `AUTH_INVALID` or `AUTH_EXPIRED` | Not every 401 is expiry. |
| Server 403 | `AUTH_PERMISSION_DENIED` | Include product permission names, not secrets. |
| Device flow from noninteractive terminal | `AUTH_INTERACTIVE_REQUIRED` | `login` only. |
| Agent calls auth-required command | same envelope | No browser/device flow. |

Server-side permission checks are authoritative. Local scope checks are best-effort, only when scopes are known.

## Device flow UX

OAuth device flow is explicit-login only. Normal auth-required operations never start it.

`login` may display these human-only fields:

- verification URI
- user code
- expiry
- polling interval
- cancellation instructions

`--non-interactive`, CI, agent, and MCP invocations fail with `AUTH_INTERACTIVE_REQUIRED` instead of printing user codes or opening browsers.

Device flow stores access tokens only. There is no automatic retry after a 401.

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
  auth: credential ? credentialHttpAuth(credential, { requiredPermissions: ["deployments:write"] }) : { kind: "none" },
  method: "POST",
  path: "/orgs/{org_id}/projects/{project_id}/deployments",
  bind: { path: ["org_id", "project_id"], body: true },
  input: { ...ctx.options, ...context },
  output: deploymentOutput,
  env: ctx.env,
});
```

`callHttpOperation` accepts resolved headers/secrets. Generated code uses `credentialHttpAuth()` from `@liche/auth`, so raw token strings never enter generated command source and only the auth extension calls `SecretString.reveal()`.

## Agent and MCP metadata

Product-generated agent and MCP artifacts can include non-secret auth state from the catalog or from adapter-specific runtime checks:

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

Only values useful for safe planning and recovery are exposed. Core command manifests do not carry auth metadata. Token values, refresh tokens, API keys, authorization headers, env var values, device user codes, session file contents, keychain references, raw HTTP auth failures with secrets, and full local filesystem paths are never exposed.

`login`, `logout`, and `switch` are not agent-visible. `whoami` is agent-visible because it is local, read-only, and redacted.

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

Selected profiles, selected org/project values, tokens, refresh tokens, account emails, and session paths are never in the release manifest.

## Current limitations

- One auth provider per product. Multi-provider auth and per-capability provider selection are not supported.
- Refresh tokens are not stored and refresh rotation is not supported. Stored access tokens are used until they expire; users re-run `login` after that.
- OS keychain integration is not supported. Sessions live in plaintext JSON with restricted file permissions.
- Remote context pickers (interactive `switch` against a `list` endpoint) are not yet runtime-resolved. Contexts come from flags, env vars, or stored profile values.
- Hosted policy and session sync are out of scope for the local toolchain.
- Agents cannot trigger `login` — interactive auth remains explicit.
