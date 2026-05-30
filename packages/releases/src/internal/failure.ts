// Render `<scope>/<code>: <message>` lines for any failure array whose entries
// have `code`, `message`, and a caller-named scope field (publisher, stage, ecosystem).

export function formatFailures<T extends Record<string, unknown>>(failures: readonly T[], scope: keyof T): string {
  return failures
    .map((failure) => `${String(failure[scope])}/${String(failure['code'])}: ${String(failure['message'])}`)
    .join('\n')
}
