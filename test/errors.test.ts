import { describe, expect, test } from 'bun:test'
import { BaseError, LiliError, ParseError, ValidationError, errorToObject } from '../src/errors/error.js'

describe('error class names', () => {
  test.each([
    ['BaseError', new BaseError('m'), 'Lili.BaseError'],
    ['LiliError', new LiliError({ code: 'X', message: 'm' }), 'Lili.LiliError'],
    ['ValidationError', new ValidationError({ message: 'm' }), 'Lili.ValidationError'],
    ['ParseError', new ParseError({ message: 'm' }), 'Lili.ParseError'],
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

  test('LiliError preserves cause and exposes via walk', () => {
    const cause = new Error('underlying')
    const err = new LiliError({ code: 'X', message: 'top', cause })
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

describe('LiliError', () => {
  test('retryable defaults to false (not true)', () => {
    const err = new LiliError({ code: 'X', message: 'y' })
    expect(err.retryable).toBe(false)
  })

  test('retryable=true is preserved', () => {
    const err = new LiliError({ code: 'X', message: 'y', retryable: true })
    expect(err.retryable).toBe(true)
  })

  test('exitCode is undefined by default', () => {
    const err = new LiliError({ code: 'X', message: 'y' })
    expect(err.exitCode).toBeUndefined()
  })

  test('exposes code, hint, exitCode verbatim', () => {
    const err = new LiliError({ code: 'BOOM', message: 'msg', hint: 'try again', exitCode: 7 })
    expect(err.code).toBe('BOOM')
    expect(err.hint).toBe('try again')
    expect(err.exitCode).toBe(7)
  })

  test('preserves cause', () => {
    const cause = new Error('root')
    const err = new LiliError({ code: 'X', message: 'y', cause })
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
    expect(err.name).toBe('Lili.ParseError')
  })
})

describe('errorToObject', () => {
  test('ValidationError → VALIDATION_ERROR envelope with fieldErrors and exitCode=1', () => {
    const err = new ValidationError({
      message: 'bad',
      fieldErrors: [{ path: '$.a', message: 'required' }],
    })
    expect(errorToObject(err)).toEqual({
      code: 'VALIDATION_ERROR',
      exitCode: 1,
      fieldErrors: [{ path: '$.a', message: 'required' }],
      message: 'bad',
    })
  })

  test('ParseError → PARSE_ERROR envelope with exitCode=1', () => {
    const err = new ParseError({ message: 'bad config' })
    expect(errorToObject(err)).toEqual({
      code: 'PARSE_ERROR',
      exitCode: 1,
      message: 'bad config',
    })
  })

  test('LiliError default exitCode is 1', () => {
    const err = new LiliError({ code: 'X', message: 'y' })
    const obj = errorToObject(err)
    expect(obj.exitCode).toBe(1)
  })

  test('LiliError preserves custom exitCode (does NOT coerce to 1)', () => {
    const err = new LiliError({ code: 'X', message: 'y', exitCode: 7 })
    const obj = errorToObject(err)
    expect(obj.exitCode).toBe(7)
  })

  test('LiliError envelope carries code, hint, retryable, message', () => {
    const err = new LiliError({ code: 'BOOM', message: 'm', hint: 'h', retryable: true, exitCode: 2 })
    expect(errorToObject(err)).toEqual({
      code: 'BOOM',
      exitCode: 2,
      hint: 'h',
      message: 'm',
      retryable: true,
    })
  })

  test.each([
    ['Error instance', new Error('boom'), 'boom'],
    ['string', 'plain string', 'plain string'],
    ['number', 42, '42'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['object', { x: 1 }, '[object Object]'],
  ])('non-lili %s → UNKNOWN envelope with stringified message', (_label, input, expectedMessage) => {
    expect(errorToObject(input)).toEqual({
      code: 'UNKNOWN',
      exitCode: 1,
      message: expectedMessage,
    })
  })
})
