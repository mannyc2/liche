#!/usr/bin/env bun
import { defineCli, defineCommand, z } from '@liche/core'
import { completions, config, configDoctor } from '@liche/extensions'

const DeploymentSchema = z.object({
  id: z.string(),
  project: z.string(),
  environment: z.enum(['preview', 'staging', 'production']),
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  url: z.string().optional(),
})

const CliConfigSchema = z.object({
  apiBaseUrl: z.string().url().default('https://api.shipyard.example.com'),
  defaultProject: z.string().optional(),
}).strict()

type CliConfig = z.infer<typeof CliConfigSchema>

function cliConfig(ctx: { config: Record<string, unknown> }): CliConfig {
  return ctx.config as CliConfig
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return {}
  return JSON.parse(text)
}

async function apiFetch(ctx: { config: Record<string, unknown> }, path: string, init?: RequestInit): Promise<unknown> {
  const baseUrl = cliConfig(ctx).apiBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}${path}`, init)
  if (!response.ok) {
    throw new Error(`Shipyard API returned ${response.status}`)
  }
  return readJson(response)
}

export const cli = defineCli({
  commands: [
    defineCommand({
      path: ['deployments'],
      summary: 'Manage deployments.',
    }),
    defineCommand({
      path: ['deployments', 'list'],
      description: 'List deployments',
      input: {
        config: { project: 'defaultProject' },
        options: z.object({
          project: z.string().optional(),
        }),
      },
      output: z.array(DeploymentSchema),
      async run({ ctx, input }) {
        const url = new URL('/deployments', cliConfig(ctx).apiBaseUrl)
        if (input.options.project) url.searchParams.set('project', input.options.project)
        const body = await apiFetch(ctx, `${url.pathname}${url.search}`)
        return z.array(DeploymentSchema).parse(body)
      },
    }),
    defineCommand({
      path: ['deployments', 'promote'],
      description: 'Promote a deployment',
      input: {
        args: z.object({
          id: z.string(),
        }),
        options: z.object({
          environment: z.enum(['staging', 'production']).default('staging'),
        }),
      },
      output: z.object({
        deployment_id: z.string(),
        environment: z.string(),
        url: z.string().optional(),
      }),
      async run({ ctx, input }) {
        const body = await apiFetch(ctx, `/deployments/${input.args.id}/promote`, {
          body: JSON.stringify({ environment: input.options.environment }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
        return body
      },
    }),
  ],
  description: 'Inspect and promote application deployments.',
  extensions: [
    completions(),
    config({
      files: ['shipyard.jsonc'],
      schema: CliConfigSchema,
      scopes: { project: { discoverUpwards: true }, user: false },
    }),
    configDoctor(),
  ],
  name: 'shipyard',
  version: '0.1.0',
})

if (import.meta.main) await cli.serve(process.argv.slice(2))
