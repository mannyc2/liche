import { z } from 'zod'

const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/
const INT_RE = /^-?(0|[1-9][0-9]*)$/
const POS_INT_RE = /^[1-9][0-9]*$/

function number() {
  const input = z.union([z.string().regex(NUMBER_RE), z.number().finite()])
  const output = z.number().finite()
  return z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
}

function int() {
  const input = z.union([z.string().regex(INT_RE), z.number().int().safe()])
  const output = z.number().int().safe()
  return z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
}

function positiveInt() {
  const input = z.union([z.string().regex(POS_INT_RE), z.number().int().positive().safe()])
  const output = z.number().int().positive().safe()
  return z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
}

function port() {
  const input = z.union([z.string().regex(POS_INT_RE), z.number().int().min(1).max(65535)])
  const output = z.number().int().min(1).max(65535)
  return z.codec(input, output, {
    decode: (value) => (typeof value === 'number' ? value : Number(value)),
    encode: (value) => String(value),
  })
}

function boolean() {
  const input = z.union([
    z.literal('true'),
    z.literal('false'),
    z.literal('1'),
    z.literal('0'),
    z.boolean(),
  ])
  const output = z.boolean()
  return z.codec(input, output, {
    decode: (value) => (typeof value === 'boolean' ? value : value === 'true' || value === '1'),
    encode: (value) => (value ? 'true' : 'false'),
  })
}

export const arg = { boolean, int, number, port, positiveInt }
