import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { packageRelease, manifestFromBuildRecord, parseBuildRecord } from '@lili/releases'
import { createDefaultRendererRegistry } from '@lili/releases/renderers/all'

describe('release-renderers example', () => {
  let outDir: string

  beforeEach(() => {
    mkdirSync(join(import.meta.dir, '.tmp'), { recursive: true })
    outDir = mkdtempSync(join(import.meta.dir, '.tmp/release-'))
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  test('renders npm packages from a build record and verified binary path', async () => {
    const recordInput = JSON.parse(await Bun.file(join(import.meta.dir, 'build-record.json')).text())
    const parsed = parseBuildRecord(recordInput)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const manifest = manifestFromBuildRecord(parsed.record, {
      subject: {
        id: 'workers',
        name: 'Workers CLI',
      },
      metadata: {
        description: 'Workers CLI example package',
        license: 'MIT',
        repository: {
          type: 'git',
          url: 'https://github.com/acme/workers.git',
        },
      },
      host: {
        kind: 'url-template',
        template: 'https://downloads.example.test/workers/{version}/{filename}',
      },
      release: { generatorVersion: '0.0.0' },
    })

    const result = await packageRelease({
      manifest,
      binaryPaths: Object.fromEntries(
        parsed.record.binaries.map((binary) => [binary.id, binary.path]),
      ),
      rendererConfig: {
        npm: { packageName: '@acme/workers' },
      },
      rendererRegistry: createDefaultRendererRegistry(),
      renderers: ['npm'],
      outDir,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.binaries).toEqual([
      {
        binaryId: 'workers-linux-x64',
        path: 'examples/release-renderers/bin/workers-linux-x64',
        sha256: '511b15a0c5fac5e5972ecf5c115de3b92d83d78681998cc51e5a30433052b64f',
        size: 24,
      },
    ])
    expect(result.packages.map((pkg) => pkg.kind).sort()).toEqual([
      'npm-platform',
      'npm-umbrella',
    ])
    expect(result.packageArtifacts).toHaveLength(2)
  })
})
