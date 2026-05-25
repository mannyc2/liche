import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { z } from '../src/index.js'
import { format } from '../src/format/index.js'
import { parseCommandOptions, parseObject } from '../src/parser/argv.js'

describe('property tests', () => {
  test('flag parser preserves numeric values and boolean negation across generated inputs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.boolean(), (count, cache) => {
        const definition = {
          options: z.object({ cache: z.boolean().default(true), count: z.coerce.number() }),
        }
        const argv = ['--count', String(count), cache ? '--cache' : '--no-cache', 'target']
        const parsed = parseCommandOptions(definition, argv)
        const options = parseObject(definition.options, parsed.options)

        expect(parsed.args).toEqual(['target'])
        expect(options).toEqual({ cache, count })
      }),
    )
  })

  test('jsonl formatter produces one parseable JSON value per input element', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.integer(), name: fc.string() }), { maxLength: 20 }), (items) => {
        const lines = format(items, 'jsonl').split('\n').filter(Boolean)
        expect(lines.map((line) => JSON.parse(line))).toEqual(items)
      }),
    )
  })

})
