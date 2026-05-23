import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

const PUBLIC_PACKAGES = [
  { name: '@lili/core', dir: 'packages/core', bin: undefined },
  { name: '@lili/build', dir: 'packages/build', bin: 'li-build' },
  { name: '@lili/product', dir: 'packages/product', bin: 'li-product' },
  { name: '@lili/releases', dir: 'packages/releases', bin: 'li-release' },
] as const

function run(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const e = error as { stderr?: Buffer | string; stdout?: Buffer | string }
    throw new Error([
      `$ ${cmd} ${args.join(' ')}`,
      e.stdout ? String(e.stdout) : '',
      e.stderr ? String(e.stderr) : '',
    ].filter(Boolean).join('\n'))
  }
}

function packageJson(packageDir: string): Record<string, any> {
  return JSON.parse(readFileSync(join(REPO_ROOT, packageDir, 'package.json'), 'utf8'))
}

describe('public package readiness', () => {
  test('public package manifests have explicit publish file lists and no private flag', () => {
    for (const pkg of PUBLIC_PACKAGES) {
      const json = packageJson(pkg.dir)
      expect(json.name).toBe(pkg.name)
      expect(json.private).toBeUndefined()
      expect(json.files).toEqual(['src', 'README.md'])
      expect(json.exports?.['.']).toEqual({
        types: './src/index.ts',
        default: './src/index.ts',
      })
      if (pkg.bin) expect(json.bin?.[pkg.bin]).toMatch(/^\.\/src\/.*\.ts$/)
      expect(readFileSync(join(REPO_ROOT, pkg.dir, 'README.md'), 'utf8')).toContain(`# ${pkg.name}`)
    }
  })

  test('packed packages install in a temp Bun consumer and expose documented imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'lili-public-packages-'))
    const packDir = join(root, 'packs')
    const consumerDir = join(root, 'consumer')
    try {
      mkdirSync(packDir, { recursive: true })
      mkdirSync(consumerDir, { recursive: true })
      const tarballs: Record<string, string> = {}
      for (const pkg of PUBLIC_PACKAGES) {
        run('bun', ['pm', 'pack', '--destination', packDir, '--quiet'], join(REPO_ROOT, pkg.dir))
        const tarball = readdirSync(packDir)
          .filter((file) => file.endsWith('.tgz'))
          .map((file) => join(packDir, file))
          .find((file) => !Object.values(tarballs).includes(file))
        if (!tarball) throw new Error(`missing packed tarball for ${pkg.name}`)
        tarballs[pkg.name] = tarball

        const entries = run('tar', ['-tzf', tarball], REPO_ROOT).trim().split('\n')
        expect(entries).toContain('package/package.json')
        expect(entries).toContain('package/README.md')
        expect(entries).toContain('package/src/index.ts')
        expect(entries.some((entry) => entry.startsWith('package/test/'))).toBe(false)
        expect(entries.some((entry) => entry.startsWith('package/docs/'))).toBe(false)
      }

      writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify({
        name: 'lili-public-consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(
          PUBLIC_PACKAGES.map((pkg) => [pkg.name, `file:${tarballs[pkg.name]}`]),
        ),
        overrides: Object.fromEntries(
          PUBLIC_PACKAGES.map((pkg) => [pkg.name, `file:${tarballs[pkg.name]}`]),
        ),
      }, null, 2)}\n`)
      run('bun', ['install'], consumerDir)

      writeFileSync(join(consumerDir, 'smoke.ts'), `
import { createLocalTelemetrySink, defineCli, defineCommand, runLocalDoctor, z } from '@lili/core'
import { createCompilePlan } from '@lili/build'
import { Auth, Command, Field, Runtime, Shape, defineProduct, generateCli, normalizeProduct } from '@lili/product'
import { parseCliReleaseManifest } from '@lili/releases'
import { CliReleaseManifestSchema } from '@lili/releases/manifest'
import { verifyReleaseBinaries } from '@lili/releases/binary'
import { verifyPackageArtifacts } from '@lili/releases/artifacts'
import { packageRelease } from '@lili/releases/package'
import { planReleaseYank } from '@lili/releases/yank'
import { resolveReleaseRenderers } from '@lili/releases/renderers'
import { createDefaultRendererRegistry } from '@lili/releases/renderers/all'
import { npmRenderer } from '@lili/releases/renderers/npm'
import { pypiRenderer } from '@lili/releases/renderers/pypi'
import { homebrewRenderer } from '@lili/releases/renderers/homebrew'
import { scoopRenderer } from '@lili/releases/renderers/scoop'
import { planReleasePublish } from '@lili/releases/publishers'

const cli = defineCli({
  name: 'consumer',
  commands: [
    defineCommand({
      path: ['ping'],
      output: z.object({ ok: z.boolean() }),
      run() { return { ok: true } },
    }),
  ],
})
const doctor = await runLocalDoctor({ cliName: 'consumer', env: { PATH: '' }, packageManagers: ['bun'] })
const sink = createLocalTelemetrySink({ env: {}, append() {} })
await sink({ type: 'version.rendered', occurredAt: new Date().toISOString(), cli: { name: 'consumer' }, format: 'json', formatExplicit: true, invocation: 'cli', agent: true, surface: { kind: 'version' } })

const plan = createCompilePlan({
  entrypoint: 'src/cli.ts',
  outfile: 'dist/consumer',
  target: 'bun-darwin-arm64',
  constants: {
    buildToolVersion: '0.0.0',
    contractDigest: 'sha256:example',
    releaseVersion: '0.1.0',
    sourceCommit: '0000000',
  },
})

const product = defineProduct({
  id: 'consumer',
  name: 'Consumer',
  version: '0.1.0',
  auth: Auth.none(),
  remote: { baseUrl: Runtime.literal('https://api.example.test') },
  commands: {
    deploy: Command.remoteHttp({
      summary: 'Deploy',
      input: Shape.object({ name: Field.string('Name') }),
      output: Shape.object({ id: Field.string('ID') }),
      http: { method: 'POST', path: '/deployments', bind: { body: true } },
    }),
  },
})
const generated = generateCli(normalizeProduct(product), {
  generatorVersion: 'consumer',
  canonicalIrDigest: 'sha256:catalog',
  generationOptionsDigest: 'sha256:options',
})

const parsed = parseCliReleaseManifest({
  manifestVersion: 1,
  metadata: { description: 'Consumer CLI.' },
  subject: {
    id: 'consumer',
    name: 'Consumer',
    version: '0.1.0',
    commit: '0000000',
    contract: { kind: 'core-command-manifest', digest: 'sha256:catalog' },
  },
  release: { version: '0.1.0', createdAt: new Date().toISOString(), generatorVersion: 'consumer' },
  runtime: { command: 'consumer' },
  binaries: [],
  packages: [],
})

const refs = [
  cli,
  doctor,
  plan,
  generated,
  parsed,
  CliReleaseManifestSchema,
  verifyReleaseBinaries,
  verifyPackageArtifacts,
  packageRelease,
  planReleaseYank,
  resolveReleaseRenderers,
  createDefaultRendererRegistry(),
  npmRenderer,
  pypiRenderer,
  homebrewRenderer,
  scoopRenderer,
  planReleasePublish,
]
if (refs.some((value) => value === undefined || value === null)) {
  throw new Error('public package import smoke failed')
}
if (!parsed.ok || !plan.compileFlagsDigest || !generated.includes("defineCli")) {
  throw new Error('public package runtime smoke failed')
}
`)
      run('bun', ['smoke.ts'], consumerDir)

      for (const pkg of PUBLIC_PACKAGES) {
        if (!pkg.bin) continue
        run('bun', [join(consumerDir, 'node_modules/.bin', pkg.bin), '--version'], consumerDir)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
