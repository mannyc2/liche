export type LintIssue = {
  code: string
  path: string
  message: string
  recommendation?: string
}

export const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:[.-][a-z][a-zA-Z0-9]*)*$/

export function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
