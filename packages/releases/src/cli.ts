#!/usr/bin/env bun
import { Cli, Config, z } from '@lili/core'
import {
  PublisherCredentialEnvSchema,
  runPackageCommand,
  runPublishCommand,
  runShipCommand,
} from './cli-commands.js'
import { ReleasesConfigSchema } from './release-config.js'

const RELEASE_TOOL_VERSION = '0.0.0'

export const cli = Cli.create('li-release', {
  builtins: { completions: true },
  config: Config.object({
    files: ['lili.releases.json', 'lili.releases.jsonc'],
    schema: ReleasesConfigSchema,
    scopes: { project: { discoverUpwards: true }, user: false },
  }),
  version: RELEASE_TOOL_VERSION,
})
  .command('package', {
    alias: { out: 'o' },
    args: z.object({ buildRecord: z.string() }),
    options: z.object({ out: z.string() }),
    run: runPackageCommand,
  })
  .command('publish', {
    args: z.object({ manifest: z.string() }),
    env: PublisherCredentialEnvSchema,
    options: z.object({
      ecosystems: z.string().default('all'),
      dryRun: z.boolean().default(false),
    }),
    run: runPublishCommand,
  })
  .command('ship', {
    env: PublisherCredentialEnvSchema,
    options: z.object({
      dryRun: z.boolean().default(false),
    }),
    run: runShipCommand,
  })

if (import.meta.main) await cli.serve(process.argv.slice(2))
