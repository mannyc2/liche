import { Auth, Command, createConfig, Field, Runtime, Shape, defineProduct } from '../../src/index.js'

// Canonical Phase 3B fixture: a Workers-shaped product with one resource
// operation, one hybrid-workflow command, one local command, and one binding.
// Phase 3D-A widens it with an explicit auth posture (Auth.none for now)
// and the `requires` slot that replaced the old `permission?: string`.
export default defineProduct({
  id: 'workers',
  name: 'Workers',
  version: '1.0.0',
  description: 'Build and deploy serverless applications.',
  auth: Auth.none(),
  config: createConfig({
    files: ['workers.jsonc', 'workers.yaml', 'workers.toml'],
    fields: Shape.object({
      apiBaseUrl: Field.string('API base URL').default('https://api.cloudflare.test'),
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
        id: 'workers-cli-1.1.0',
        severity: 'info',
        message: 'Workers CLI 1.1.0 is available on the stable channel.',
        since: '2026-05-21',
      }],
      channels: [{
        id: 'workers-next-channel',
        severity: 'info',
        message: 'Use the next channel for generated remote command previews.',
      }],
      yanks: [{
        id: 'workers-cli-0.9.0',
        severity: 'warning',
        message: 'Workers CLI 0.9.0 was yanked due to a packaging regression.',
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
          examples: [{ command: 'workers script list --json' }],
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
          requires: { permissions: ['workers:read'] },
        },
      },
    },
  },
  commands: {
    deploy: Command.workflow({
      summary: 'Deploy a Worker',
      effects: { kind: 'exec', idempotent: false },
      policy: { dangerous: true, requiresConfirmation: true, conformanceEligible: false },
      examples: [{ command: 'workers deploy --entrypoint src/index.ts --environment preview --json' }],
      input: Shape.object({
        entrypoint: Field.string('Entrypoint file'),
        environment: Field.string('Environment').optional(),
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
    }),
    dev: Command.local({
      summary: 'Run a local development server',
      input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
      output: Shape.object({ url: Field.string('Local URL') }),
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
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
