export type SecretString = {
  readonly kind: 'lili.secret'
  reveal(): string
  toJSON(): '[redacted]'
  toString(): '[redacted]'
}

export function secret(value: string): SecretString {
  return {
    kind: 'lili.secret',
    reveal: () => value,
    toJSON: () => '[redacted]' as const,
    toString: () => '[redacted]' as const,
  }
}

export function isSecretString(value: unknown): value is SecretString {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'lili.secret' &&
    typeof (value as { reveal?: unknown }).reveal === 'function'
  )
}
