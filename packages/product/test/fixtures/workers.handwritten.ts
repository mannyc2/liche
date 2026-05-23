import { callHttpOperation, createConfig, defineCli, defineCommand, z } from '@lili/core'
import { deploy, dev } from './impl/wrangler.js'

const cli = defineCli({
  name: 'workers',
  version: '1.0.0',
  generated: { machineOutput: 'envelope', disabledGlobals: ['format'] },
  config: createConfig({
    files: ['workers.jsonc', 'workers.yaml', 'workers.toml'],
    schema: z.strictObject({
      accountId: z.string().optional(),
      apiBaseUrl: z.string().default('https://api.cloudflare.test'),
    }),
    scopes: { project: { discoverUpwards: true }, user: { xdg: true } },
  }),
  commands: [
    defineCommand({
      path: ['script', 'list'],
      input: {
        options: z.object({}),
      },
      output: z.array(z.object({
        created_at: z.string().optional(),
        id: z.string(),
        name: z.string(),
      })),
      async run({ ctx }) {
        const remoteBaseUrl = ctx.config['apiBaseUrl']
        if (typeof remoteBaseUrl !== 'string' || remoteBaseUrl.length === 0) {
          return ctx.error({
            code: 'REMOTE_CONFIG_MISSING_BASE_URL',
            code_actions: [{ title: 'Inspect config', argv: ['config', 'doctor'] }],
            message: 'Remote base URL is required.',
            suggested_fix: 'Set apiBaseUrl in config before retrying.',
          })
        }
        const data = await callHttpOperation({
          id: 'script.list',
          baseUrl: remoteBaseUrl,
          auth: { kind: 'none' },
          method: 'GET',
          path: '',
          bind: { body: false },
          input: ctx.options as Record<string, unknown>,
          inputFields: [],
          output: z.array(z.object({
            created_at: z.string().optional(),
            id: z.string(),
            name: z.string(),
          })),
          env: ctx.env as Record<string, string | undefined>,
          requiredPermissions: ['workers:read'],
        })
        const source = ctx.sources.config('apiBaseUrl').kind === 'default' ? 'schema-default' : 'config'
        return ctx.ok(data, { execution: { mode: 'remote-http', source } })
      },
    }),
    defineCommand({
      path: ['deploy'],
      input: {
        options: z.object({
          entrypoint: z.string(),
          environment: z.string().optional(),
        }),
      },
      output: z.object({
        deployment_id: z.string(),
        url: z.string().optional(),
      }),
      async run({ ctx, input }) {
        const data = await deploy(input.options)
        return ctx.ok(data, { execution: { mode: 'hybrid-workflow', source: 'schema-default' } })
      },
    }),
    defineCommand({
      path: ['dev'],
      input: {
        options: z.object({
          entrypoint: z.string(),
        }),
      },
      output: z.object({
        url: z.string(),
      }),
      async run({ ctx, input }) {
        const data = await dev(input.options)
        return ctx.ok(data, { execution: { mode: 'local', source: 'schema-default' } })
      },
    }),
  ],
})

export default cli
