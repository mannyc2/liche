import { describe, expect, test } from 'bun:test'
import { Formatter } from '../src/index.js'

describe('formatter defaults', () => {
  test('default Formatter output is JSON', () => {
    expect(Formatter.format({ ok: true })).toBe('{\n  "ok": true\n}')
  })
})
