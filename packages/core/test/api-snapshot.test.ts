import { describe, expect, test } from 'bun:test'
import * as Api from '../src/index.js'

// Type-only imports: tsc fails if any of these drop from the public index.
// Keep this list in sync with the value snapshot below and with docs/core-api-boundary.md.
import type {
  Awaitable,
  BuiltinsConfig,
  CliInstance,
  CommandDefinition,
  CommandError,
  CreateOptions,
  Cta,
  CtaBlock,
  DisabledGlobal,
  Example,
  FetchHandler,
  FieldError,
  Format,
  InferSchema,
  MiddlewareContext,
  MiddlewareHandler,
  OutputPolicy,
  Result,
  ResultMeta,
  RunContext,
  Schema,
  ServeOptions,
  SkillDefinition,
  Usage,
  UsageObject,
} from '../src/index.js'

export type _PublicTypeBag = [
  Awaitable<unknown>,
  BuiltinsConfig,
  CliInstance,
  CommandDefinition,
  CommandError,
  CreateOptions,
  Cta,
  CtaBlock,
  DisabledGlobal,
  Example,
  FetchHandler,
  FieldError,
  Format,
  InferSchema<unknown>,
  MiddlewareContext,
  MiddlewareHandler,
  OutputPolicy,
  Result,
  ResultMeta,
  RunContext,
  Schema,
  ServeOptions,
  SkillDefinition,
  Usage,
  UsageObject,
]

const FROZEN_PUBLIC_VALUES = [
  'BaseError',
  'Cli',
  'Formatter',
  'LiliError',
  'ParseError',
  'ValidationError',
  'middleware',
  'z',
].sort()

describe('public API snapshot', () => {
  test('packages/core public value exports match the frozen surface (see docs/core-api-boundary.md)', () => {
    const actual = Object.keys(Api).sort()
    expect(actual).toEqual(FROZEN_PUBLIC_VALUES)
  })
})
