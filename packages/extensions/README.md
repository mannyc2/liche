# @liche/extensions

Official optional extensions for `@liche/core` CLIs.

Use this package when a CLI wants first-party optional surface without making those helpers part of core:

```ts
import { defineCli, defineCommand, z } from "@liche/core";
import { agents, completions, config, configDoctor } from "@liche/extensions";

export default defineCli({
  name: "ship",
  extensions: [
    completions(),
    config({
      schema: z.strictObject({
        defaultRegion: z.string().default("iad"),
      }),
    }),
    configDoctor(),
    agents(),
  ],
  commands: [
    defineCommand({
      path: ["deploy"],
      input: {
        config: { region: "defaultRegion" },
        options: z.object({ region: z.string().default("dfw") }),
      },
      run({ input }) {
        return { region: input.options.region };
      },
    }),
  ],
});
```

Landed lanes:

- `@liche/extensions/config`: `config(...)` and `configDoctor()`.
- `@liche/extensions/auth`: `auth()`, auth globals, `resolveAuth`, `resolveContext`, file sessions, OAuth device login, and generated auth command helpers.
- `@liche/extensions/completions`: `completions()` and shell script helpers.
- `@liche/extensions/agents`: `agents()` bundle for MCP and skill installers.
- `@liche/extensions/mcp`: `mcpInstaller()` and MCP config writing helpers.
- `@liche/extensions/skills`: `skillsInstaller()` and skill writing helpers.
- `@liche/extensions/support`: `runLocalDoctor()` and `createLocalTelemetrySink()`.

Auth-enabled CLIs install the auth lane to declare the standard profile/session globals:

```ts
import { defineCli } from "@liche/core";
import { auth } from "@liche/extensions/auth";

export default defineCli({
  name: "ship",
  extensions: [auth()],
  commands: [],
});
```
