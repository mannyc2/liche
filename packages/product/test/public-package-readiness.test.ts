import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PUBLIC_PACKAGE_VERSION = '0.2.0'
const BUN_ENGINE = '>=1.3.0'

const PUBLIC_PACKAGES = [
  { name: '@lili/core', dir: 'packages/core', bin: undefined },
  { name: '@lili/build', dir: 'packages/build', bin: 'li-build' },
  { name: '@lili/product', dir: 'packages/product', bin: 'li-product' },
  { name: '@lili/releases', dir: 'packages/releases', bin: 'li-release' },
] as const

const EXPECTED_PUBLIC_VALUES: Record<string, string[]> = {
  '@lili/core': [
    'Formatter',
    'applyAuth',
    'authSwitch',
    'authWhoami',
    'callHttpOperation',
    'commandError',
    'createConfig',
    'createFileSessionStore',
    'createLocalTelemetrySink',
    'defineCli',
    'defineCommand',
    'fail',
    'logoutAuthSession',
    'middleware',
    'oauthDeviceLogin',
    'ok',
    'resolveAuth',
    'resolveContext',
    'runLocalDoctor',
    'secret',
    'serializeHttpOperationRequest',
    'z',
  ],
  '@lili/build': [
    'BuildRecordSchema',
    'TARGETS',
    'TARGET_PRESETS',
    'buildBinaries',
    'canonicalDigest',
    'canonicalize',
    'compileEntrypoint',
    'compileFlagsDigest',
    'createCompileFlagProfile',
    'createCompilePlan',
    'isTargetPreset',
    'parseBuildRecord',
    'renderCompileEntrypoint',
    'resolveTargets',
  ],
  '@lili/product': [
    'Auth',
    'Command',
    'DEFAULT_GENERATED_VOCABULARY',
    'Field',
    'FieldBuilder',
    'Runtime',
    'Shape',
    'buildAuthManifest',
    'canonicalDigest',
    'canonicalize',
    'checkAgainstDir',
    'compileProduct',
    'conformProduct',
    'createConfig',
    'defineProduct',
    'fieldToJsonSchema',
    'generateAgentReference',
    'generateCli',
    'generateCommandManifest',
    'generateConfigSchema',
    'generateDocsReference',
    'generateMcpTools',
    'generateOpenapi',
    'generateToDir',
    'hashString',
    'lintCatalog',
    'normalizeProduct',
    'resolveListShape',
    'shouldGenerateConfigSchema',
    'vocabulary',
    'z',
  ],
  '@lili/releases': [
    'BuildRecordSchema',
    'CliReleaseManifestSchema',
    'DEFAULT_NPM_REGISTRY_AUDIENCE',
    'OIDC_EXECUTOR_FAILURE_CODES',
    'OIDC_PROVIDERS',
    'PACKAGE_ECOSYSTEMS',
    'PUBLISHER_ENV_NAMES',
    'ReleasesConfigSchema',
    'audienceForNpmRegistry',
    'createOfficialFlowHandoff',
    'defineReleasesConfig',
    'executeReleasePublish',
    'isPackageEcosystem',
    'loadPublisherCredentialsFromEnv',
    'manifestFromBuildRecord',
    'npmOidcExchangeUrl',
    'packageRelease',
    'parseBuildRecord',
    'parseCliReleaseManifest',
    'planReleasePublish',
    'planReleaseYank',
    'preflightReleasePublish',
    'resolveReleaseRenderers',
    'verifyPackageArtifacts',
    'verifyReleaseBinaries',
  ],
  '@lili/releases/manifest': ['CliReleaseManifestSchema', 'parseCliReleaseManifest'],
  '@lili/releases/binary': ['verifyReleaseBinaries'],
  '@lili/releases/artifacts': ['verifyPackageArtifacts'],
  '@lili/releases/package': ['packageRelease'],
  '@lili/releases/yank': ['planReleaseYank'],
  '@lili/releases/renderers': ['PACKAGE_ECOSYSTEMS', 'isPackageEcosystem', 'resolveReleaseRenderers'],
  '@lili/releases/renderers/all': [
    'createDefaultRendererRegistry',
    'homebrewRenderer',
    'npmRenderer',
    'pypiRenderer',
    'scoopRenderer',
  ],
  '@lili/releases/renderers/npm': ['npmRenderer'],
  '@lili/releases/renderers/pypi': ['pypiRenderer'],
  '@lili/releases/renderers/homebrew': ['homebrewRenderer'],
  '@lili/releases/renderers/scoop': ['scoopRenderer'],
  '@lili/releases/publishers': [
    'DEFAULT_NPM_REGISTRY_AUDIENCE',
    'OIDC_EXECUTOR_FAILURE_CODES',
    'OIDC_PROVIDERS',
    'PUBLISHER_ENV_NAMES',
    'audienceForNpmRegistry',
    'executeReleasePublish',
    'loadPublisherCredentialsFromEnv',
    'npmOidcExchangeUrl',
    'planReleasePublish',
    'preflightReleasePublish',
  ],
}

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

function exportedTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => exportedTargets(entry))
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((entry) => exportedTargets(entry))
  }
  return []
}

function packedPath(target: string): string {
  if (!target.startsWith('./')) throw new Error(`export target must be package-relative: ${target}`)
  return `package/${target.slice(2)}`
}

function expectPackedTargets(entries: string[], json: Record<string, any>) {
  for (const target of new Set(exportedTargets(json.exports))) {
    expect(entries).toContain(packedPath(target))
  }
  for (const target of Object.values(json.bin ?? {})) {
    expect(entries).toContain(packedPath(String(target)))
  }
}

describe('public package readiness', () => {
  test('public package manifests have explicit publish file lists and no private flag', () => {
    for (const pkg of PUBLIC_PACKAGES) {
      const json = packageJson(pkg.dir)
      expect(json.name).toBe(pkg.name)
      expect(json.version).toBe(PUBLIC_PACKAGE_VERSION)
      expect(json.private).toBeUndefined()
      expect(json.engines?.bun).toBe(BUN_ENGINE)
      expect(json.files).toEqual(['src', 'README.md'])
      expect(json.exports?.['.']).toEqual({
        types: './src/index.ts',
        default: './src/index.ts',
      })
      for (const [dependencyName, version] of Object.entries(json.dependencies ?? {})) {
        if (dependencyName.startsWith('@lili/')) expect(version).toBe(`^${PUBLIC_PACKAGE_VERSION}`)
      }
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

        const json = packageJson(pkg.dir)
        const entries = run('tar', ['-tzf', tarball], REPO_ROOT).trim().split('\n')
        expect(entries).toContain('package/package.json')
        expect(entries).toContain('package/README.md')
        expect(entries).toContain('package/src/index.ts')
        expectPackedTargets(entries, json)
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
import * as Core from '@lili/core'
import * as Build from '@lili/build'
import * as Product from '@lili/product'
import * as Releases from '@lili/releases'
import * as ReleaseManifest from '@lili/releases/manifest'
import * as ReleaseBinary from '@lili/releases/binary'
import * as ReleaseArtifacts from '@lili/releases/artifacts'
import * as ReleasePackage from '@lili/releases/package'
import * as ReleaseYank from '@lili/releases/yank'
import * as ReleaseRenderers from '@lili/releases/renderers'
import * as ReleaseRendererAll from '@lili/releases/renderers/all'
import * as ReleaseRendererNpm from '@lili/releases/renderers/npm'
import * as ReleaseRendererPypi from '@lili/releases/renderers/pypi'
import * as ReleaseRendererHomebrew from '@lili/releases/renderers/homebrew'
import * as ReleaseRendererScoop from '@lili/releases/renderers/scoop'
import * as ReleasePublishers from '@lili/releases/publishers'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const expectedPublicValues = ${JSON.stringify(EXPECTED_PUBLIC_VALUES, null, 2)}
const modules = {
  '@lili/core': Core,
  '@lili/build': Build,
  '@lili/product': Product,
  '@lili/releases': Releases,
  '@lili/releases/manifest': ReleaseManifest,
  '@lili/releases/binary': ReleaseBinary,
  '@lili/releases/artifacts': ReleaseArtifacts,
  '@lili/releases/package': ReleasePackage,
  '@lili/releases/yank': ReleaseYank,
  '@lili/releases/renderers': ReleaseRenderers,
  '@lili/releases/renderers/all': ReleaseRendererAll,
  '@lili/releases/renderers/npm': ReleaseRendererNpm,
  '@lili/releases/renderers/pypi': ReleaseRendererPypi,
  '@lili/releases/renderers/homebrew': ReleaseRendererHomebrew,
  '@lili/releases/renderers/scoop': ReleaseRendererScoop,
  '@lili/releases/publishers': ReleasePublishers,
}

for (const [specifier, mod] of Object.entries(modules)) {
  const actual = Object.keys(mod).sort()
  const expected = expectedPublicValues[specifier]
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(\`\${specifier} exported \${JSON.stringify(actual)}, expected \${JSON.stringify(expected)}\`)
  }
}

const cli = Core.defineCli({
  name: 'consumer',
  commands: [
    Core.defineCommand({
      path: ['ping'],
      output: Core.z.object({ ok: Core.z.boolean() }),
      run() { return { ok: true } },
    }),
  ],
})
const doctor = await Core.runLocalDoctor({ cliName: 'consumer', env: { PATH: '' }, packageManagers: ['bun'] })
const sink = Core.createLocalTelemetrySink({ env: {}, append() {} })
await sink({ type: 'version.rendered', occurredAt: new Date().toISOString(), cli: { name: 'consumer' }, format: 'json', formatExplicit: true, invocation: 'cli', agent: true, surface: { kind: 'version' } })

const plan = Build.createCompilePlan({
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

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.method !== 'POST') return Response.json({ error: 'method' }, { status: 405 })
    if (new URL(request.url).pathname !== '/deployments') {
      return Response.json({ error: 'path' }, { status: 404 })
    }
    const body = await request.json()
    if (body.name !== 'Ada') return Response.json({ error: 'body' }, { status: 400 })
    return Response.json({ id: 'dep-Ada' })
  },
})

const generatedDir = join(process.cwd(), 'generated-consumer')
rmSync(generatedDir, { force: true, recursive: true })
mkdirSync(generatedDir, { recursive: true })

let generated
let generatedResult
try {
  const product = Product.defineProduct({
    id: 'consumer',
    name: 'Consumer',
    version: '0.1.0',
    auth: Product.Auth.none(),
    config: Product.createConfig({
      fields: Product.Shape.object({
        apiBaseUrl: Product.Field.string('API base URL').default('https://api.example.test'),
      }),
    }),
    remote: { baseUrl: Product.Runtime.literal(server.url.origin) },
    commands: {
      deploy: Product.Command.remoteHttp({
        summary: 'Deploy',
        effects: { kind: 'write', idempotent: false },
        policy: { dangerous: false, requiresConfirmation: false, conformanceEligible: true },
        examples: [{ command: 'consumer deploy --name Ada --json' }],
        input: Product.Shape.object({ name: Product.Field.string('Name') }),
        output: Product.Shape.object({ id: Product.Field.string('ID') }),
        http: { method: 'POST', path: '/deployments', bind: { body: true } },
        surfaces: { agent: true },
      }),
    },
  })
  const catalog = Product.normalizeProduct(product)
  generated = Product.generateCli(catalog, {
    generatorVersion: 'consumer',
    canonicalIrDigest: 'sha256:catalog',
    generationOptionsDigest: 'sha256:options',
  })
  generatedResult = await Product.generateToDir(product, {
    outDir: generatedDir,
    generatorVersion: 'consumer',
  })
  const expectedArtifactIds = [
    'agent-reference',
    'catalog',
    'cli',
    'command-manifest',
    'config-schema',
    'discovery',
    'docs-reference',
    'mcp-tools',
    'openapi',
  ]
  const actualArtifactIds = Object.keys(generatedResult.artifacts).sort()
  if (JSON.stringify(actualArtifactIds) !== JSON.stringify(expectedArtifactIds)) {
    throw new Error('generated artifact ids drifted: ' + JSON.stringify(actualArtifactIds))
  }
  const surfaceIds = generatedResult.manifest.surfaces.map((surface) => surface.id).sort()
  if (JSON.stringify(surfaceIds) !== JSON.stringify(expectedArtifactIds)) {
    throw new Error('generated surface manifest drifted: ' + JSON.stringify(surfaceIds))
  }
  const check = await Product.checkAgainstDir(product, { outDir: generatedDir, generatorVersion: 'consumer' })
  if (!check.ok) throw new Error('generated surfaces were not check-clean: ' + check.drift.join('\\n'))

  const commandManifest = JSON.parse(readFileSync(generatedResult.artifacts['command-manifest'].path, 'utf8'))
  const mcpTools = JSON.parse(readFileSync(generatedResult.artifacts['mcp-tools'].path, 'utf8'))
  const configSchema = JSON.parse(readFileSync(generatedResult.artifacts['config-schema'].path, 'utf8'))
  const agentReference = readFileSync(generatedResult.artifacts['agent-reference'].path, 'utf8')
  const docsReference = readFileSync(generatedResult.artifacts['docs-reference'].path, 'utf8')
  if (commandManifest.commands[0].id !== 'deploy') throw new Error('command manifest missing deploy')
  if (mcpTools.tools[0].name !== 'deploy') throw new Error('MCP tools missing deploy')
  if (configSchema.properties.apiBaseUrl.description !== 'API base URL') {
    throw new Error('config schema missing Product config field')
  }
  if (!agentReference.includes('consumer deploy --name Ada --json')) {
    throw new Error('agent reference missing example command')
  }
  if (!docsReference.includes('### deploy')) throw new Error('docs reference missing deploy')

  const generatedModule = await import(generatedResult.generatedPath + '?t=' + Date.now())
  let generatedStdout = ''
  let generatedStderr = ''
  let generatedExitCode = 0
  await generatedModule.default.serve(['deploy', '--name', 'Ada', '--json'], {
    stdout: (chunk) => { generatedStdout += chunk },
    stderr: (chunk) => { generatedStderr += chunk },
    exit: (code) => { generatedExitCode = code },
    isTty: false,
    env: {},
  })
  if (generatedExitCode !== 0) {
    throw new Error('generated CLI failed: ' + generatedStdout + generatedStderr)
  }
  const generatedBody = JSON.parse(generatedStdout)
  if (generatedBody.data.id !== 'dep-Ada') {
    throw new Error('generated CLI returned wrong data: ' + generatedStdout)
  }
} finally {
  server.stop(true)
  rmSync(generatedDir, { force: true, recursive: true })
}

const parsed = Releases.parseCliReleaseManifest({
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
  generatedResult,
  parsed,
  ReleaseManifest.CliReleaseManifestSchema,
  ReleaseBinary.verifyReleaseBinaries,
  ReleaseArtifacts.verifyPackageArtifacts,
  ReleasePackage.packageRelease,
  ReleaseYank.planReleaseYank,
  ReleaseRenderers.resolveReleaseRenderers,
  ReleaseRendererAll.createDefaultRendererRegistry(),
  ReleaseRendererNpm.npmRenderer,
  ReleaseRendererPypi.pypiRenderer,
  ReleaseRendererHomebrew.homebrewRenderer,
  ReleaseRendererScoop.scoopRenderer,
  ReleasePublishers.planReleasePublish,
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
        expect(run('bun', [join(consumerDir, 'node_modules/.bin', pkg.bin), '--version'], consumerDir).trim()).toBe(
          PUBLIC_PACKAGE_VERSION,
        )
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
