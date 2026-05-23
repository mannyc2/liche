import { Auth, Command, createConfig, Field, Runtime, Shape, defineProduct } from '@lili/product'

export default defineProduct({
  id: 'workers',
  name: 'Workers',
  version: '0.1.0',
  description: 'Build and deploy serverless applications.',
  scope: { kind: 'account', param: 'account_id' },
  auth: Auth.none(),
  config: createConfig({
    files: ['workers.jsonc', 'workers.yaml', 'workers.toml'],
    fields: Shape.object({
      apiBaseUrl: Field.string('API base URL').default('https://api.workers.example.test'),
      accountId: Field.string('Default account ID').optional(),
    }),
    scopes: { project: { discoverUpwards: true }, user: { xdg: true } },
  }),
  remote: { baseUrl: Runtime.config('apiBaseUrl') },
  ops: {
    doctor: { packageManagers: ['bun', 'npm'] },
    telemetry: {
      enabledEnvVar: 'WORKERS_TELEMETRY',
      fileEnvVar: 'WORKERS_TELEMETRY_FILE',
    },
    notices: {
      updates: [{
        id: 'workers-cli-0.2.0',
        severity: 'info',
        message: 'Workers CLI 0.2.0 is available on the stable channel.',
        since: '2026-05-21',
      }],
      channels: [{
        id: 'workers-next',
        severity: 'info',
        message: 'Use the next channel for generated remote command previews.',
      }],
      yanks: [{
        id: 'workers-cli-0.1.0',
        severity: 'warning',
        message: 'Workers CLI 0.1.0 was yanked due to a packaging regression.',
      }],
    },
    release: {
      version: '0.1.0',
      latestVersion: '0.2.0',
      channel: 'stable',
      createdAt: '2026-05-23T12:00:00Z',
      install: [
        { manager: 'bun', command: 'bun add -g @workers/cli' },
        { manager: 'npm', command: 'npm install -g @workers/cli' },
      ],
      packages: [{
        id: 'npm.umbrella',
        ecosystem: 'npm',
        kind: 'umbrella',
        name: '@workers/cli',
        version: '0.1.0',
        channel: 'latest',
      }],
      yankedVersions: [{
        id: 'workers-cli-0.1.0',
        version: '0.1.0',
        severity: 'warning',
        message: 'Workers CLI 0.1.0 was yanked due to a packaging regression.',
      }],
    },
  },
  permissions: {
    'workers:read': Auth.permission.scope('workers.read'),
    'workers:edit': Auth.permission.scope('workers.edit'),
  },
  resources: {
    script: {
      label: 'Worker script',
      path: '/workers/scripts',
      doc: 'A deployed Worker script.',
      scope: 'account',
      fields: {
        id: Field.string('Script ID').identifier().immutable(),
        name: Field.string('Script name').humanLabel(),
        created_at: Field.datetime('Creation time').immutable().optional(),
      },
      operations: {
        list: {
          summary: 'List Worker scripts',
          effects: { kind: 'read', idempotent: true },
          policy: { conformanceEligible: true },
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
          requires: { permissions: ['workers:read'] },
          surfaces: { agent: true },
        },
      },
    },
  },
  commands: {
    deploy: Command.workflow({
      summary: 'Deploy a Worker',
      input: Shape.object({
        entrypoint: Field.string('Entrypoint file'),
        environment: Field.string('Environment').optional().default('preview'),
      }),
      output: Shape.object({
        deployment_id: Field.string('Deployment ID'),
        url: Field.string('Deployment URL').optional(),
      }),
      handler: 'wrangler.deploy',
      steps: [
        { id: 'bundle', label: 'Bundle local source', uses: 'local' },
        { id: 'upload', label: 'Upload assets', uses: 'api' },
      ],
      requires: { permissions: ['workers:edit'] },
      surfaces: {
        agent: true,
        dashboard: { view: 'action', placement: 'page' },
      },
    }),
    dev: Command.local({
      summary: 'Run a local development server',
      input: Shape.object({
        entrypoint: Field.string('Entrypoint file'),
        port: Field.int('Port').optional().default(8787),
      }),
      output: Shape.object({ url: Field.string('Local URL') }),
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
      surfaces: { agent: false, openapi: false },
    }),
  },
  bindings: {
    kv_namespaces: {
      doc: 'KV namespaces bound to the Worker.',
      fields: Shape.object({
        binding: Field.string('Variable name in code'),
        id: Field.string('KV namespace id'),
      }),
    },
  },
})
