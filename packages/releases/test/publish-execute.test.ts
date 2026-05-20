import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeReleasePublish } from '../src/index.js'
import type {
  HomebrewPublishStep,
  NpmPublishStep,
  PublisherCredentials,
  PublisherExecutorRegistry,
  PypiPublishStep,
  ReleasePublishPlan,
  ScoopPublishStep,
  StepExecutorResult,
} from '../src/index.js'

const tmp = mkdtempSync(join(tmpdir(), 'lili-releases-execute-'))

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

type WrittenArtifact = {
  path: string
  fileName: string
  sha256: string
  size: number
  bytes: Uint8Array
}

function writeArtifact(name: string, content: string): WrittenArtifact {
  const bytes = new TextEncoder().encode(content)
  const path = join(tmp, name)
  writeFileSync(path, bytes)
  return {
    path,
    fileName: name,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    bytes,
  }
}

type Fixture = {
  plan: ReleasePublishPlan
  artifacts: {
    npmPlatform: WrittenArtifact
    npmUmbrella: WrittenArtifact
    pypi: WrittenArtifact
    homebrew: WrittenArtifact
    scoop: WrittenArtifact
  }
}

let fixtureCounter = 0

function buildFixture(): Fixture {
  fixtureCounter += 1
  const tag = fixtureCounter
  const npmPlatform = writeArtifact(
    `${tag}-npm-platform.tgz`,
    `npm platform tarball content ${tag}`,
  )
  const npmUmbrella = writeArtifact(
    `${tag}-npm-umbrella.tgz`,
    `npm umbrella tarball content ${tag}`,
  )
  const pypi = writeArtifact(
    `${tag}-pypi.whl`,
    `pypi wheel content ${tag}`,
  )
  const homebrew = writeArtifact(
    `${tag}-homebrew.rb`,
    `homebrew formula content ${tag}`,
  )
  const scoop = writeArtifact(
    `${tag}-scoop.json`,
    `scoop manifest content ${tag}`,
  )

  const npmPlatformStep: NpmPublishStep = {
    kind: 'npm-publish',
    role: 'platform',
    packageId: 'npm:@lili/workers-linux-x64',
    ecosystem: 'npm',
    artifactPath: npmPlatform.path,
    artifactFileName: npmPlatform.fileName,
    sha256: npmPlatform.sha256,
    size: npmPlatform.size,
    name: '@lili/workers-linux-x64',
    version: '0.1.0',
    registry: 'https://registry.npmjs.org/',
    tag: 'latest',
    access: 'public',
  }
  const npmUmbrellaStep: NpmPublishStep = {
    kind: 'npm-publish',
    role: 'umbrella',
    packageId: 'npm:@lili/workers',
    ecosystem: 'npm',
    artifactPath: npmUmbrella.path,
    artifactFileName: npmUmbrella.fileName,
    sha256: npmUmbrella.sha256,
    size: npmUmbrella.size,
    name: '@lili/workers',
    version: '0.1.0',
    registry: 'https://registry.npmjs.org/',
    tag: 'latest',
    access: 'public',
  }
  const pypiStep: PypiPublishStep = {
    kind: 'pypi-upload',
    packageId: 'pypi:lili-workers',
    ecosystem: 'pypi',
    artifactPath: pypi.path,
    artifactFileName: pypi.fileName,
    sha256: pypi.sha256,
    size: pypi.size,
    name: 'lili-workers',
    version: '0.1.0',
    repositoryUrl: 'https://upload.pypi.org/legacy/',
  }
  const homebrewStep: HomebrewPublishStep = {
    kind: 'homebrew-write-formula',
    packageId: 'homebrew:workers',
    ecosystem: 'homebrew',
    artifactPath: homebrew.path,
    artifactFileName: homebrew.fileName,
    sha256: homebrew.sha256,
    size: homebrew.size,
    name: 'workers',
    version: '0.1.0',
    tap: { owner: 'lili', repo: 'homebrew-tap', branch: 'main' },
    targetPath: 'Formula/workers.rb',
  }
  const scoopStep: ScoopPublishStep = {
    kind: 'scoop-write-manifest',
    packageId: 'scoop:workers',
    ecosystem: 'scoop',
    artifactPath: scoop.path,
    artifactFileName: scoop.fileName,
    sha256: scoop.sha256,
    size: scoop.size,
    name: 'workers',
    version: '0.1.0',
    bucket: { owner: 'lili', repo: 'scoop-bucket', branch: 'main' },
    targetPath: 'bucket/workers.json',
  }

  const plan: ReleasePublishPlan = {
    dryRun: true,
    manifestVersion: 1,
    releaseVersion: '0.1.0',
    subject: { id: 'workers', name: 'Workers CLI', version: '0.1.0' },
    steps: [npmPlatformStep, npmUmbrellaStep, pypiStep, homebrewStep, scoopStep],
  }

  return {
    plan,
    artifacts: { npmPlatform, npmUmbrella, pypi, homebrew, scoop },
  }
}

