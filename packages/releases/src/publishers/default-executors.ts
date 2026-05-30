import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CliReleaseManifest } from '../manifest/index.js'
import type {
  HomebrewStepExecutor,
  NpmCredentials,
  PublisherExecutorRegistry,
  PypiStepExecutor,
  ScoopStepExecutor,
  StepExecutorResult,
} from './index.js'
import { audienceForNpmRegistry, npmOidcExchangeUrl } from './index.js'
import type { ResolvedGitRepoTarget } from './plan.js'

type CommandStatus = {
  code: number
  stdout: string
  stderr: string
}

export type ReleaseCommandRunner = (
  argv: readonly string[],
  options?: { cwd?: string; env?: Record<string, string | undefined> },
) => Promise<CommandStatus>

export type CliPublisherExecutorOptions = {
  commandRunner?: ReleaseCommandRunner
  env?: Record<string, string | undefined>
}

type GithubUploadResult =
  | { ok: true; assets: string[]; dryRun: boolean }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> }

function createCommandRunner(env: Record<string, string | undefined>): ReleaseCommandRunner {
  return async (argv, options = {}) => {
    const spawnOptions: any = {
      env: { ...env, ...options.env },
      stdout: 'pipe',
      stderr: 'pipe',
    }
    if (options.cwd) spawnOptions.cwd = options.cwd
    const child = Bun.spawn([...argv], spawnOptions)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout as unknown as ReadableStream).text(),
      new Response(child.stderr as unknown as ReadableStream).text(),
      child.exited,
    ])
    return { code, stdout, stderr }
  }
}

