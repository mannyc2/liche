import { describe, expect, test } from 'bun:test'
import {
  Auth,
  Command,
  createConfig,
  DEFAULT_GENERATED_VOCABULARY,
  Field,
  defineProduct,
  lintCatalog,
  normalizeProduct,
  Runtime,
  Shape,
  vocabulary,
} from '../../src/index.js'
import type { ProductDefinition } from '../../src/index.js'

type ProductOverrides = Omit<ProductDefinition, 'id' | 'name' | 'version'> &
  Partial<Pick<ProductDefinition, 'id' | 'name' | 'version'>>

function testProduct(init: ProductOverrides = {}) {
  // Lints are auth-agnostic. Default to Auth.none() so each test stays focused
  // on its lint rule rather than the unrelated Phase 3D-A auth posture.
  return defineProduct({
    id: 'workers',
    name: 'Workers',
    version: '1.0.0',
    auth: Auth.none(),
    ...init,
  })
}

function lintProductInput(init: ProductOverrides = {}) {
  return lintCatalog(normalizeProduct(testProduct(init)))
}

describe('lintCatalog — vocabulary/verb', () => {
  test("resource operation verb 'info' fails vocabulary/verb when not in the active vocabulary", () => {
    const issues = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '/scripts',
          operations: {
            info: {
              summary: 'Info',
              output: Shape.object({ id: Field.string('id') }),
            },
          },
        },
      },
    })
    const issue = issues.find((i) => i.code === 'vocabulary/verb')
    expect(issue).toBeDefined()
    expect(issue?.recommendation).toContain("add 'info'")
  })

  test("default vocabulary verbs ('list','get','create','update','delete','run') are accepted", () => {
    const issues = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '/scripts',
          operations: {
            list: {
              summary: 'List',
              output: Shape.list('script'),
            },
          },
        },
      },
    })
    expect(issues.find((i) => i.code === 'vocabulary/verb')).toBeUndefined()
  })

  test('product vocabulary can extend the verb allowlist for resource operations', () => {
    expect(
      lintProductInput({
        vocabulary: vocabulary({ verbs: ['purge'] }),
        resources: {
          script: {
            label: 'Script',
            path: '/scripts',
            operations: {
              purge: {
                summary: 'Purge',
                output: Shape.object({ purged: Field.boolean('purged') }),
              },
            },
          },
        },
      }).find((i) => i.code === 'vocabulary/verb'),
    ).toBeUndefined()
  })

  test('top-level commands are not subject to the verb allowlist', () => {
    expect(
      lintProductInput({
        commands: {
          deploy: Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }),
        },
      }).find((i) => i.code === 'vocabulary/verb'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — product/id', () => {
  test('product id violating the stable-id pattern fails product/id-stable', () => {
    expect(lintProductInput({ id: 'Workers!' }).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })

  test('empty product version fails product/version-required', () => {
    expect(lintProductInput({ version: '' }).find((i) => i.code === 'product/version-required')).toBeDefined()
  })
})

describe('lintCatalog — resource/path', () => {
  test('resource with empty path fails resource/path-required', () => {
    expect(
      lintProductInput({
        resources: {
          script: {
            label: 'Script',
            path: '',
            operations: {
              list: {
                summary: 'List',
                output: Shape.list('script'),
              },
            },
          },
        },
      }).find((i) => i.code === 'resource/path-required'),
    ).toBeDefined()
  })
})

describe('lintCatalog — surface/openapi-on-local', () => {
  test('local command opted into surfaces.openapi fails the lint', () => {
    expect(
      lintProductInput({
        commands: {
          dev: Command.local({
            summary: 'Dev',
            handler: 'wrangler.dev',
            surfaces: { openapi: true },
          }),
        },
      }).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeDefined()
  })

  test('local command without surfaces.openapi passes', () => {
    expect(
      lintProductInput({
        commands: {
          dev: Command.local({ summary: 'Dev', handler: 'wrangler.dev' }),
        },
      }).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — command/execution-coherent', () => {
  test('hybrid-workflow opted into OpenAPI without an http trigger fails', () => {
    expect(
      lintProductInput({
        commands: {
          deploy: Command.workflow({
            summary: 'Deploy',
            handler: 'wrangler.deploy',
            surfaces: { openapi: true },
          }),
        },
      }).find((i) => i.code === 'command/execution-coherent'),
    ).toBeDefined()
  })

  test('hybrid-workflow with http trigger and surfaces.openapi=true passes', () => {
    expect(
      lintProductInput({
        commands: {
          deploy: Command.workflow({
            summary: 'Deploy',
            handler: 'wrangler.deploy',
            http: { method: 'POST', path: '/deploy' },
            surfaces: { openapi: true },
          }),
        },
      }).find((i) => i.code === 'command/execution-coherent'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — shape/unknown-resource-ref', () => {
  test('Shape.list pointing at an undeclared resource fails the lint', () => {
    expect(
      lintProductInput({
        resources: {
          script: {
            label: 'Script',
            path: '/scripts',
            operations: {
              list: {
                summary: 'List',
                output: Shape.list('ghost'),
              },
            },
          },
        },
      }).find((i) => i.code === 'shape/unknown-resource-ref'),
    ).toBeDefined()
  })

  test('Shape.list pointing at a declared resource passes', () => {
    expect(
      lintProductInput({
        resources: {
          script: {
            label: 'Script',
            path: '/scripts',
            operations: {
              list: {
                summary: 'List',
                output: Shape.list('script'),
              },
            },
          },
        },
      }).find((i) => i.code === 'shape/unknown-resource-ref'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — config/runtime', () => {
  test('secret fields in general config fail config/no-secret-fields', () => {
    expect(
      lintProductInput({
        config: createConfig({
          fields: Shape.object({ apiToken: Field.string('API token').secret() }),
        }),
      }).find((i) => i.code === 'config/no-secret-fields'),
    ).toBeDefined()
  })

  test('remote baseUrl must reference a declared config field when config-backed', () => {
    const issue = lintProductInput({
      config: createConfig({
        fields: Shape.object({ apiBaseUrl: Field.string('API base URL') }),
      }),
      remote: { baseUrl: Runtime.config('missingBaseUrl') },
    }).find((i) => i.code === 'catalog/remote-base-url')
    expect(issue?.message).toContain("unknown config field 'missingBaseUrl'")
  })

  test('HTTP resource operations require a product remote base URL', () => {
    const issue = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '/scripts',
          operations: {
            list: {
              summary: 'List',
              http: { method: 'GET', path: '/scripts' },
              output: Shape.list('script'),
            },
          },
        },
      },
    }).find((i) => i.code === 'catalog/remote-required')
    expect(issue).toEqual({
      code: 'catalog/remote-required',
      path: 'capabilities[0].http',
      message: "HTTP capability 'script.list' requires product remote.baseUrl",
      recommendation: 'declare defineProduct({ remote: { baseUrl: Runtime.literal/env/config(...) } })',
    })
  })

  test('remote-http commands require a product remote base URL', () => {
    const issue = lintProductInput({
      commands: {
        purge: Command.remoteHttp({
          summary: 'Purge',
          http: { method: 'POST', path: '/purge' },
        }),
      },
    }).find((i) => i.code === 'catalog/remote-required')
    expect(issue?.path).toBe('capabilities[0].execution.http')
    expect(issue?.message).toBe("HTTP capability 'purge' requires product remote.baseUrl")
  })
})

describe('lintCatalog — clean product', () => {
  test('workers-style product with resource + workflow + local command produces no issues', () => {
    expect(
      lintProductInput({
        remote: { baseUrl: Runtime.literal('https://api.example.test') },
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
                effects: { kind: 'read', idempotent: true },
                policy: { conformanceEligible: true },
                examples: [{ command: 'workers script list --json' }],
                http: { method: 'GET', path: '' },
                output: Shape.list('script'),
              },
            },
          },
        },
        commands: {
          deploy: Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }),
          dev: Command.local({ summary: 'Dev', handler: 'wrangler.dev' }),
        },
      }),
    ).toEqual([])
  })
})

describe('lintCatalog — capability safety metadata', () => {
  test('agent or conformance visible capabilities must declare effects, policy, and examples', () => {
    expect(
      lintProductInput({
        remote: { baseUrl: Runtime.literal('https://api.example.test') },
        commands: {
          deploy: Command.remoteHttp({
            summary: 'Deploy',
            http: { method: 'POST', path: '/deploy' },
            surfaces: { agent: true },
          }),
        },
      }).map((issue) => issue.code),
    ).toEqual(['capability/effects-required', 'capability/policy-required', 'capability/examples-required'])
  })

  test('dangerous and delete capabilities require consistent policy flags', () => {
    expect(
      lintProductInput({
        remote: { baseUrl: Runtime.literal('https://api.example.test') },
        commands: {
          deleteCache: Command.remoteHttp({
            summary: 'Delete cache',
            effects: { kind: 'delete' },
            policy: { dangerous: false, requiresConfirmation: false, conformanceEligible: true },
            examples: [{ command: 'workers delete-cache --json' }],
            http: { method: 'DELETE', path: '/cache' },
            surfaces: { agent: true },
          }),
        },
      }).filter((issue) => issue.code === 'capability/policy-inconsistent'),
    ).toEqual([
      {
        code: 'capability/policy-inconsistent',
        path: 'capabilities[0].policy.dangerous',
        message: "Delete capability 'deleteCache' must be marked dangerous",
      },
    ])
  })
})

describe('lintCatalog — issue shape (code, path, message, recommendation)', () => {
  test('product/id-required has the expected code, path, and message', () => {
    const issue = lintProductInput({ id: '' }).find((i) => i.code === 'product/id-required')
    expect(issue).toEqual({
      code: 'product/id-required',
      path: 'product.id',
      message: 'Product id must be a non-empty string',
    })
  })

  test('product/version-required has the expected code, path, and message', () => {
    const issue = lintProductInput({ version: '' }).find((i) => i.code === 'product/version-required')
    expect(issue).toEqual({
      code: 'product/version-required',
      path: 'product.version',
      message: 'Product version must be a non-empty string',
    })
  })

  test('product/id-stable mentions the offending id in the message', () => {
    const issue = lintProductInput({ id: 'Workers!' }).find((i) => i.code === 'product/id-stable')
    expect(issue?.path).toBe('product.id')
    expect(issue?.message).toBe("Product id 'Workers!' does not match the stable id pattern")
  })

  test('resource/path-required has the expected code, path, and message', () => {
    const issue = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '',
          operations: { list: { summary: 'List', output: Shape.list('script') } },
        },
      },
    }).find((i) => i.code === 'resource/path-required')
    expect(issue?.path).toBe('resources[0].path')
    expect(issue?.message).toBe("Resource 'script' must declare a non-empty path")
  })

  test('resource/id-stable fires for invalid resource ids and includes the id', () => {
    const issue = lintProductInput({
      resources: {
        'Bad!': {
          label: 'Bad',
          path: '/bad',
          operations: { list: { summary: 'List', output: Shape.list('Bad!') } },
        },
      },
    }).find((i) => i.code === 'resource/id-stable')
    expect(issue?.path).toBe('resources[0].id')
    expect(issue?.message).toBe("Resource id 'Bad!' does not match the stable id pattern")
  })

  test('vocabulary/verb issue includes recommendation listing the active verbs', () => {
    const issue = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '/scripts',
          operations: {
            info: {
              summary: 'Info',
              output: Shape.list('script'),
            },
          },
        },
      },
    }).find((i) => i.code === 'vocabulary/verb')
    expect(issue?.path).toBe('capabilities[0].verb')
    expect(issue?.message).toBe("Resource operation verb 'info' is not in the product vocabulary")
    expect(issue?.recommendation).toBe(
      "add 'info' to vocabulary({ verbs: [...] }) or use one of: get, list, create, update, delete, run",
    )
  })

  test('surface/openapi-on-local has the expected path and message', () => {
    const issue = lintProductInput({
      commands: {
        dev: Command.local({
          summary: 'Dev',
          handler: 'wrangler.dev',
          surfaces: { openapi: true },
        }),
      },
    }).find((i) => i.code === 'surface/openapi-on-local')
    expect(issue?.path).toBe('capabilities[0].surfaces.openapi')
    expect(issue?.message).toBe(
      "Local command 'dev' must not appear in OpenAPI; remove surfaces.openapi or change execution mode",
    )
  })

  test('command/execution-coherent has the expected path, message, and recommendation', () => {
    const issue = lintProductInput({
      commands: {
        deploy: Command.workflow({
          summary: 'Deploy',
          handler: 'wrangler.deploy',
          surfaces: { openapi: true },
        }),
      },
    }).find((i) => i.code === 'command/execution-coherent')
    expect(issue?.path).toBe('capabilities[0].execution.http')
    expect(issue?.message).toBe("Hybrid-workflow command 'deploy' opted into OpenAPI but has no http trigger")
    expect(issue?.recommendation).toBe('declare http: { method, path } on the workflow or set surfaces.openapi=false')
  })

  test('command/id-stable fires for invalid command ids and includes the id', () => {
    const issue = lintProductInput({
      commands: {
        'Bad-Id!': Command.local({ summary: 'Bad', handler: 'wrangler.bad' }),
      },
    }).find((i) => i.code === 'command/id-stable')
    expect(issue?.path).toBe('capabilities[0].id')
    expect(issue?.message).toBe("Command id 'Bad-Id!' does not match the stable id pattern")
  })

  test('shape/unknown-resource-ref has the expected path, message, and recommendation', () => {
    const issue = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '/scripts',
          operations: { list: { summary: 'List', output: Shape.list('ghost') } },
        },
      },
    }).find((i) => i.code === 'shape/unknown-resource-ref')
    expect(issue?.path).toBe('capabilities[0].output')
    expect(issue?.message).toBe("Shape.list references unknown resource 'ghost'")
    expect(issue?.recommendation).toBe('declare the resource in defineProduct({ resources }) or fix the reference')
  })
})