function fullCredentials(): PublisherCredentials {
  return {
    npm: { kind: 'token', token: 'npm-token' },
    pypi: { kind: 'token', token: 'pypi-token' },
    homebrew: { kind: 'token', githubToken: 'github-token' },
    scoop: { kind: 'token', githubToken: 'github-token' },
  }
}

type CallLog = Array<{ ecosystem: string; packageId: string; bytesLength: number }>

function recordingExecutors(log: CallLog, metadata?: Record<string, unknown>): PublisherExecutorRegistry {
  const record = (ecosystem: string) =>
    (input: { step: { packageId: string }; bytes: Uint8Array }): StepExecutorResult => {
      log.push({ ecosystem, packageId: input.step.packageId, bytesLength: input.bytes.byteLength })
      return metadata !== undefined ? { ok: true, metadata } : { ok: true }
    }
  return {
    npm: record('npm'),
    pypi: record('pypi'),
    homebrew: record('homebrew'),
    scoop: record('scoop'),
  }
}

let baseFixture: Fixture

beforeEach(() => {
  baseFixture = buildFixture()
})

describe('executeReleasePublish', () => {
  test('runs each step in plan order with the matching executor and credentials', async () => {
    const log: CallLog = []
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors: recordingExecutors(log),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(log.map((entry) => entry.ecosystem)).toEqual([
      'npm',
      'npm',
      'pypi',
      'homebrew',
      'scoop',
    ])
    expect(log[0]?.bytesLength).toBe(baseFixture.artifacts.npmPlatform.size)
    expect(result.completed.map((receipt) => receipt.step.packageId)).toEqual([
      'npm:@lili/workers-linux-x64',
      'npm:@lili/workers',
      'pypi:lili-workers',
      'homebrew:workers',
      'scoop:workers',
    ])
  })

  test('passes executor metadata through to the receipt', async () => {
    const log: CallLog = []
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors: recordingExecutors(log, { uploadedAt: '2026-05-20T00:00:00Z' }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const receipt of result.completed) {
      expect(receipt.metadata).toEqual({ uploadedAt: '2026-05-20T00:00:00Z' })
    }
  })

  test('ARTIFACT_READ_FAILED when the artifact file is missing', async () => {
    rmSync(baseFixture.artifacts.npmPlatform.path)
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors: recordingExecutors([]),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.completed).toEqual([])
    expect(result.failure.code).toBe('ARTIFACT_READ_FAILED')
    expect(result.failure.stepIndex).toBe(0)
    expect(result.failure.packageId).toBe('npm:@lili/workers-linux-x64')
    expect(result.failure.details).toEqual({
      artifactPath: baseFixture.artifacts.npmPlatform.path,
    })
  })

  test('ARTIFACT_TAMPERED on sha mismatch with diagnostic details', async () => {
    const original = baseFixture.artifacts.pypi.bytes
    const tampered = new Uint8Array(original)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    writeFileSync(baseFixture.artifacts.pypi.path, tampered)
    const actualSha256 = sha256Hex(tampered)

    const log: CallLog = []
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors: recordingExecutors(log),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.completed.map((receipt) => receipt.step.ecosystem)).toEqual(['npm', 'npm'])
    expect(result.failure.code).toBe('ARTIFACT_TAMPERED')
    expect(result.failure.stepIndex).toBe(2)
    expect(result.failure.ecosystem).toBe('pypi')
    expect(result.failure.details).toEqual({
      stepIndex: 2,
      packageId: 'pypi:lili-workers',
      ecosystem: 'pypi',
      artifactPath: baseFixture.artifacts.pypi.path,
      expectedSha256: baseFixture.artifacts.pypi.sha256,
      actualSha256,
      expectedSize: baseFixture.artifacts.pypi.size,
      actualSize: tampered.byteLength,
    })
    expect(log.find((entry) => entry.ecosystem === 'pypi')).toBeUndefined()
  })

  test('ARTIFACT_TAMPERED on size mismatch', async () => {
    writeFileSync(baseFixture.artifacts.homebrew.path, 'short')
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors: recordingExecutors([]),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('ARTIFACT_TAMPERED')
    expect(result.failure.stepIndex).toBe(3)
    expect(result.failure.details).toMatchObject({
      expectedSize: baseFixture.artifacts.homebrew.size,
      actualSize: 5,
    })
  })

  test('CREDENTIAL_MISSING when an active publisher has no credentials', async () => {
    const credentials: PublisherCredentials = {
      npm: { kind: 'token', token: 'npm-token' },
      pypi: { kind: 'token', token: 'pypi-token' },
      homebrew: { kind: 'token', githubToken: 'github-token' },
    }
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials,
      executors: recordingExecutors([]),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('CREDENTIAL_MISSING')
    expect(result.failure.ecosystem).toBe('scoop')
    expect(result.failure.stepIndex).toBe(4)
    expect(result.completed).toHaveLength(4)
  })

  test('EXECUTOR_MISSING when no executor is registered for an active publisher', async () => {
    const log: CallLog = []
    const executors = recordingExecutors(log)
    delete executors.scoop
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('EXECUTOR_MISSING')
    expect(result.failure.ecosystem).toBe('scoop')
    expect(result.failure.stepIndex).toBe(4)
    expect(result.completed).toHaveLength(4)
  })

  test('EXECUTOR_FAILED when an executor returns a structured failure', async () => {
    const log: CallLog = []
    const executors = recordingExecutors(log)
    executors.homebrew = () => ({
      ok: false,
      failure: {
        code: 'GITHUB_PUSH_REJECTED',
        message: 'tap rejected the push',
        details: { remote: 'https://example.test/lili/homebrew-tap.git' },
      },
    })
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('EXECUTOR_FAILED')
    expect(result.failure.ecosystem).toBe('homebrew')
    expect(result.failure.stepIndex).toBe(3)
    expect(result.failure.message).toBe('tap rejected the push')
    expect(result.failure.details).toEqual({
      executorCode: 'GITHUB_PUSH_REJECTED',
      remote: 'https://example.test/lili/homebrew-tap.git',
    })
    expect(result.completed).toHaveLength(3)
    expect(log.find((entry) => entry.ecosystem === 'scoop')).toBeUndefined()
  })

  test('EXECUTOR_FAILED wraps thrown executor errors', async () => {
    const executors = recordingExecutors([])
    executors.npm = () => {
      throw new Error('network unreachable')
    }
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('EXECUTOR_FAILED')
    expect(result.failure.message).toContain('network unreachable')
    expect(result.failure.details?.['error']).toContain('network unreachable')
    expect(result.completed).toEqual([])
  })

  test('stop-on-failure preserves the receipts of steps that completed before the failure', async () => {
    const log: CallLog = []
    const executors = recordingExecutors(log, { ok: true })
    executors.pypi = () => ({
      ok: false,
      failure: { code: 'PYPI_FORBIDDEN', message: 'token lacks upload scope' },
    })
    const result = await executeReleasePublish({
      plan: baseFixture.plan,
      credentials: fullCredentials(),
      executors,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.completed.map((receipt) => receipt.step.packageId)).toEqual([
      'npm:@lili/workers-linux-x64',
      'npm:@lili/workers',
    ])
    for (const receipt of result.completed) {
      expect(receipt.metadata).toEqual({ ok: true })
    }
  })
})
