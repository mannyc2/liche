import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCliPublisherExecutors } from '../src/default-executors.js'
import type { ReleaseCommandRunner } from '../src/default-executors.js'
import type { NpmPublishStep, PypiPublishStep } from '../src/index.js'

type CommandCall = {
  argv: readonly string[]
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function writeArtifact(name: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lili-release-default-executors-'))
  const path = join(dir, name)
  const bytes = new TextEncoder().encode(content)
  writeFileSync(path, bytes)
  return {
    bytes,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    path,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  }
}

function recordingRunner(calls: CommandCall[]): ReleaseCommandRunner {
  return async (argv, options = {}) => {
    calls.push({ argv: [...argv], cwd: options.cwd, env: options.env })
    return { code: 0, stdout: 'ok\n', stderr: '' }
  }
}

function pypiStep(artifact: ReturnType<typeof writeArtifact>): PypiPublishStep {
  return {
    kind: 'pypi-upload',
    packageId: 'pypi:lili-workers',
    ecosystem: 'pypi',
    artifactPath: artifact.path,
    artifactFileName: 'lili_workers-0.1.0-py3-none-any.whl',
    sha256: artifact.sha256,
    size: artifact.size,
    name: 'lili-workers',
    version: '0.1.0',
    repositoryUrl: 'https://upload.pypi.org/legacy/',
  }
}

function npmStep(artifact: ReturnType<typeof writeArtifact>): NpmPublishStep {
  return {
    kind: 'npm-publish',
    role: 'umbrella',
    packageId: 'npm:@lili/workers',
    ecosystem: 'npm',
    artifactPath: artifact.path,
    artifactFileName: 'lili-workers-0.1.0.tgz',
    sha256: artifact.sha256,
    size: artifact.size,
    name: '@lili/workers',
    version: '0.1.0',
    registry: 'https://registry.npmjs.org/',
    tag: 'latest',
    access: 'public',
  }
}

describe('createCliPublisherExecutors', () => {
  test('registers live mutation adapters for every v1 publisher', () => {
    const executors = createCliPublisherExecutors({ commandRunner: recordingRunner([]) })
    expect(Object.keys(executors).sort()).toEqual(['homebrew', 'npm', 'pypi', 'scoop'])
  })

  test('PyPI token publishing delegates to twine without putting the token in argv', async () => {
    const artifact = writeArtifact('wheel.whl', 'wheel bytes')
    try {
      const calls: CommandCall[] = []
      const executors = createCliPublisherExecutors({ commandRunner: recordingRunner(calls) })
      const result = await executors.pypi!({
        step: pypiStep(artifact),
        credentials: { kind: 'token', token: 'pypi-secret-token' },
        bytes: artifact.bytes,
      })

      expect(result.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.argv).toEqual([
        'python',
        '-m',
        'twine',
        'upload',
        '--non-interactive',
        '--repository-url',
        'https://upload.pypi.org/legacy/',
        artifact.path,
      ])
      expect(calls[0]?.env).toMatchObject({
        TWINE_USERNAME: '__token__',
        TWINE_PASSWORD: 'pypi-secret-token',
      })
      expect(calls[0]?.argv.join(' ')).not.toContain('pypi-secret-token')
      if (!result.ok) return
      expect(result.metadata).toMatchObject({
        command: 'python -m twine upload',
        provenance: {
          kind: 'pypi',
          trustedPublisher: false,
          repositoryUrl: 'https://upload.pypi.org/legacy/',
        },
      })
    } finally {
      artifact.cleanup()
    }
  })

  test('npm publishing records provenance metadata and keeps tokens out of argv', async () => {
    const artifact = writeArtifact('package.tgz', 'package bytes')
    try {
      const calls: CommandCall[] = []
      const executors = createCliPublisherExecutors({
        commandRunner: recordingRunner(calls),
        env: { GITHUB_ACTIONS: 'true' },
      })
      const result = await executors.npm!({
        step: npmStep(artifact),
        credentials: { kind: 'token', token: 'npm-secret-token' },
        bytes: artifact.bytes,
      })

      expect(result.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.argv).toEqual([
        'npm',
        'publish',
        artifact.path,
        '--registry',
        'https://registry.npmjs.org/',
        '--tag',
        'latest',
        '--access',
        'public',
        '--provenance',
      ])
      expect(calls[0]?.env).toMatchObject({
        NODE_AUTH_TOKEN: 'npm-secret-token',
        NPM_TOKEN: 'npm-secret-token',
      })
      expect(calls[0]?.argv.join(' ')).not.toContain('npm-secret-token')
      if (!result.ok) return
      expect(result.metadata).toMatchObject({
        command: 'npm publish',
        provenance: {
          kind: 'npm',
          requested: true,
          registry: 'https://registry.npmjs.org/',
          oidc: false,
        },
      })
    } finally {
      artifact.cleanup()
    }
  })

  test('PyPI OIDC publishing fails before mutation with provenance context', async () => {
    const artifact = writeArtifact('wheel.whl', 'wheel bytes')
    try {
      const calls: CommandCall[] = []
      const executors = createCliPublisherExecutors({ commandRunner: recordingRunner(calls) })
      const result = await executors.pypi!({
        step: pypiStep(artifact),
        credentials: { kind: 'oidc', provider: 'github-actions', audience: 'pypi' },
        bytes: artifact.bytes,
        oidc: { idTokenFetcher: async () => ({ ok: true, token: 'unused-jwt' }) },
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(calls).toEqual([])
      expect(result.failure).toEqual({
        code: 'TRUSTED_PUBLISHER_MISMATCH',
        message: 'PyPI trusted publishing must run through the official PyPI trusted-publisher workflow executor',
        details: {
          provider: 'github-actions',
          audience: 'pypi',
          repositoryUrl: 'https://upload.pypi.org/legacy/',
        },
      })
    } finally {
      artifact.cleanup()
    }
  })
})
