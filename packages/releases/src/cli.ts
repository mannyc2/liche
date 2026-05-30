#!/usr/bin/env bun
import { defineCli, defineCommand, outputControls, reflectionControls, run, z } from '@liche/core'
import { completions, config, files } from '@liche/extensions'
import { runPackageCommand } from './cli/package-command.js'
import { runPublishCommand } from './cli/publish-command.js'
import { runShipCommand } from './cli/ship-command.js'
import { PublisherCredentialEnvSchema } from './cli/types.js'
import { ReleasesConfigSchema } from './config.js'

const RELEASE_TOOL_VERSION = '0.8.1'

export const cli = defineCli({
  commands: [
    defineCommand({
      path: ['package'],
      input: {
        aliases: { out: 'o' },
        args: z.object({ buildRecord: z.string() }),
        options: z.object({ out: z.string() }),
      },
      run: ({ ctx }) => runPackageCommand(ctx),
    }),
    defineCommand({
      path: ['publish'],
      input: {
        args: z.object({ manifest: z.string() }),
        env: PublisherCredentialEnvSchema,
        options: z.object({
          ecosystems: z.string().default('all'),
          dryRun: z.boolean().default(false),
        }),
      },
      run: ({ ctx }) => runPublishCommand(ctx),
    }),
    defineCommand({
      path: ['ship'],
      input: {
        env: PublisherCredentialEnvSchema,
        options: z.object({
          dryRun: z.boolean().default(false),
        }),
      },
      run: ({ ctx }) => runShipCommand(ctx),
    }),
  ],
  extensions: [
    outputControls(),
    reflectionControls(),
    completions(),
    config({
      schema: ReleasesConfigSchema,
      sources: [
        files({
          files: ['liche.releases.json', 'liche.releases.jsonc'],
          scopes: { project: { discoverUpwards: true }, user: false },
        }),
      ],
    }),
  ],
  name: 'liche-release',
  version: RELEASE_TOOL_VERSION,
})

if (import.meta.main) await run(cli, process.argv.slice(2))
