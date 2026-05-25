import type { HttpFetch, Schema } from '@liche/core'
import type { Capability, NormalizedHttpSpec } from '../catalog/types.js'

export type ConformanceCase = {
  name: string
  capability: string
  argv?: readonly string[]
  input: Record<string, unknown>
  target?: {
    baseUrl?: string
    headers?: Record<string, string>
  }
  expectRequest?: {
    method: string
    path: string
    query?: Record<string, string | string[]>
    headers?: Record<string, string>
    body?: unknown
  }
  expectResponse?: {
    status?: number
    body?: unknown
  }
  safety?: {
    destructive: boolean
    requiresOptIn: boolean
    setup?: string
    teardown?: string
  }
}

export type ConformanceStatus = 'passed' | 'failed' | 'skipped'

export type ConformanceReportCase = {
  capability: string
  name: string
  status: ConformanceStatus
  reason?: string
  request?: {
    method: string
    url: string
    headers?: Record<string, string>
    bodyPreview?: string
  }
  response?: {
    status?: number
    contentType?: string
    bodyPreview?: string
  }
  errors: Array<{ code: string; message: string; path?: string }>
}

export type ConformanceReport = {
  reportVersion: 1
  catalog: {
    name: string
    version: string
    contractDigest: string
  }
  target: {
    baseUrl: string
    env?: string
  }
  run: {
    startedAt: string
    finishedAt: string
    durationMs: number
  }
  summary: {
    passed: number
    failed: number
    skipped: number
    total: number
  }
  cases: ConformanceReportCase[]
}

export type ConformProductOptions = {
  baseUrl?: string
  capability?: string
  env?: Record<string, string | undefined>
  fetch?: HttpFetch
  fixtures?: readonly ConformanceCase[]
  includeDestructive?: boolean
  now?: () => Date
}

export type RunnableCapability = {
  cap: Capability
  http: NormalizedHttpSpec
  output: Schema
  inputFields: string[]
}

export type PreparedCase = {
  fixture?: ConformanceCase
  input: Record<string, unknown>
  name: string
  runnable: RunnableCapability
}
