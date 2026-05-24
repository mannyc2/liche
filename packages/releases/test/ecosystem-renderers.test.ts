import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { packageRelease } from '../src/index.js'
import { createDefaultRendererRegistry } from '../src/renderers/all.js'
import { readTarGzEntries } from '../src/renderers/archives/tar.js'
import { readZipEntries } from '../src/renderers/archives/zip.js'
import type { CliReleaseManifestInput } from '../src/index.js'

const tmp = mkdtempSync(join(tmpdir(), 'liche-releases-renderers-'))

const binaryBytes = {
  'workers-darwin-arm64': Buffer.from('DARWIN_ARM64_BINARY'),
  'workers-linux-x64': Buffer.from('LINUX_X64_GLIBC_BINARY'),
  'workers-linux-x64-musl': Buffer.from('LINUX_X64_MUSL_BINARY'),
  'workers-windows-x64': Buffer.from('WINDOWS_X64_BINARY'),
} as const

const binaryPaths: Record<string, string> = {}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function manifestInput(): CliReleaseManifestInput {
  return {
    manifestVersion: 1,
    metadata: {
      description: 'Workers release renderer fixture',
      homepage: 'https://example.test/workers',
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'https://example.test/workers.git',
      },
    },
    subject: {
      id: 'workers',
      name: 'Workers CLI',
      version: '0.1.0',
      commit: '0123456789abcdef0123456789abcdef01234567',
      contract: {
        kind: 'core-command-manifest',
        digest: 'sha256:fake-command-manifest',
      },
    },
    release: {
      version: '0.1.0',
      createdAt: '2026-05-19T12:00:00Z',
      generatorVersion: '0.0.0',
    },
    runtime: { command: 'workers' },
    binaries: [
      {
        id: 'workers-darwin-arm64',
        target: 'bun-darwin-arm64',
        platform: 'darwin',
        arch: 'arm64',
        filename: 'workers',
        url: 'https://example.test/downloads/workers-darwin-arm64',
        sha256: sha256Hex(binaryBytes['workers-darwin-arm64']),
        size: binaryBytes['workers-darwin-arm64'].byteLength,
      },
      {
        id: 'workers-linux-x64',
        target: 'bun-linux-x64',
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        filename: 'workers',
        url: 'https://example.test/downloads/workers-linux-x64',
        sha256: sha256Hex(binaryBytes['workers-linux-x64']),
        size: binaryBytes['workers-linux-x64'].byteLength,
      },
      {
        id: 'workers-linux-x64-musl',
        target: 'bun-linux-x64-musl',
        platform: 'linux',
        arch: 'x64',
        libc: 'musl',
        filename: 'workers',
        url: 'https://example.test/downloads/workers-linux-x64-musl',
        sha256: sha256Hex(binaryBytes['workers-linux-x64-musl']),
        size: binaryBytes['workers-linux-x64-musl'].byteLength,
      },
      {
        id: 'workers-windows-x64',
        target: 'bun-windows-x64',
        platform: 'windows',
        arch: 'x64',
        filename: 'workers.exe',
        url: 'https://example.test/downloads/workers-windows-x64.exe',
        sha256: sha256Hex(binaryBytes['workers-windows-x64']),
        size: binaryBytes['workers-windows-x64'].byteLength,
      },
    ],
  }
}

