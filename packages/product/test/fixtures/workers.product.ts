import { Auth, Command, Config, Field, Product, Runtime, Shape } from '../../src/index.js'

// Canonical Phase 3B fixture: a Workers-shaped product with one resource
// operation, one hybrid-workflow command, one local command, and one binding.
// Phase 3D-A widens it with an explicit auth posture (Auth.none for now)
// and the `requires` slot that replaced the old `permission?: string`.
export default Product.create({
  id: 'workers',
  name: 'Workers',
  version: '1.0.0',
  description: 'Build and deploy serverless applications.',
})
  .auth(Auth.none())
  .config(Config.object({
    files: ['workers.jsonc', 'workers.yaml', 'workers.toml'],
    fields: Shape.object({
      apiBaseUrl: Field.string('API base URL').default('https://api.cloudflare.test'),
      accountId: Field.string('Default account ID').optional(),
    }),
    scopes: { project: { discoverUpwards: true }, user: { xdg: true } },
  }))
  .remote({ baseUrl: Runtime.config('apiBaseUrl') })
  .permissions({
    'workers:read': Auth.permission.scope('workers.read'),
    'workers:edit': Auth.permission.scope('workers.edit'),
  })
  .resource(
    'script',
    { label: 'Worker script', path: '/workers/scripts', scope: 'account' },
    (resource) =>
      resource
        .field('id', Field.string('Script ID').identifier().immutable())
        .field('name', Field.string('Script name').humanLabel())
        .field('created_at', Field.datetime('Creation time').immutable().optional())
        .operation('list', {
          summary: 'List Worker scripts',
          effects: { kind: 'read', idempotent: true },
          policy: { conformanceEligible: true },
          examples: [{ command: 'workers script list --json' }],
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
          requires: { permissions: ['workers:read'] },
        }),
  )
  .command(
    'deploy',
    Command.workflow({
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
  )
  .command(
    'dev',
    Command.local({
      summary: 'Run a local development server',
      input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
      output: Shape.object({ url: Field.string('Local URL') }),
      handler: 'wrangler.dev',
      needs: ['filesystem', 'runtime'],
    }),
  )
  .binding({
    key: 'kv_namespaces',
    doc: 'KV namespaces bound to the Worker.',
    fields: Shape.object({
      binding: Field.string('Variable name in code'),
      id: Field.string('KV namespace id'),
    }),
  })
