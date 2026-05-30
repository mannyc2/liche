// Single source of truth for how a flag token maps to a value, shared by the global-flag parser
// (parser/globals.ts) and the command-option parser (parser/argv.ts) so the two stay consistent.
// The rule, in two states split on "is there an `=`":
//   --x=V  → exactly V   (so --x= is the empty string "")
//   --x    → the next argv token (undefined when there is none)
// Booleans never consume the next token. Validity of the resolved value (a bad enum, a required
// value that is missing/empty) is the caller's job — it owns the schema / parse function that can
// reject it with the real input.

/** Split a long-flag body (`name` or `name=value`) on its first `=`. equalsValue is undefined when there is no `=`. */
export function splitFlag(body: string): { name: string; equalsValue: string | undefined } {
  const [name, equalsValue] = body.split(/=(.*)/s)
  return { name: name ?? '', equalsValue }
}

/**
 * Resolve a flag's value. `needsValue` is false for booleans. `next` yields the following argv
 * token (or undefined when the flag is the last token). Booleans return true/false; a boolean given
 * a non-boolean `=value` returns that raw string so the caller's validation can reject it.
 */
export function flagValue(
  needsValue: boolean,
  equalsValue: string | undefined,
  next: () => string | undefined,
): string | boolean | undefined {
  if (!needsValue) {
    if (equalsValue === 'false') return false
    if (equalsValue === undefined || equalsValue === '' || equalsValue === 'true') return true
    return equalsValue
  }
  return equalsValue ?? next()
}
