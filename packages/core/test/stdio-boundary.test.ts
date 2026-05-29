import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Guardrail for the stdio primitive cutover (see docs/stdio-primitive-plan.md):
// classification happens ONCE, at the boundary. The removed `isTty` boolean must
// not return, and ambient `process.std*.isTTY` probes belong only in the boundary
// module (src/cli/stdio.ts) — which in fact uses fstat/isatty, not process.*.isTTY.

const SRC = join(import.meta.dir, '..', 'src')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

// The only file allowed to mention `isTty` (in a doc comment) is the boundary itself.
const ALLOW_ISTTY = new Set([join(SRC, 'cli', 'stdio.ts')])

describe('stdio boundary', () => {
  const files = tsFiles(SRC)

  test('no `isTty` identifier survives in core/src (replaced by ctx.stdio)', () => {
    const offenders = files
      .filter((f) => !ALLOW_ISTTY.has(f))
      .filter((f) => /\bisTty\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
    expect(offenders).toEqual([])
  })

  test('no ambient `process.std*.isTTY` probe anywhere in core/src', () => {
    const offenders = files
      .filter((f) => /process\.(stdout|stderr|stdin)\.isTTY/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
    expect(offenders).toEqual([])
  })
})
