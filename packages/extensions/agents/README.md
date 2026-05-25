# @liche/agents

Meta-extension that bundles `@liche/mcp` + `@liche/skills` into one extension so a CLI can declare agent-facing tooling in a single line.

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

The bundled commands are `mcp add` and `skills add` / `skills list`. If you only want one of them, install `@liche/mcp` or `@liche/skills` directly and skip this meta-package.
