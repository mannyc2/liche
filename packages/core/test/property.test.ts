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

  test('csv formatter escapes scalar strings as parseable single-column rows', () => {
    const singleLine = fc.string().filter((value) => !/[\n\r]/.test(value))
    fc.assert(
      fc.property(fc.array(singleLine, { maxLength: 20 }), (items) => {
        const lines = format(items, 'csv').split('\n')
        const rows = lines.length === 1 && lines[0] === '' ? [] : lines
        expect(rows[0]).toBe(items.length === 0 ? undefined : 'value')
        expect(rows.slice(1).map(parseSingleCsvCell)).toEqual(items)
      }),
    )
  })
})

function parseSingleCsvCell(cell: string): string {
  if (!cell.startsWith('"')) return cell
  expect(cell.endsWith('"')).toBe(true)
  return cell.slice(1, -1).replaceAll('""', '"')
}
