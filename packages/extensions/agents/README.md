# @liche/agents

Meta-extension that bundles `@liche/mcp-installer`, `@liche/mcp-server`, `@liche/skills-installer`, `@liche/skills-runtime`, and the `--llms` control so a CLI can declare agent-facing tooling in one extension.

```ts
import { defineCli } from '@liche/core'
import { agents } from '@liche/agents'

defineCli({
  name: 'shipyard',
  extensions: [agents({
    command: 'shipyard',
    skill: { markdown: '# shipyard\n\nUse the shipyard CLI for...' },
  })],
})
```

The bundled commands are `mcp add` and `skills add` / `skills list`, plus runtime globals `--mcp` and `--llms`. Output flags such as `--json` still come from Core `outputControls()`; help flags still come from Core `help()`.

If you only want the LLM manifest, install `llms()` directly. If you only want one helper command family, install `@liche/mcp-installer`, `@liche/mcp-server`, `@liche/skills-installer`, or `@liche/skills-runtime` directly and skip this meta-package.