describe('lintCatalog — hasText whitespace handling', () => {
  test('product id with only whitespace fails product/id-required (trim is not skipped)', () => {
    expect(lintProductInput({ id: '   ', name: 'W' }).find((i) => i.code === 'product/id-required')).toBeDefined()
  })

  test('product version with only whitespace fails product/version-required', () => {
    expect(
      lintProductInput({ name: 'W', version: '   ' }).find((i) => i.code === 'product/version-required'),
    ).toBeDefined()
  })

  test('resource path with only whitespace fails resource/path-required', () => {
    expect(
      lintProductInput({
        name: 'W',
        resources: {
          script: {
            label: 'Script',
            path: '   ',
            operations: { list: { summary: 'List', output: Shape.list('script') } },
          },
        },
      }).find((i) => i.code === 'resource/path-required'),
    ).toBeDefined()
  })
})

describe('lintCatalog — surface/openapi-on-local is local-mode-only', () => {
  test('workflow command with openapi=true does NOT trip surface/openapi-on-local (only local-mode does)', () => {
    expect(
      lintProductInput({
        name: 'W',
        commands: {
          deploy: Command.workflow({
            summary: 'Deploy',
            handler: 'wrangler.deploy',
            http: { method: 'POST', path: '/deploy' },
            surfaces: { openapi: true },
          }),
        },
      }).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeUndefined()
  })

  test('workflow command without openapi opt-in does NOT trip surface/openapi-on-local', () => {
    expect(
      lintProductInput({
        name: 'W',
        commands: {
          deploy: Command.workflow({ summary: 'Deploy', handler: 'wrangler.deploy' }),
        },
      }).find((i) => i.code === 'surface/openapi-on-local'),
    ).toBeUndefined()
  })
})

describe('lintCatalog — ID_PATTERN edge cases', () => {
  test('uppercase-start ids fail (anchors on ^)', () => {
    expect(lintProductInput({ id: 'Workers', name: 'W' }).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })

  test('ids with trailing junk fail (anchors on $)', () => {
    expect(lintProductInput({ id: 'workers!', name: 'W' }).find((i) => i.code === 'product/id-stable')).toBeDefined()
  })

  test('valid ids with dot or dash separators and multi-char segments pass', () => {
    const issues = lintProductInput({
      id: 'workers.platform',
      name: 'W',
      resources: {
        'cli-tool': {
          label: 'CLI',
          path: '/cli',
          operations: { list: { summary: 'List', output: Shape.list('cli-tool') } },
        },
      },
      commands: {
        'sub.command': Command.local({ summary: 'Sub', handler: 'h' }),
      },
    })
    expect(issues.find((i) => i.code === 'product/id-stable')).toBeUndefined()
    expect(issues.find((i) => i.code === 'resource/id-stable')).toBeUndefined()
    expect(issues.find((i) => i.code === 'command/id-stable')).toBeUndefined()
  })

  test('ids with consecutive separators (no segment in between) fail', () => {
    expect(
      lintProductInput({ id: 'workers..platform', name: 'W' }).find((i) => i.code === 'product/id-stable'),
    ).toBeDefined()
  })
})

describe('lintCatalog — operation/output-required and isNonEmptyShape', () => {
  test('operation with an object output that has zero properties fails operation/output-required', () => {
    const issue = lintProductInput({
      resources: {
        script: {
          label: 'Script',
          path: '/scripts',
          operations: { list: { summary: 'List', output: Shape.object({}) } },
        },
      },
    }).find((i) => i.code === 'operation/output-required')
    expect(issue?.path).toBe('capabilities[0].output')
    expect(issue?.message).toBe("Resource operation 'script.list' must declare a non-empty output schema")
  })

  test('operation with a non-empty object output does NOT fail operation/output-required', () => {
    expect(
      lintProductInput({
        resources: {
          script: {
            label: 'Script',
            path: '/scripts',
            operations: {
              list: {
                summary: 'List',
                output: Shape.object({ id: Field.string('id') }),
              },
            },
          },
        },
      }).find((i) => i.code === 'operation/output-required'),
    ).toBeUndefined()
  })

  test('operation with a list output is treated as non-empty (kind === "list" short-circuit)', () => {
    expect(
      lintProductInput({
        resources: {
          script: {
            label: 'Script',
            path: '/scripts',
            operations: { list: { summary: 'List', output: Shape.list('script') } },
          },
        },
      }).find((i) => i.code === 'operation/output-required'),
    ).toBeUndefined()
  })
})

describe('vocabulary() — merge semantics', () => {
  test('no overrides returns defaults by identity for verbs and flags', () => {
    const v = vocabulary()
    expect(v.verbs).toBe(DEFAULT_GENERATED_VOCABULARY.verbs)
    expect(v.flags).toBe(DEFAULT_GENERATED_VOCABULARY.flags)
    expect(v.aliases).toEqual({})
  })

  test('empty-array override returns the default list by identity (mergeUnique short-circuit)', () => {
    const v = vocabulary({ verbs: [], flags: [] })
    expect(v.verbs).toBe(DEFAULT_GENERATED_VOCABULARY.verbs)
    expect(v.flags).toBe(DEFAULT_GENERATED_VOCABULARY.flags)
  })

  test('non-empty override appends to the defaults and preserves the default order', () => {
    const v = vocabulary({ verbs: ['purge', 'inspect'] })
    expect(v.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs, 'purge', 'inspect'])
  })

  test('override entries that duplicate a default are deduped (Set guard)', () => {
    const v = vocabulary({ verbs: ['get', 'purge', 'list'] })
    expect(v.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs, 'purge'])
  })

  test('override entries that duplicate each other are deduped against the running set', () => {
    const v = vocabulary({ verbs: ['purge', 'purge', 'inspect', 'purge'] })
    expect(v.verbs).toEqual([...DEFAULT_GENERATED_VOCABULARY.verbs, 'purge', 'inspect'])
  })

  test('aliases override merges into default aliases (not replaces)', () => {
    const v = vocabulary({ aliases: { ls: 'list', rm: 'delete' } })
    expect(v.aliases).toEqual({ ls: 'list', rm: 'delete' })
    expect(Object.keys(v.aliases).sort()).toEqual(['ls', 'rm'])
  })

  test('aliases override with later keys wins over earlier defaults of the same key', () => {
    const v = vocabulary({ aliases: { ls: 'list' } })
    expect(v.aliases.ls).toBe('list')
  })

  test('undefined aliases override yields an empty aliases object, not undefined', () => {
    const v = vocabulary({ verbs: ['purge'] })
    expect(v.aliases).toEqual({})
    expect(typeof v.aliases).toBe('object')
  })
})
