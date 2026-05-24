import { describe, expect, test } from 'bun:test'
import {
  BaseError,
  LicheError,
  ParseError,
  ValidationError,
  commandError,
  fail,
  isRuntimeResult,
  ok,
  toCommandError,
} from '../src/errors/error.js'

describe('error class names', () => {
  test.each([
    ['BaseError', new BaseError('m'), 'Liche.BaseError'],
    ['LicheError', new LicheError({ code: 'X', message: 'm' }), 'Liche.LicheError'],
    ['ValidationError', new ValidationError({ message: 'm' }), 'Liche.ValidationError'],
    ['ParseError', new ParseError({ message: 'm' }), 'Liche.ParseError'],
  ])('%s.name is %s', (_label, err, expected) => {
    expect(err.name).toBe(expected)
  })
})

describe('cause preservation', () => {
  test('ValidationError preserves cause on the Error chain', () => {
    const cause = new Error('root')
    const err = new ValidationError({ message: 'bad', cause })
    expect(err.cause).toBe(cause)
  })

  test('ParseError preserves cause on the Error chain', () => {
    const cause = new Error('root')
    const err = new ParseError({ message: 'bad', cause })
    expect(err.cause).toBe(cause)
  })

  test('LicheError preserves cause and exposes via walk', () => {
    const cause = new Error('underlying')
    const err = new LicheError({ code: 'X', message: 'top', cause })
    expect(err.walk()).toBe(cause)
  })
})

describe('BaseError', () => {
  test('shortMessage and details are exposed; message includes both when cause is Error', () => {
    const cause = new Error('downstream failed')
    const err = new BaseError('something broke', { cause })
    expect(err.shortMessage).toBe('something broke')
    expect(err.details).toBe('downstream failed')
    expect(err.message).toBe('something broke\n\nDetails: downstream failed')
  })

  test('without cause: message equals shortMessage; details is undefined', () => {
    const err = new BaseError('plain')
    expect(err.shortMessage).toBe('plain')
    expect(err.details).toBeUndefined()
    expect(err.message).toBe('plain')
  })

  test('preserves cause on the Error chain', () => {
    const cause = new Error('root')
    const err = new BaseError('wrap', { cause })
    expect(err.cause).toBe(cause)
  })

  test('walk() without fn returns deepest cause in a 3-link chain', () => {
    const root = new Error('root')
    const mid = new BaseError('mid', { cause: root })
    const top = new BaseError('top', { cause: mid })
    expect(top.walk()).toBe(root)
  })

  test('walk() with no cause returns the error itself', () => {
    const err = new BaseError('alone')
    expect(err.walk()).toBe(err)
  })

  test('walk(fn) returns the first cause matching the predicate, not the error itself', () => {
    const root = new Error('root')
    const mid = new BaseError('mid', { cause: root })
    const top = new BaseError('top', { cause: mid })
    expect(top.walk((e) => e === mid)).toBe(mid)
    expect(top.walk((e) => e === root)).toBe(root)
  })

  test('walk(fn) returns undefined when nothing matches', () => {
    const top = new BaseError('top', { cause: new Error('root') })
    expect(top.walk(() => false)).toBeUndefined()
  })

  test('walk(fn) does NOT match the error itself, only causes', () => {
    const top = new BaseError('top', { cause: new Error('root') })
    expect(top.walk((e) => e === top)).toBeUndefined()
  })
})

