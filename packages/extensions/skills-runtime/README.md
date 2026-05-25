# @liche/skills-runtime

Skill manifest runtime extension for `@liche/core` CLIs.

Adds a `--llms` global flag that emits a Markdown skill (or, with `--full-output`, the full skill markdown) describing the CLI to LLM-driven clients. With `--json`/`--format`, emits the structured command manifest envelope instead.

```ts
import { defineCli } from '@liche/core'
import { skillsRuntime } from '@liche/skills-runtime'

defineCli({
  name: 'shipyard',
  extensions: [skillsRuntime()],
})
```

`skillMarkdown(name, state)` and `skillIndex(name, state)` are also exported for callers that want to render the skill content directly.

Pair with `@liche/skills-installer` to write a `SKILL.md` file into an agent's skill directory.
