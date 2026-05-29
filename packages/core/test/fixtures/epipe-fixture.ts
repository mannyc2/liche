// Standalone CLI fixture for the EPIPE / flush-before-exit characterization test.
// Run directly with `bun` (no build step) — see ../epipe-flush.characterization.test.ts.
//
// Two commands, both emitting a payload far larger than a pipe buffer (~64KB on
// macOS) so that:
//   - `flood`     succeeds (exit 0) — the runner returns without an eager exit.
//   - `floodfail` fails (exit 1)    — the runner hits `(options.exit ?? process.exit)(1)`
//                                     in terminal.ts immediately after the synchronous
//                                     Bun.stdout.write, which is the truncation-risk path.
//
// The payload ends with MARK so a test can detect a truncated tail by its absence.
import { defineCli, defineCommand, fail, ok, outputControls, run, z } from '../../src/index.js'

const SIZE = 2_000_000 // ≫ the ~64KB pipe buffer, so a single write cannot complete atomically
export const MARK = '<<<END-OF-OUTPUT>>>'
const BLOB = 'A'.repeat(SIZE) + MARK

const cli = defineCli({
  name: 'epipe-fixture',
  description: 'Characterization fixture for EPIPE / flush-before-exit behavior.',
  extensions: [outputControls()], // registers the --json global
  commands: [
    defineCommand({
      path: ['flood'],
      input: { options: z.object({}) },
      async run() {
        return ok({ blob: BLOB })
      },
    }),
    defineCommand({
      path: ['floodfail'],
      input: { options: z.object({}) },
      async run() {
        return fail({ code: 'FLOOD_FAIL', message: 'flooded then failed', detail: BLOB })
      },
    }),
  ],
})

await run(cli, process.argv.slice(2))
