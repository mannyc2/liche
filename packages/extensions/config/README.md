# @liche/config

Config-file extension for `@liche/core` CLIs.

Wires a declarative config schema (files + flag + scopes) into a CLI through the extension lane, and ships a `config doctor` command that reports which config sources loaded and what keys they contributed.

```ts
import { defineCli, z } from '@liche/core'
import { config, configDoctor } from '@liche/config'

defineCli({
  name: 'shipyard',
  extensions: [
    config({
      files: ['shipyard.toml', 'shipyard.json'],
      flag: 'config',
      schema: z.strictObject({ defaultRegion: z.string().default('iad') }),
      scopes: { project: true, user: { xdg: true } },
    }),
    configDoctor(),
  ],
})
```

Core resolves the config sources, validates against the schema, and surfaces values through `ctx.config`. This package only declares the extension; the resolution machinery lives in `@liche/core`.
