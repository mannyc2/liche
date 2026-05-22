import { describe, expect, test } from 'bun:test'
import { decode, encode } from '@toon-format/toon'
import { Formatter } from '../src/index.js'

describe('TOON oracle', () => {
  test('default Formatter output is JSON; TOON is explicit opt-in', () => {
    expect(Formatter.format({ ok: true })).toBe('{\n  "ok": true\n}')
  })

  test('Formatter.toon delegates exactly to @toon-format/toon encode', () => {
    const value = {
      items: [
        { price: 9.99, qty: 2, sku: 'A1' },
        { price: 14.5, qty: 1, sku: 'B2' },
      ],
      ok: true,
    }

    expect(Formatter.format(value, 'toon')).toBe(encode(value))
  })

  test('TOON output decodes back through the official parser', () => {
    const value = { user: { active: true, age: 42, name: 'Ada' } }
    expect(decode(Formatter.format(value, 'toon'))).toEqual(value)
  })
})
