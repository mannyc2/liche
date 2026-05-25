# @liche/completions

Shell completion extension for `@liche/core` CLIs.

Adds a `completions` command that prints a shell-specific script for `bash`, `zsh`, or `fish`. The script delegates back to the same binary with `COMPLETE=<shell>` so dynamic completions stay in sync with the live command graph.

```ts
import { defineCli } from '@liche/core'
import { completions } from '@liche/completions'

defineCli({
  name: 'shipyard',
  extensions: [completions()],
})
```

`completionScript(shell, binaryName)` is also exported for callers that want the raw script text without registering the command.
