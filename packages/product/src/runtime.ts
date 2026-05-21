export type RuntimeValueSpec =
  | { kind: 'literal'; value: string }
  | { kind: 'env'; envVar: string; fallback?: string | undefined }
  | { kind: 'config'; path: string }

export type ProductRemoteSpec = {
  baseUrl: RuntimeValueSpec
}

export const Runtime = {
  literal(value: string): RuntimeValueSpec {
    return { kind: 'literal', value }
  },
  env(envVar: string, options: { fallback?: string | undefined } = {}): RuntimeValueSpec {
    const out: RuntimeValueSpec = { kind: 'env', envVar }
    if (options.fallback !== undefined) out.fallback = options.fallback
    return out
  },
  config(path: string): RuntimeValueSpec {
    return { kind: 'config', path }
  },
} as const