beforeAll(() => {
  for (const [id, bytes] of Object.entries(binaryBytes)) {
    const path = join(tmp, id)
    writeFileSync(path, bytes)
    binaryPaths[id] = path
  }
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

async function renderAll() {
  const result = await packageRelease({
    manifest: manifestInput(),
    binaryPaths,
    renderers: 'all',
    rendererRegistry: createDefaultRendererRegistry(),
    rendererConfig: {
      npm: { packageScope: '@acme' },
      pypi: { distribution: 'workers-cli' },
      homebrew: { formulaName: 'workers-cli' },
      scoop: { manifestName: 'workers-cli' },
    },
    outDir: join(tmp, 'artifacts'),
  })
  if (!result.ok) {
    throw new Error(`rendering failed: ${JSON.stringify(result.failures, null, 2)}`)
  }
  return result
}

describe('ecosystem renderers', () => {
  test('npm renders an umbrella package and platform packages with exact pins and no scripts', async () => {
    const result = await renderAll()
    const umbrella = result.packages.find((record) => record.id === 'npm:@acme/workers')
    const linux = result.packages.find((record) => record.id === 'npm:@acme/workers-linux-x64')
    expect(umbrella).toBeDefined()
    expect(linux).toBeDefined()
    if (!umbrella?.artifact || !linux?.artifact) throw new Error('missing npm artifacts')

    const umbrellaArtifact = result.packageArtifacts.find((artifact) => artifact.packageId === umbrella.id)
    const linuxArtifact = result.packageArtifacts.find((artifact) => artifact.packageId === linux.id)
    if (!umbrellaArtifact || !linuxArtifact) throw new Error('missing verified npm artifacts')
    expect(umbrellaArtifact.path).toContain('/tarballs/')
    expect(linuxArtifact.path).toContain('/tarballs/')

    const umbrellaDir = join(tmp, 'artifacts', 'npm', 'package-dirs', 'acme-workers')
    const linuxDir = join(tmp, 'artifacts', 'npm', 'package-dirs', 'acme-workers-linux-x64')
    const umbrellaDirPackageJson = JSON.parse(
      readFileSync(join(umbrellaDir, 'package.json'), 'utf8'),
    ) as {
      scripts?: unknown
      optionalDependencies: Record<string, string>
      bin: Record<string, string>
    }
    expect(umbrellaDirPackageJson.scripts).toBeUndefined()
    expect(umbrellaDirPackageJson.bin).toEqual({ workers: './bin/workers.js' })

    const umbrellaEntries = readTarGzEntries(await Bun.file(umbrellaArtifact.path).bytes())
    const umbrellaPackageJson = JSON.parse(
      Buffer.from(umbrellaEntries.get('package/package.json')!).toString('utf8'),
    ) as {
      scripts?: unknown
      optionalDependencies: Record<string, string>
      bin: Record<string, string>
    }
    expect(umbrellaPackageJson.scripts).toBeUndefined()
    expect(umbrellaPackageJson.bin).toEqual({ workers: './bin/workers.js' })
    expect(Object.values(umbrellaPackageJson.optionalDependencies)).toEqual([
      '0.1.0',
      '0.1.0',
      '0.1.0',
      '0.1.0',
    ])
    expect(Buffer.from(umbrellaEntries.get('package/bin/workers.js')!).toString('utf8')).toContain(
      'could not find a compatible packaged binary',
    )
    const shimPath = join(tmp, 'missing-optional-shim.mjs')
    writeFileSync(shimPath, readFileSync(join(umbrellaDir, 'bin', 'workers.js')))
    const shimRun = Bun.spawnSync({
      cmd: ['bun', shimPath],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(shimRun.exitCode).toBe(1)
    expect(shimRun.stderr.toString()).toContain('Install optional dependencies')

    const linuxDirPackageJson = JSON.parse(
      readFileSync(join(linuxDir, 'package.json'), 'utf8'),
    ) as { scripts?: unknown; os: string[]; cpu: string[]; libc: string }
    expect(linuxDirPackageJson.scripts).toBeUndefined()
    expect(linuxDirPackageJson.os).toEqual(['linux'])
    expect(linuxDirPackageJson.cpu).toEqual(['x64'])
    expect(linuxDirPackageJson.libc).toBe('glibc')
    expect(sha256Hex(readFileSync(join(linuxDir, 'bin', 'workers')))).toBe(
      sha256Hex(binaryBytes['workers-linux-x64']),
    )

    const linuxEntries = readTarGzEntries(await Bun.file(linuxArtifact.path).bytes())
    const linuxPackageJson = JSON.parse(
      Buffer.from(linuxEntries.get('package/package.json')!).toString('utf8'),
    ) as { scripts?: unknown; os: string[]; cpu: string[]; libc: string }
    expect(linuxPackageJson.scripts).toBeUndefined()
    expect(linuxPackageJson.os).toEqual(['linux'])
    expect(linuxPackageJson.cpu).toEqual(['x64'])
    expect(linuxPackageJson.libc).toBe('glibc')
    const binaryEntries = [...linuxEntries.keys()].filter((entry) => entry.startsWith('package/bin/'))
    expect(binaryEntries).toEqual(['package/bin/workers'])
    expect(sha256Hex(linuxEntries.get('package/bin/workers')!)).toBe(
      sha256Hex(binaryBytes['workers-linux-x64']),
    )
  })

  test('npm can stage inspectable package directories without packing tarballs', async () => {
    const outDir = join(tmp, 'npm-directory-only')
    const result = await packageRelease({
      manifest: manifestInput(),
      binaryPaths,
      renderers: ['npm'],
      rendererRegistry: createDefaultRendererRegistry(),
      rendererConfig: {
        npm: { packageScope: '@acme', pack: false },
      },
      outDir,
    })
    if (!result.ok) {
      throw new Error(`rendering failed: ${JSON.stringify(result.failures, null, 2)}`)
    }

    expect(result.packages.every((record) => record.artifact === undefined)).toBe(true)
    expect(result.packageArtifacts).toEqual([])
    expect(await Bun.file(join(outDir, 'npm', 'package-dirs', 'acme-workers', 'package.json')).exists()).toBe(true)
    expect(await Bun.file(join(outDir, 'npm', 'tarballs', 'acme-workers-0.1.0.tgz')).exists()).toBe(false)
  })

  test('PyPI renders wheels with platform tags, scripts, and RECORD hashes', async () => {
    const result = await renderAll()
    const muslWheel = result.packageArtifacts.find((artifact) =>
      artifact.fileName.includes('musllinux_1_2_x86_64'),
    )
    expect(muslWheel).toBeDefined()
    if (!muslWheel) return

    const entries = readZipEntries(await Bun.file(muslWheel.path).bytes())
    const script = entries.get('workers_cli-0.1.0.data/scripts/workers')
    expect(script).toBeDefined()
    expect(sha256Hex(script!)).toBe(sha256Hex(binaryBytes['workers-linux-x64-musl']))
    const record = Buffer.from(entries.get('workers_cli-0.1.0.dist-info/RECORD')!).toString('utf8')
    expect(record).toContain('workers_cli-0.1.0.data/scripts/workers,sha256=')
    expect(record).toContain('workers_cli-0.1.0.dist-info/RECORD,,')
    const wheel = Buffer.from(entries.get('workers_cli-0.1.0.dist-info/WHEEL')!).toString('utf8')
    expect(wheel).toContain('Tag: py3-none-musllinux_1_2_x86_64')
  })

  test('Homebrew renders one formula from manifest URLs and hashes', async () => {
    const result = await renderAll()
    const formula = result.packageArtifacts.find((artifact) => artifact.packageId === 'homebrew:workers-cli')
    expect(formula).toBeDefined()
    if (!formula) return

    const text = await Bun.file(formula.path).text()
    expect(text).toContain('class WorkersCli < Formula')
    expect(text).toContain('on_macos do')
    expect(text).toContain('on_linux do')
    expect(text).toContain('https://example.test/downloads/workers-darwin-arm64')
    expect(text).toContain(sha256Hex(binaryBytes['workers-linux-x64']))
    expect(text).not.toContain('workers-windows-x64')
    expect(text).toContain('bin.install "workers" => "workers"')
    expect(text).toContain('system "#{bin}/workers", "--help"')
  })

  test('Scoop renders Windows architecture entries with URL, hash, and bin mapping', async () => {
    const result = await renderAll()
    const scoop = result.packageArtifacts.find((artifact) => artifact.packageId === 'scoop:workers-cli')
    expect(scoop).toBeDefined()
    if (!scoop) return

    const manifest = JSON.parse(await Bun.file(scoop.path).text()) as {
      architecture: { '64bit': { url: string; hash: string; bin: string[][] } }
      pre_install?: unknown
      post_install?: unknown
    }
    expect(manifest.pre_install).toBeUndefined()
    expect(manifest.post_install).toBeUndefined()
    expect(manifest.architecture['64bit']).toEqual({
      url: 'https://example.test/downloads/workers-windows-x64.exe',
      hash: sha256Hex(binaryBytes['workers-windows-x64']),
      bin: [['workers.exe', 'workers']],
    })
  })

  test('all renderers return verified package artifact records', async () => {
    const result = await renderAll()

    expect(result.packages.map((record) => record.kind).sort()).toEqual([
      'formula',
      'npm-platform',
      'npm-platform',
      'npm-platform',
      'npm-platform',
      'npm-umbrella',
      'scoop-manifest',
      'wheel',
      'wheel',
      'wheel',
      'wheel',
    ])
    expect(result.packageArtifacts).toHaveLength(result.packages.length)
    for (const artifact of result.packageArtifacts) {
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(artifact.size).toBeGreaterThan(0)
    }
  })
})
