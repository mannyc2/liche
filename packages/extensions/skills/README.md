# @liche/skills

Skill markdown installer extension for `@liche/core` CLIs.

Adds `skills add` (writes `SKILL.md` to the agent's skill directory) and `skills list` commands. Built-in adapters cover `claude-code` (writes to `~/.claude/skills/<name>/` global or `./.claude/skills/<name>/` local) and `cursor` (same shape under `~/.cursor/skills/`). Unknown agents fall back to `~/.config/liche/skills/<name>/`.

```ts
import { defineCli } from '@liche/core'
import { skillsInstaller } from '@liche/skills'

defineCli({
  name: 'shipyard',
  extensions: [skillsInstaller({ skill: { markdown: '# shipyard\n\nUse the shipyard CLI...' } })],
})
```

`writeSkill(name, options)` is also exported for callers that want to perform the install programmatically.
