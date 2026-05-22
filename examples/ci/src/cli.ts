#!/usr/bin/env bun
import { Cli, Config, z } from '@lili/core'

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

function config(ctx: { config: Record<string, unknown> }): CliConfig {
  return ctx.config as CliConfig
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return {}
  return JSON.parse(text)
}

async function apiFetch(ctx: { config: Record<string, unknown> }, path: string, init?: RequestInit): Promise<unknown> {
  const baseUrl = config(ctx).apiBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}${path}`, init)
  if (!response.ok) {
    throw new Error(`Shipyard API returned ${response.status}`)
  }
  return readJson(response)
}

const deployments = Cli.create('deployments', {
  description: 'Manage deployments.',
})
  .command('list', {
    description: 'List deployments',
    options: z.object({
      project: z.string().optional(),
    }),
    optionConfig: { project: 'defaultProject' },
    output: z.array(DeploymentSchema),
    async run(ctx) {
      const url = new URL('/deployments', config(ctx).apiBaseUrl)
      if (ctx.options.project) url.searchParams.set('project', ctx.options.project)
      const body = await apiFetch(ctx, `${url.pathname}${url.search}`)
      return z.array(DeploymentSchema).parse(body)
    },
  })
  .command('promote', {
    args: z.object({
      id: z.string(),
    }),
    description: 'Promote a deployment',
    options: z.object({
      environment: z.enum(['staging', 'production']).default('staging'),
    }),
    output: z.object({
      deployment_id: z.string(),
      environment: z.string(),
      url: z.string().optional(),
    }),
    async run(ctx) {
      const body = await apiFetch(ctx, `/deployments/${ctx.args.id}/promote`, {
        body: JSON.stringify({ environment: ctx.options.environment }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      return body
    },
  })

export const cli = Cli.create('shipyard', {
  builtins: { completions: true, mcp: false, skills: false },
  config: Config.object({
    files: ['shipyard.jsonc'],
    schema: CliConfigSchema,
    scopes: { project: { discoverUpwards: true }, user: false },
  }),
  description: 'Inspect and promote application deployments.',
  version: '0.1.0',
}).command(deployments)

if (import.meta.main) await cli.serve(process.argv.slice(2))
