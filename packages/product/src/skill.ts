export const LI_PRODUCT_SKILL_MARKDOWN = `---
name: liche-product
description: Author and maintain liche product schemas
---

# liche-product

Use this skill when authoring or maintaining a liche product schema and its generated surfaces.

## Product Model

\`@liche/product\` is a product-schema compiler. Author products with sibling resources, commands, and bindings; the product package normalizes them into a canonical capability catalog and projects that catalog into generated surfaces.

\`\`\`ts
import { Command, Field, Shape, defineProduct } from '@liche/product'

export default defineProduct({
  id: 'workers',
  name: 'Workers',
  version: '1.0.0',
  resources: {
    script: {
      label: 'Worker script',
      path: '/workers/scripts',
      fields: {
        id: Field.string('Script ID').identifier().immutable(),
        name: Field.string('Script name').humanLabel(),
      },
      operations: {
        list: {
          summary: 'List Worker scripts',
          http: { method: 'GET', path: '' },
          output: Shape.list('script'),
        },
      },
    },
  },
  commands: {
    deploy: Command.workflow({
      summary: 'Deploy a Worker',
      input: Shape.object({ entrypoint: Field.string('Entrypoint file') }),
      output: Shape.object({ deployment_id: Field.string('Deployment ID') }),
      handler: 'wrangler.deploy',
    }),
    dev: Command.local({
      summary: 'Run a local development server',
      handler: 'wrangler.dev',
    }),
  },
})
\`\`\`

The verb on a resource operation must be in the product vocabulary. Defaults are \`get\`, \`list\`, \`create\`, \`update\`, \`delete\`, \`run\`. Extend with \`vocabulary({ verbs: [...] })\` for resource-scoped actions such as \`purge\`, \`rotate\`, \`rollback\`. Top-level commands like \`deploy\` and \`dev\` are not subject to the verb allowlist; they live as their own capability kind.

## Commands

- \`liche-product generate <product.ts>\`: generate surfaces next to the product schema.
- \`liche-product generate <product.ts> --out <dir>\`: write generated artifacts to a specific directory.
- \`liche-product generate <product.ts> --check\`: fail when generated artifacts are out of sync.
- \`liche-product compile <product.ts>\`: generate the product CLI, then compile it through \`@liche/build\`'s Bun compile spine.

Prefer \`--json\` when another tool or agent will read the result.

## Guidance

- Pick the right capability kind. CRUD-style nouns belong on a resource; transient operations like \`deploy\`, \`dev\`, \`login\`, \`migrate\`, or \`doctor\` are top-level commands.
- Keep execution mode explicit. \`Command.local\` for purely local handlers, \`Command.remoteHttp\` for pure HTTP calls, \`Command.workflow\` for hybrid workflows that combine local work and HTTP steps.
- Local and hybrid handler strings use the form \`module.export\`; generated code imports the export from \`./impl/<module>.js\`.
- Use \`Shape.list(resourceId)\` to return a list of a declared resource. The catalog keeps the reference; OpenAPI and generators resolve it through the catalog.
- Treat generated artifacts as owned by \`liche-product\`; edit the product schema, then regenerate.
`

export const LI_PRODUCT_SKILL_INDEX = `# liche-product
Author and maintain liche product schemas.

- Define product schemas with defineProduct({ resources, commands, bindings }).
- Generate and check surfaces with liche-product generate.
- Pick the right capability kind: resources for CRUD, commands for workflows.`
