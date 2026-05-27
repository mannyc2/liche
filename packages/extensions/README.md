# @liche/extensions

Official optional extensions for `@liche/core` CLIs.

Use this package when a CLI wants first-party optional surface without making those helpers part of core:

```ts
import { defineCli, defineCommand, help, outputControls, z } from "@liche/core";
import { agents, completions, config, configDoctor } from "@liche/extensions";

export default defineCli({
  name: "ship",
  extensions: [
    help(),
    outputControls({ json: true }),
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
        options: z.object({ region: z.string().default("dfw") }),
        sources: {
          options: {
            region: [{ provider: "config", path: "defaultRegion" }],
          },
        },
      },
      run({ input }) {
        return { region: input.options.region };
      },
    }),
  ],
});
```

Landed lanes:

- `@liche/config`: `config(...)` and `configDoctor()`.
- `@liche/auth`: `auth()`, auth globals, `resolveAuth`, `resolveContext`, file sessions, OAuth device login, and generated auth command helpers.
- `@liche/completions`: `completions()` and shell script helpers.
- `@liche/agents`: `agents()` bundle for MCP, skills, and `--llms`; MCP tools inherit Core validation, source-aware field errors, and `arg.fromString()` surface policy.
- `@liche/mcp-installer`: `mcpInstaller()` and MCP config writing helpers.
- `@liche/mcp-server`: `mcpServer()` and MCP runtime handlers, including `tools/list` filtering and `UNSUPPORTED_SURFACE` enforcement for transport-specific codecs.
- `@liche/skills-installer`: `skillsInstaller()` and skill writing helpers.
- `@liche/skills-runtime`: `skillsRuntime()` / `llms()` and live skill manifest rendering.
- `@liche/telemetry`: `telemetry()`, `jsonlFileSink()`, `httpSink()`, `consoleSink()`, and `noopSink()`.

Auth-enabled CLIs install the auth lane to declare the standard profile/session globals:

```ts
import { defineCli } from "@liche/core";
import { auth } from "@liche/auth";

export default defineCli({
  name: "ship",
  extensions: [auth()],
  commands: [],
});
```
