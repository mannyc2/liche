import { estimateTokenCount, sliceByTokens } from 'tokenx'

export function tokenCount(input: string): number {
  return estimateTokenCount(input)
}

export function tokenSlice(input: string, offset = 0, limit = Infinity): string {
  if (!Number.isFinite(limit)) return sliceByTokens(input, offset)

  const sliced = sliceByTokens(input, offset, limit)
  const total = tokenCount(input)
  const suffix = offset + limit < total ? `\n[truncated: showing tokens ${offset}-${offset + limit} of ${total}]` : ''
  return `${sliced}${suffix}`
}
