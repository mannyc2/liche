import { describe, expect, test } from 'bun:test'
import * as Api from '../src/index.js'

// Type-only imports: tsc fails if any of these drop from the public index.
// Keep this list in sync with the value snapshot below and with docs/core-api-boundary.md.
import type {
  AuthCredential,
  AuthProviderRuntime,
  Awaitable,
  BuiltinsConfig,
  CliInstance,
  CommandDefinition,
  CommandError,
  ContextRuntime,
  CreateOptions,
  Cta,
  CtaBlock,
  DisabledGlobal,
  Example,
  FetchHandler,
  FieldError,
  Format,
  InferSchema,
  InvocationKind,
  MiddlewareContext,
  MiddlewareHandler,
  OutputPolicy,
  ResolvedAuthMeta,
  Result,
  ResultMeta,
  RunContext,
  Schema,
  SecretString,
  ServeOptions,
  SkillDefinition,
  TokenSourceSpec,
  Usage,
  UsageObject,
} from '../src/index.js'

export type _PublicTypeBag = [
  AuthCredential,
  AuthProviderRuntime,
  Awaitable<unknown>,
  BuiltinsConfig,
  CliInstance,
  CommandDefinition,
  CommandError,
  ContextRuntime,
  CreateOptions,
  Cta,
  CtaBlock,
  DisabledGlobal,
  Example,
  FetchHandler,
  FieldError,
  Format,
  InferSchema<unknown>,
  InvocationKind,
  MiddlewareContext,
  MiddlewareHandler,
  OutputPolicy,
  ResolvedAuthMeta,
  Result,
  ResultMeta,
  RunContext,
  Schema,
  SecretString,
  ServeOptions,
  SkillDefinition,
  TokenSourceSpec,
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
  'applyAuth',
  'authMetaFromCredential',
  'middleware',
  'resolveAuth',
  'resolveContext',
  'secret',
  'z',
].sort()

describe('public API snapshot', () => {
  test('packages/core public value exports match the frozen surface (see docs/core-api-boundary.md)', () => {
    const actual = Object.keys(Api).sort()
    expect(actual).toEqual(FROZEN_PUBLIC_VALUES)
  })
})