describe('LicheError', () => {
  test('retryable defaults to false (not true)', () => {
    const err = new LicheError({ code: 'X', message: 'y' })
    expect(err.retryable).toBe(false)
  })

  test('retryable=true is preserved', () => {
    const err = new LicheError({ code: 'X', message: 'y', retryable: true })
    expect(err.retryable).toBe(true)
  })

  test('exitCode is undefined by default', () => {
    const err = new LicheError({ code: 'X', message: 'y' })
    expect(err.exitCode).toBeUndefined()
  })

  test('exposes code, hint, exitCode verbatim', () => {
    const err = new LicheError({ code: 'BOOM', message: 'msg', hint: 'try again', exitCode: 7 })
    expect(err.code).toBe('BOOM')
    expect(err.hint).toBe('try again')
    expect(err.exitCode).toBe(7)
  })

  test('preserves problem-details and code-action fields', () => {
    const err = new LicheError({
      code: 'AUTH_MISSING',
      message: 'auth required',
      code_actions: [{ title: 'Login', command: 'app login' }],
      detail: 'Set a token or log in.',
      instance: 'urn:liche:command:deploy',
      retry_after: 30,
      status: 401,
      suggested_fix: 'Run app login.',
      title: 'Authentication required',
      type: 'urn:problem:auth-missing',
    })
    expect(err.code_actions).toEqual([{ title: 'Login', command: 'app login' }])
    expect(err.detail).toBe('Set a token or log in.')
    expect(err.instance).toBe('urn:liche:command:deploy')
    expect(err.retry_after).toBe(30)
    expect(err.status).toBe(401)
    expect(err.suggested_fix).toBe('Run app login.')
    expect(err.title).toBe('Authentication required')
    expect(err.type).toBe('urn:problem:auth-missing')
  })

  test('preserves cause', () => {
    const cause = new Error('root')
    const err = new LicheError({ code: 'X', message: 'y', cause })
    expect(err.cause).toBe(cause)
  })
})

describe('ValidationError', () => {
  test('fieldErrors defaults to []', () => {
    const err = new ValidationError({ message: 'bad' })
    expect(err.fieldErrors).toEqual([])
  })

  test('fieldErrors preserved when supplied', () => {
    const err = new ValidationError({
      message: 'bad',
      fieldErrors: [{ path: '$.a', message: 'required', missing: true }],
    })
    expect(err.fieldErrors).toEqual([{ path: '$.a', message: 'required', missing: true }])
  })
})

describe('ParseError', () => {
  test('shortMessage round-trips', () => {
    const err = new ParseError({ message: 'cannot parse' })
    expect(err.shortMessage).toBe('cannot parse')
    expect(err.name).toBe('Liche.ParseError')
  })
})

