import { Command, Field, Product, Shape } from '../../src/index.js'

// Canonical Phase 3B fixture: a Workers-shaped product with one resource
// operation, one hybrid-workflow command, one local command, and one binding.
// Matches the spec example in docs/product-schema.md (deploy's `dry_run` flag
// is omitted to keep the deploy handler trivial for runtime parity tests).
export default Product.create({
  id: 'workers',
  name: 'Workers',
  version: '1.0.0',
  description: 'Build and deploy serverless applications.',
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
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
          permission: 'workers:read',
        }),
  )
  .command(
    'deploy',
    Command.workflow({
      summary: 'Deploy a Worker',
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
      permission: 'workers:edit',
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
