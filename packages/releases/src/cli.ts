#!/usr/bin/env bun
import { Config, defineCli, defineCommand, z } from '@lili/core'
import {
  PublisherCredentialEnvSchema,
  runPackageCommand,
  runPublishCommand,
  runShipCommand,
} from './cli-commands.js'
import { ReleasesConfigSchema } from './release-config.js'

const RELEASE_TOOL_VERSION = '0.0.0'

export const cli = defineCli({
  builtins: { completions: true },
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
  config: Config.object({
    files: ['lili.releases.json', 'lili.releases.jsonc'],
    schema: ReleasesConfigSchema,
    scopes: { project: { discoverUpwards: true }, user: false },
  }),
  name: 'li-release',
  version: RELEASE_TOOL_VERSION,
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
