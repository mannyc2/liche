# @liche/config

Config-file extension for `@liche/core` CLIs.

Wires config file sources into Core's input-source lane, and ships a `config doctor` command that reports which config keys are visible.

```ts
import { defineCli, z } from '@liche/core'
import { config, configDoctor, files } from '@liche/config'

defineCli({
  name: 'shipyard',
  extensions: [
    config({
      flag: 'config',
      schema: z.strictObject({ defaultRegion: z.string().default('iad') }),
      sources: [
        files({
          files: ['shipyard.toml', 'shipyard.json'],
          scopes: { project: true, user: { xdg: true } },
        }),
      ],
    }),
    configDoctor(),
  ],
})
```

Core resolves declared input-source bindings before option validation and exposes values through `ctx.sources`. When a config-provided value fails validation, Core attaches a provider source to the field error so human and JSON renderers can point at the config key rather than a generic object path. This package provides the `config` source provider plus config-specific globals, file loading, and diagnostics.
