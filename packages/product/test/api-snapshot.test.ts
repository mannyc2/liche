import { describe, expect, test } from 'bun:test'
import * as Api from '../src/index.js'

const FROZEN_PUBLIC_VALUES = [
  'Auth',
  'Command',
  'Config',
  'DEFAULT_GENERATED_VOCABULARY',
  'Field',
  'FieldBuilder',
  'Product',
  'ResourceBuilder',
  'Runtime',
  'Shape',
  'buildAuthManifest',
  'canonicalDigest',
  'canonicalize',
  'checkAgainstDir',
  'compileProduct',
  'conformProduct',
  'fieldToJsonSchema',
  'generateAgentReference',
  'generateCli',
  'generateCommandManifest',
  'generateConfigSchema',
  'generateDocsReference',
  'generateMcpTools',
  'generateOpenapi',
  'generateToDir',
  'hashString',
  'lintCatalog',
  'normalizeProduct',
  'resolveListShape',
  'shouldGenerateConfigSchema',
  'vocabulary',
  'z',
].sort()

describe('public API snapshot', () => {
  test('packages/product public value exports match the frozen surface', () => {
    expect(Object.keys(Api).sort()).toEqual(FROZEN_PUBLIC_VALUES)
  })
})