describe('toCommandError', () => {
  test('ValidationError → VALIDATION_ERROR object with fieldErrors and exitCode=1', () => {
    const err = new ValidationError({
      message: 'bad',
      fieldErrors: [{ path: '$.a', message: 'required' }],
    })
    expect(toCommandError(err)).toEqual({
      code: 'VALIDATION_ERROR',
      detail: 'bad',
      exitCode: 1,
      fieldErrors: [{ path: '$.a', message: 'required' }],
      message: 'bad',
      title: 'Validation Error',
      type: 'urn:liche:error:validation-error',
    })
  })

  test('ParseError → PARSE_ERROR object with exitCode=1', () => {
    const err = new ParseError({ message: 'bad config' })
    expect(toCommandError(err)).toEqual({
      code: 'PARSE_ERROR',
      detail: 'bad config',
      exitCode: 1,
      message: 'bad config',
      title: 'Parse Error',
      type: 'urn:liche:error:parse-error',
    })
  })

  test('LicheError default exitCode is 1', () => {
    const err = new LicheError({ code: 'X', message: 'y' })
    const obj = toCommandError(err)
    expect(obj.exitCode).toBe(1)
  })

  test('LicheError preserves custom exitCode (does NOT coerce to 1)', () => {
    const err = new LicheError({ code: 'X', message: 'y', exitCode: 7 })
    const obj = toCommandError(err)
    expect(obj.exitCode).toBe(7)
  })

  test('LicheError object carries code, hint, retryable, message', () => {
    const err = new LicheError({ code: 'BOOM', message: 'm', hint: 'h', retryable: true, exitCode: 2 })
    expect(toCommandError(err)).toEqual({
      code: 'BOOM',
      detail: 'm',
      exitCode: 2,
      hint: 'h',
      message: 'm',
      retryable: true,
      title: 'Boom',
      type: 'urn:liche:error:boom',
    })
  })

  test('LicheError object carries problem details and recovery actions', () => {
    const err = new LicheError({
      code: 'REMOTE_TIMEOUT',
      message: 'Timed out.',
      code_actions: [{ title: 'Retry', command: 'app deploy --retry' }],
      detail: 'The deployment API timed out after 10 seconds.',
      details: { timeoutMs: 10_000 },
      instance: 'urn:liche:command:deploy',
      retry_after: 10,
      retryable: true,
      status: 504,
      suggested_fix: 'Retry the command after the service recovers.',
      title: 'Remote timeout',
      type: 'https://liche.dev/problems/remote-timeout',
    })
    expect(toCommandError(err)).toEqual({
      code: 'REMOTE_TIMEOUT',
      code_actions: [{ title: 'Retry', command: 'app deploy --retry' }],
      detail: 'The deployment API timed out after 10 seconds.',
      details: { timeoutMs: 10_000 },
      exitCode: 1,
      instance: 'urn:liche:command:deploy',
      message: 'Timed out.',
      retry_after: 10,
      retryable: true,
      status: 504,
      suggested_fix: 'Retry the command after the service recovers.',
      title: 'Remote timeout',
      type: 'https://liche.dev/problems/remote-timeout',
    })
  })

  test('plain CommandError objects normalize without becoming UNKNOWN', () => {
    expect(toCommandError({ code: 'HOOK_FAILED', message: 'policy denied' })).toEqual({
      code: 'HOOK_FAILED',
      detail: 'policy denied',
      exitCode: 1,
      message: 'policy denied',
      title: 'Hook Failed',
      type: 'urn:liche:error:hook-failed',
    })
  })

  test.each([
    ['Error instance', new Error('boom'), 'boom'],
    ['string', 'plain string', 'plain string'],
    ['number', 42, '42'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['object', { x: 1 }, '[object Object]'],
  ])('non-liche %s → UNKNOWN object with stringified message', (_label, input, expectedMessage) => {
    expect(toCommandError(input)).toEqual({
      code: 'UNKNOWN',
      detail: expectedMessage,
      exitCode: 1,
      message: expectedMessage,
      title: 'Unknown',
      type: 'urn:liche:error:unknown',
    })
  })
})

describe('result factories', () => {
  test('ok returns a branded success result', () => {
    const result = ok({ id: 1 }, { custom: true })
    expect(result).toEqual({
      ok: true,
      data: { id: 1 },
      error: null,
      meta: { custom: true },
    })
    expect(isRuntimeResult(result)).toBe(true)
  })

  test('fail returns a branded normalized failure result and lifts cta into meta', () => {
    const result = fail({
      code: 'NOPE',
      message: 'failed',
      cta: { commands: [{ command: 'app fix' }] },
    })
    expect(result).toEqual({
      ok: false,
      data: null,
      error: {
        code: 'NOPE',
        detail: 'failed',
        exitCode: 1,
        message: 'failed',
        title: 'Nope',
        type: 'urn:liche:error:nope',
      },
      meta: {
        cta: { commands: [{ command: 'app fix' }] },
      },
    })
    expect(isRuntimeResult(result)).toBe(true)
  })

  test('commandError normalizes RFC 9457 defaults', () => {
    expect(commandError({ code: 'AUTH_MISSING', message: 'Log in.' })).toEqual({
      code: 'AUTH_MISSING',
      detail: 'Log in.',
      exitCode: 1,
      message: 'Log in.',
      title: 'Auth Missing',
      type: 'urn:liche:error:auth-missing',
    })
  })

  test('raw result-shaped objects are not runtime results', () => {
    expect(isRuntimeResult({ ok: true, data: 1, error: null })).toBe(false)
  })
})
