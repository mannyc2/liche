# @liche/auth

Auth workflow extension for `@liche/core` CLIs.

Provides the optional workflow surface that core deliberately doesn't ship: the `--profile / --non-interactive / --no-session` global flags, an on-disk session store, env-var + session credential resolution, scope and context validation, OAuth device login, and the `whoami / switch / logout` command implementations.

```ts
import { defineCli } from '@liche/core'
import { auth, createFileSessionStore, resolveAuth } from '@liche/auth'

defineCli({
  name: 'shipyard',
  extensions: [auth()],
  // generated commands wire resolveAuth + createFileSessionStore into their handlers
})
```

Core owns the wire-level primitives: `SecretString`, `applyAuth(headers, credential)`, and the `authInvalid` / `authPermissionDenied` HTTP-response errors. This package owns everything above that — what core would call "workflow" — and stays optional so a CLI can ship with neither auth flags nor stored sessions.
