import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const PUBLIC_PACKAGE_VERSION = '0.6.0'
const BUN_ENGINE = '>=1.3.0'

const PUBLIC_PACKAGES = [
  { name: '@liche/core', dir: 'packages/core', bin: undefined },
  { name: '@liche/extensions', dir: 'packages/extensions', bin: undefined },
  { name: '@liche/agents', dir: 'packages/extensions/agents/bundle', bin: undefined },
  { name: '@liche/auth', dir: 'packages/extensions/auth', bin: undefined },
  { name: '@liche/completions', dir: 'packages/extensions/completions', bin: undefined },
  { name: '@liche/config', dir: 'packages/extensions/config', bin: undefined },
  { name: '@liche/mcp-installer', dir: 'packages/extensions/agents/mcp-installer', bin: undefined },
  { name: '@liche/mcp-server', dir: 'packages/extensions/agents/mcp-server', bin: undefined },
  { name: '@liche/skills-installer', dir: 'packages/extensions/agents/skills-installer', bin: undefined },
  { name: '@liche/skills-runtime', dir: 'packages/extensions/agents/skills-runtime', bin: undefined },
  { name: '@liche/telemetry', dir: 'packages/extensions/telemetry', bin: undefined },
  { name: '@liche/tokens', dir: 'packages/extensions/agents/tokens', bin: undefined },
  { name: '@liche/build', dir: 'packages/build', bin: 'liche-build' },
  { name: '@liche/product', dir: 'packages/product', bin: 'liche-product' },
  { name: '@liche/releases', dir: 'packages/releases', bin: 'liche-release' },
] as const

function expectedPackageFiles(packageName: string): string[] {
  return packageName === '@liche/core'
    ? ['src', 'README.md', 'SKILL.md', 'LICENSE']
    : ['src', 'README.md', 'LICENSE']
}