async function commandStatus(
  argv: readonly string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<CommandStatus> {
  return createCommandRunner(Bun.env)(argv, options)
}

async function runStepCommand(
  argv: readonly string[],
  options: {
    cwd?: string
    env?: Record<string, string | undefined>
    metadata?: Record<string, unknown>
    redact?: readonly string[]
    runner?: ReleaseCommandRunner
  } = {},
): Promise<StepExecutorResult> {
  const runner = options.runner ?? commandStatus
  const result = await runner(argv, options)
  if (result.code === 0) {
    return {
      ok: true,
      metadata: {
        stdout: result.stdout.trim(),
        ...options.metadata,
      },
    }
  }
  const redacted = redact(`${result.stderr}\n${result.stdout}`, options.redact)
  return {
    ok: false,
    failure: {
      code: 'COMMAND_FAILED',
      message: `${argv[0]} exited with ${result.code}`,
      details: { stderr: redacted.trim() },
    },
  }
}

function redact(value: string, secrets: readonly string[] | undefined): string {
  let out = value
  for (const secret of secrets ?? []) {
    if (secret) out = out.split(secret).join('[redacted]')
  }
  return out
}

function gitExtraHeader(target: ResolvedGitRepoTarget, token: string): string {
  return `http.https://github.com/${target.owner}/${target.repo}.git.extraheader=Authorization: bearer ${token}`
}

async function publishGitFile(input: {
  bytes: Uint8Array
  message: string
  metadata: Record<string, unknown>
  runner: ReleaseCommandRunner
  target: ResolvedGitRepoTarget
  targetPath: string
  token: string
}): Promise<StepExecutorResult> {
  const root = await mkdtemp(join(tmpdir(), 'liche-release-git-'))
  const checkout = join(root, 'repo')
  const repoUrl = `https://github.com/${input.target.owner}/${input.target.repo}.git`
  const redactions = [input.token]
  try {
    let result = await runStepCommand(
      [
        'git',
        '-c',
        gitExtraHeader(input.target, input.token),
        'clone',
        '--depth',
        '1',
        '--branch',
        input.target.branch,
        repoUrl,
        checkout,
      ],
      { redact: redactions, runner: input.runner },
    )
    if (!result.ok) return result

    const destination = join(checkout, input.targetPath)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, input.bytes)

    for (const argv of [
      ['git', 'config', 'user.email', 'release-bot@users.noreply.github.com'],
      ['git', 'config', 'user.name', 'release-bot'],
      ['git', 'add', input.targetPath],
    ] as const) {
      result = await runStepCommand(argv, { cwd: checkout, runner: input.runner })
      if (!result.ok) return result
    }

    const diff = await input.runner(['git', 'diff', '--cached', '--quiet'], { cwd: checkout })
    if (diff.code === 0) return { ok: true, metadata: { changed: false, ...input.metadata } }
    if (diff.code !== 1) {
      return {
        ok: false,
        failure: {
          code: 'GIT_DIFF_FAILED',
          message: `git diff exited with ${diff.code}`,
          details: { stderr: diff.stderr.trim() },
        },
      }
    }

    result = await runStepCommand(['git', 'commit', '-m', input.message], { cwd: checkout, runner: input.runner })
    if (!result.ok) return result
    return await runStepCommand(
      ['git', '-c', gitExtraHeader(input.target, input.token), 'push', 'origin', `HEAD:${input.target.branch}`],
      {
        cwd: checkout,
        metadata: input.metadata,
        redact: redactions,
        runner: input.runner,
      },
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

function homebrewExecutor(runner: ReleaseCommandRunner): HomebrewStepExecutor {
  return (input) => {
    if (input.credentials.kind !== 'token') {
      return { ok: false, failure: { code: 'TOKEN_REQUIRED', message: 'Homebrew publishing requires a GitHub token' } }
    }
    return publishGitFile({
      bytes: input.bytes,
      message: `${input.step.name} ${input.step.version}`,
      metadata: {
        command: 'git clone/write/commit/push',
        repository: `${input.step.tap.owner}/${input.step.tap.repo}`,
        branch: input.step.tap.branch,
        targetPath: input.step.targetPath,
      },
      runner,
      target: input.step.tap,
      targetPath: input.step.targetPath,
      token: input.credentials.githubToken,
    })
  }
}

function scoopExecutor(runner: ReleaseCommandRunner): ScoopStepExecutor {
  return (input) => {
    if (input.credentials.kind !== 'token') {
      return { ok: false, failure: { code: 'TOKEN_REQUIRED', message: 'Scoop publishing requires a GitHub token' } }
    }
    return publishGitFile({
      bytes: input.bytes,
      message: `${input.step.name} ${input.step.version}`,
      metadata: {
        command: 'git clone/write/commit/push',
        repository: `${input.step.bucket.owner}/${input.step.bucket.repo}`,
        branch: input.step.bucket.branch,
        targetPath: input.step.targetPath,
      },
      runner,
      target: input.step.bucket,
      targetPath: input.step.targetPath,
      token: input.credentials.githubToken,
    })
  }
}

function pypiExecutor(runner: ReleaseCommandRunner): PypiStepExecutor {
  return (input) => {
    if (input.credentials.kind !== 'token') {
      return {
        ok: false,
        failure: {
          code: 'TRUSTED_PUBLISHER_MISMATCH',
          message: 'PyPI trusted publishing must run through the official PyPI trusted-publisher workflow executor',
          details: {
            provider: input.credentials.provider,
            audience: input.credentials.audience,
            repositoryUrl: input.step.repositoryUrl,
          },
        },
      }
    }

    return runStepCommand(
      [
        'python',
        '-m',
        'twine',
        'upload',
        '--non-interactive',
        '--repository-url',
        input.step.repositoryUrl,
        input.step.artifactPath,
      ],
      {
        env: {
          TWINE_USERNAME: '__token__',
          TWINE_PASSWORD: input.credentials.token,
        },
        metadata: {
          command: 'python -m twine upload',
          provenance: {
            kind: 'pypi',
            trustedPublisher: false,
            repositoryUrl: input.step.repositoryUrl,
          },
        },
        redact: [input.credentials.token],
        runner,
      },
    )
  }
}

export function createCliPublisherExecutors(options: CliPublisherExecutorOptions = {}): PublisherExecutorRegistry {
  const env = options.env ?? Bun.env
  const runner = options.commandRunner ?? createCommandRunner(env)
  return {
    npm: async (input) => {
      const token = await npmPublishToken(input.credentials, input.step.registry, input.step.name, input.oidc)
      if (!token.ok) return token
      const args = [
        'npm',
        'publish',
        input.step.artifactPath,
        '--registry',
        input.step.registry,
        '--tag',
        input.step.tag,
        '--access',
        input.step.access,
      ]
      const provenanceRequested = Boolean(env['GITHUB_ACTIONS'])
      if (provenanceRequested) args.push('--provenance')
      return await runStepCommand(args, {
        env: {
          NODE_AUTH_TOKEN: token.token,
          NPM_TOKEN: token.token,
        },
        metadata: {
          command: 'npm publish',
          provenance: {
            kind: 'npm',
            requested: provenanceRequested,
            registry: input.step.registry,
            oidc: input.credentials.kind === 'oidc',
          },
        },
        redact: [token.token],
        runner,
      })
    },
    pypi: pypiExecutor(runner),
    homebrew: homebrewExecutor(runner),
    scoop: scoopExecutor(runner),
  }
}

async function npmPublishToken(
  credentials: NpmCredentials,
  registry: string,
  packageName: string,
  oidc: Parameters<NonNullable<PublisherExecutorRegistry['npm']>>[0]['oidc'],
): Promise<
  | { ok: true; token: string }
  | { ok: false; failure: { code: string; message: string; details?: Record<string, unknown> } }
> {
  if (credentials.kind === 'token') return { ok: true, token: credentials.token }
  if (!oidc) {
    return {
      ok: false,
      failure: { code: 'OIDC_CONTEXT_MISSING', message: 'npm OIDC publishing needs an OIDC context' },
    }
  }
  const idToken = await oidc.idTokenFetcher(credentials.audience ?? audienceForNpmRegistry(registry))
  if (!idToken.ok) {
    return { ok: false, failure: { code: 'OIDC_TOKEN_FETCH_FAILED', message: idToken.reason } }
  }
  const response = await fetch(npmOidcExchangeUrl(registry, packageName), {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken.token}` },
  })
  if (!response.ok) {
    return {
      ok: false,
      failure: {
        code: 'OIDC_EXCHANGE_FAILED',
        message: `npm OIDC exchange failed with ${response.status}`,
        details: { status: response.status, body: await response.text() },
      },
    }
  }
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    return {
      ok: false,
      failure: { code: 'OIDC_EXCHANGE_FAILED', message: 'npm OIDC exchange response did not include a token' },
    }
  }
  return { ok: true, token: body.token }
}

export async function publishGithubReleaseAssets(input: {
  manifest: CliReleaseManifest
  manifestPath: string
  repository: string
  tag: string
  dryRun: boolean
}): Promise<GithubUploadResult> {
  const root = dirname(input.manifestPath)
  const assets = [
    ...input.manifest.binaries.map((binary) => join(root, 'binaries', binary.filename)),
    input.manifestPath,
  ]
  if (input.dryRun) return { ok: true, dryRun: true, assets }

  const result = await commandStatus(
    ['gh', 'release', 'upload', input.tag, ...assets, '--clobber', '--repo', input.repository],
    { env: { GITHUB_TOKEN: Bun.env['GITHUB_TOKEN'] } },
  )
  if (result.code === 0) return { ok: true, dryRun: false, assets }
  return {
    ok: false,
    code: 'GITHUB_RELEASE_UPLOAD_FAILED',
    message: `gh release upload exited with ${result.code}`,
    details: { stderr: result.stderr.trim() },
  }
}
