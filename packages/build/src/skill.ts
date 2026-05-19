export const LI_BUILD_SKILL_MARKDOWN = `---
name: li-build
description: Author and maintain lili build contracts
---

# li-build

Use this skill when authoring or maintaining a lili contract and its generated surfaces.

## Contract Model

The build package is a contract compiler, not a second CLI framework. Keep runtime CLIs shaped around \`Cli.create().command()\`; use \`Contract.create(...).operation(...)\` only for owned operation contracts that need generated surfaces.

Write contracts with runtime schema values:

\`\`\`ts
import { Contract, z } from '@lili/build'

export default Contract.create({
  name: 'acme',
  version: '1.0.0',
  remote: {
    baseUrl: { envVar: 'ACME_API_URL' },
    auth: { kind: 'bearer', envVar: 'ACME_TOKEN' },
  },
}).operation({
  id: 'projects.list',
  command: ['projects', 'list'],
  locality: { modes: ['remote'], default: 'remote' },
  input: z.object({ limit: z.number().default(20) }),
  output: z.object({ projects: z.array(z.object({ id: z.string() })) }),
  effects: { kind: 'read' },
  remote: {
    method: 'GET',
    path: '/projects',
    bind: { query: ['limit'] },
  },
})
\`\`\`

Do not author a separate verb. The canonical IR derives the action from the final command segment and checks it against the active vocabulary. Extend vocabulary for product actions such as \`deploy\`, \`publish\`, or \`migrate\`.

\`vocabulary({...})\` extends the defaults. To remove defaults, pass an explicit vocabulary object instead of calling \`vocabulary()\`. Aliases are command-surface metadata; they do not bypass the vocabulary allowlist.

## Commands

- \`li-build generate <contract.ts>\`: generate surfaces next to the contract.
- \`li-build generate <contract.ts> --out <dir>\`: write generated artifacts to a specific directory.
- \`li-build generate <contract.ts> --check\`: fail when generated artifacts are out of sync.

Prefer \`--json\` when another tool or agent will read the result.

## Guidance

- Keep effects explicit. Effects and policy describe safety; command words only describe naming.
- Keep locality honest. If an operation declares \`local\`, provide \`local: { module, export }\`; if it declares \`remote\`, provide a \`remote: { method, path, bind }\` binding.
- Keep remote bindings explicit. OpenAPI generation and conformance need to know which input fields are path, query, header, or body fields.
- If contract-level \`remote\` config is present, set \`remote.baseUrl.envVar\` or \`remote.baseUrl.literal\`.
- Keep local implementation imports as string references in the contract. Generated runtime code imports them when local execution is selected.
- Treat generated artifacts as owned by \`li-build\`; edit the contract, then regenerate.
`

export const LI_BUILD_SKILL_INDEX = `# li-build
Author and maintain lili build contracts.

- Define owned operation contracts with Contract.create(...).operation(...).
- Generate and check surfaces with li-build generate.
- Keep vocabulary configurable, effects explicit, and remote bindings complete.`