const EXPECTED_PUBLIC_VALUES: Record<string, string[]> = {
  '@liche/core': [
    'Formatter',
    'ParseError',
    'ValidationError',
    'applyAuth',
    'callHttpOperation',
    'collectCommandContracts',
    'commandError',
    'createLifecycleEvent',
    'defaultHelpRenderer',
    'defineCli',
    'defineCommand',
    'defineExtension',
    'defineGlobal',
    'defineOutputRenderer',
    'dispatch',
    'emitLifecycleEvent',
    'eventCommand',
    'execute',
    'fail',
    'getCliState',
    'help',
    'manifest',
    'manifestEnvelope',
    'mcpToolName',
    'mergeHooks',
    'middleware',
    'ok',
    'outputControls',
    'parseSchema',
    'reflectionControls',
    'run',
    'secret',
    'selectCommand',
    'serializeHttpOperationRequest',
    'version',
    'z',
  ],
  '@liche/extensions': [
    'agents',
    'auth',
    'authGlobals',
    'authSwitch',
    'authWhoami',
    'completions',
    'config',
    'configDoctor',
    'consoleSink',
    'createFileSessionStore',
    'detectInvocation',
    'env',
    'files',
    'httpSink',
    'jsonlFileSink',
    'llms',
    'logoutAuthSession',
    'mcpInstaller',
    'mcpServer',
    'noopSink',
    'oauthDeviceLogin',
    'resolveAuth',
    'resolveContext',
    'skillsInstaller',
    'skillsRuntime',
    'telemetry',
    'tokenCount',
    'tokenSlice',
    'tokens',
  ],
  '@liche/agents': ['agents', 'llms'],
  '@liche/auth': [
    'auth',
    'authGlobals',
    'authSwitch',
    'authWhoami',
    'createFileSessionStore',
    'detectInvocation',
    'logoutAuthSession',
    'oauthDeviceLogin',
    'resolveAuth',
    'resolveContext',
  ],
  '@liche/completions': ['completionScript', 'completions'],
  '@liche/config': ['config', 'configDoctor', 'env', 'files'],
  '@liche/mcp-installer': ['mcpInstaller', 'writeMcp'],
  '@liche/mcp-server': ['MCP_PROTOCOL_VERSION', 'handleMcpHttp', 'mcpMessage', 'mcpServer', 'serveMcp'],
  '@liche/skills-installer': ['skillsInstaller', 'writeSkill'],
  '@liche/skills-runtime': ['skillIndex', 'skillMarkdown', 'skillsRuntime'],
  '@liche/telemetry': ['consoleSink', 'httpSink', 'jsonlFileSink', 'noopSink', 'telemetry', 'wrapSink'],
  '@liche/tokens': ['tokenCount', 'tokenSlice', 'tokens'],
  '@liche/build': [
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
  '@liche/product': [
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
  '@liche/releases': [
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
  '@liche/releases/manifest': ['CliReleaseManifestSchema', 'parseCliReleaseManifest'],
  '@liche/releases/binary': ['verifyReleaseBinaries'],
  '@liche/releases/artifacts': ['verifyPackageArtifacts'],
  '@liche/releases/package': ['packageRelease'],
  '@liche/releases/yank': ['planReleaseYank'],
  '@liche/releases/renderers': ['PACKAGE_ECOSYSTEMS', 'isPackageEcosystem', 'resolveReleaseRenderers'],
  '@liche/releases/renderers/all': [
    'createDefaultRendererRegistry',
    'homebrewRenderer',
    'npmRenderer',
    'pypiRenderer',
    'scoopRenderer',
  ],
  '@liche/releases/renderers/npm': ['npmRenderer'],
  '@liche/releases/renderers/pypi': ['pypiRenderer'],
  '@liche/releases/renderers/homebrew': ['homebrewRenderer'],
  '@liche/releases/renderers/scoop': ['scoopRenderer'],
  '@liche/releases/publishers': [
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
  const normalized = target.startsWith('./') ? target.slice(2) : target
  return `package/${normalized}`
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
      expect(json.files).toEqual(expectedPackageFiles(pkg.name))
      expect(json.exports?.['.']).toEqual({
        types: './src/index.ts',
        default: './src/index.ts',
      })
      for (const [dependencyName, version] of Object.entries(json.dependencies ?? {})) {
        if (dependencyName.startsWith('@liche/')) expect(version).toBe(`^${PUBLIC_PACKAGE_VERSION}`)
      }
      if (pkg.bin) expect(json.bin?.[pkg.bin]).toMatch(/^src\/.*\.ts$/)
      expect(readFileSync(join(REPO_ROOT, pkg.dir, 'README.md'), 'utf8')).toContain(`# ${pkg.name}`)
    }
  })

  test('packed packages install in a temp Bun consumer and expose documented imports', () => {
    const root = mkdtempSync(join(tmpdir(), 'liche-public-packages-'))
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
        expect(entries).toContain('package/LICENSE')
        expect(entries).toContain('package/src/index.ts')
        expectPackedTargets(entries, json)
        expect(entries.some((entry) => entry.startsWith('package/test/'))).toBe(false)
        expect(entries.some((entry) => entry.startsWith('package/docs/'))).toBe(false)
      }

      writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify({
        name: 'liche-public-consumer',
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
import * as Core from '@liche/core'
import * as Extensions from '@liche/extensions'
import * as Agents from '@liche/agents'
import * as Auth from '@liche/auth'
import * as Completions from '@liche/completions'
import * as Config from '@liche/config'
import * as McpInstaller from '@liche/mcp-installer'
import * as McpServer from '@liche/mcp-server'
import * as SkillsInstaller from '@liche/skills-installer'
import * as SkillsRuntime from '@liche/skills-runtime'
import * as Telemetry from '@liche/telemetry'
import * as Tokens from '@liche/tokens'
import * as Build from '@liche/build'
import * as Product from '@liche/product'
import * as Releases from '@liche/releases'
import * as ReleaseManifest from '@liche/releases/manifest'
import * as ReleaseBinary from '@liche/releases/binary'
import * as ReleaseArtifacts from '@liche/releases/artifacts'
import * as ReleasePackage from '@liche/releases/package'
import * as ReleaseYank from '@liche/releases/yank'
import * as ReleaseRenderers from '@liche/releases/renderers'
import * as ReleaseRendererAll from '@liche/releases/renderers/all'
import * as ReleaseRendererNpm from '@liche/releases/renderers/npm'
import * as ReleaseRendererPypi from '@liche/releases/renderers/pypi'
import * as ReleaseRendererHomebrew from '@liche/releases/renderers/homebrew'
import * as ReleaseRendererScoop from '@liche/releases/renderers/scoop'
import * as ReleasePublishers from '@liche/releases/publishers'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const expectedPublicValues = ${JSON.stringify(EXPECTED_PUBLIC_VALUES, null, 2)}
const modules = {
  '@liche/core': Core,
  '@liche/extensions': Extensions,
  '@liche/agents': Agents,
  '@liche/auth': Auth,
  '@liche/completions': Completions,
  '@liche/config': Config,
  '@liche/mcp-installer': McpInstaller,
  '@liche/mcp-server': McpServer,
  '@liche/skills-installer': SkillsInstaller,
  '@liche/skills-runtime': SkillsRuntime,
  '@liche/telemetry': Telemetry,
  '@liche/tokens': Tokens,
  '@liche/build': Build,
  '@liche/product': Product,
  '@liche/releases': Releases,
  '@liche/releases/manifest': ReleaseManifest,
  '@liche/releases/binary': ReleaseBinary,
  '@liche/releases/artifacts': ReleaseArtifacts,
  '@liche/releases/package': ReleasePackage,
  '@liche/releases/yank': ReleaseYank,
  '@liche/releases/renderers': ReleaseRenderers,
  '@liche/releases/renderers/all': ReleaseRendererAll,
  '@liche/releases/renderers/npm': ReleaseRendererNpm,
  '@liche/releases/renderers/pypi': ReleaseRendererPypi,
  '@liche/releases/renderers/homebrew': ReleaseRendererHomebrew,
  '@liche/releases/renderers/scoop': ReleaseRendererScoop,
  '@liche/releases/publishers': ReleasePublishers,
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
  extensions: [Extensions.completions()],
  commands: [
    Core.defineCommand({
      path: ['ping'],
      output: Core.z.object({ ok: Core.z.boolean() }),
      run() { return { ok: true } },
    }),
  ],
})
const telemetryExt = Extensions.telemetry({ sinks: [Extensions.noopSink()], env: {} })
if (!telemetryExt.events || telemetryExt.events.length === 0) throw new Error('telemetry extension missing events')
if ('runLocalDoctor' in Extensions) throw new Error('runLocalDoctor leaked from @liche/extensions root')

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
  telemetryExt,
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
