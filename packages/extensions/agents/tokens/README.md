# @liche/tokens

Opt-in token-aware output controls for Liche CLIs.

Adds the `--token-count`, `--token-limit`, and `--token-offset` global flags and applies a token-aware output transform (powered by [`tokenx`](https://www.npmjs.com/package/tokenx)) after the result is rendered.

## Usage

```ts
import { defineCli, help, outputControls } from '@liche/core'
import { tokens } from '@liche/tokens'

const cli = defineCli({
  name: 'app',
  extensions: [help(), outputControls({ json: true }), tokens()],
  commands: [/* ... */],
})
```

Agent-facing CLIs typically get `tokens()` automatically via the `agents()` meta-extension from `@liche/agents`.
