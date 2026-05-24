#!/usr/bin/env bun
import { defineCli, defineCommand, z } from '@liche/core'
import { completions, config } from '@liche/extensions'
import {
  PublisherCredentialEnvSchema,
  runPackageCommand,
  runPublishCommand,
  runShipCommand,
} from './cli-commands.js'
import { ReleasesConfigSchema } from './release-config.js'

const RELEASE_TOOL_VERSION = '0.4.0'

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
    completions(),
    config({
      files: ['liche.releases.json', 'liche.releases.jsonc'],
      schema: ReleasesConfigSchema,
      scopes: { project: { discoverUpwards: true }, user: false },
    }),
  ],
  name: 'liche-release',
  version: RELEASE_TOOL_VERSION,
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
