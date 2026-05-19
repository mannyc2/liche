export const LI_BUILD_SKILL_MARKDOWN = `---
name: li-build
description: Author and maintain lili product schemas
---

# li-build

Use this skill when authoring or maintaining a lili product schema and its generated surfaces.

## Product Model

\`@lili/build\` is a product-schema compiler. Author products with sibling resources, commands, and bindings; the build package normalizes them into a canonical capability catalog and projects that catalog into generated surfaces.

\`\`\`ts
import { Command, Field, Product, Shape } from '@lili/build'

export default Product.create({
  id: 'workers',
  name: 'Workers',
  version: '1.0.0',
})
  .resource('script', { label: 'Worker script', path: '/workers/scripts' }, (resource) =>
    resource
      .field('id', Field.string('Script ID').identifier().immutable())
      .field('name', Field.string('Script name').humanLabel())
      .operation('list', {
        summary: 'List Worker scripts',
        http: { method: 'GET', path: '' },
        output: Shape.list('script'),
      }),
  )
  .command('deploy', Command.workflow({
    summary: 'Deploy a Worker',
    input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
    output: Shape.object({ deployment_id: Field.string('Deployment ID') }),
    handler: 'wrangler.deploy',
  }))
  .command('dev', Command.local({
    summary: 'Run a local development server',
    handler: 'wrangler.dev',
  }))
\`\`\`

The verb on a resource operation must be in the product vocabulary. Defaults are \`get\`, \`list\`, \`create\`, \`update\`, \`delete\`, \`run\`. Extend with \`vocabulary({ verbs: [...] })\` for resource-scoped actions such as \`purge\`, \`rotate\`, \`rollback\`. Top-level commands like \`deploy\` and \`dev\` are not subject to the verb allowlist; they live as their own capability kind.

## Commands

- \`li-build generate <product.ts>\`: generate surfaces next to the product schema.
- \`li-build generate <product.ts> --out <dir>\`: write generated artifacts to a specific directory.
- \`li-build generate <product.ts> --check\`: fail when generated artifacts are out of sync.

Prefer \`--json\` when another tool or agent will read the result.

## Guidance

- Pick the right capability kind. CRUD-style nouns belong on a resource; transient operations like \`deploy\`, \`dev\`, \`login\`, \`migrate\`, or \`doctor\` are top-level commands.
- Keep execution mode explicit. \`Command.local\` for purely local handlers, \`Command.remoteHttp\` for pure HTTP calls, \`Command.workflow\` for hybrid workflows that combine local work and HTTP steps.
- Local and hybrid handler strings use the form \`module.export\`; generated code imports the export from \`./impl/<module>.js\`.
- Use \`Shape.list(resourceId)\` to return a list of a declared resource. The catalog keeps the reference; OpenAPI and generators resolve it through the catalog.
- Treat generated artifacts as owned by \`li-build\`; edit the product schema, then regenerate.
`

export const LI_BUILD_SKILL_INDEX = `# li-build
Author and maintain lili product schemas.

- Define product schemas with Product.create(...).resource(...).command(...).binding(...).
- Generate and check surfaces with li-build generate.
- Pick the right capability kind: resources for CRUD, commands for workflows.`
