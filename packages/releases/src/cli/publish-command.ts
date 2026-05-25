import { resolve } from 'node:path'
import type { ReleasesConfig } from '../config.js'
import {
  artifactsFromManifest,
  githubReleaseTarget,
  parsePublishSelection,
  publisherConfigFromReleasesConfig,
} from '../config.js'
import { parseCliReleaseManifest } from '../manifest/index.js'
import { createCliPublisherExecutors, publishGithubReleaseAssets } from '../publishers/default-executors.js'
import {
  executeReleasePublish,
  planReleasePublish,
  preflightReleasePublish,
} from '../publishers/index.js'
import type { EnvRecord } from '../publishers/index.js'
import {
  formatExecuteFailure,
  formatPlanFailures,
  formatPreflightFailures,
} from './format-failures.js'
import { publisherCredentials } from './oidc-env.js'
import { envRecord, readJsonFile, releaseConfig } from './types.js'
import type { CommandResult, ReleaseCommandContext } from './types.js'

export type PublishCommandOutput = {
  dryRun: boolean
  manifest: string
  [key: string]: unknown
}

export async function publishFromManifest(input: {
  config: ReleasesConfig
  cwd: string
  dryRun: boolean
  ecosystems: string
  env: EnvRecord
  manifest: string
}): Promise<CommandResult<PublishCommandOutput>> {
  const manifestPath = resolve(input.cwd, input.manifest)
  const rawManifest = await readJsonFile(manifestPath)
  if (!rawManifest.ok) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_READ_FAILED',
        message: `could not read release manifest at '${manifestPath}'`,
        hint: rawManifest.message,
      },
    }
  }

  const manifestResult = parseCliReleaseManifest(rawManifest.value)
  if (!manifestResult.ok) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_INVALID',
        message: `release manifest at '${manifestPath}' did not validate`,
        hint: manifestResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      },
    }
  }

  let selection: ReturnType<typeof parsePublishSelection>
  try {
    selection = parsePublishSelection(input.ecosystems)
  } catch (error) {
    return {
      ok: false,
      error: { code: 'CONFIG_INVALID', message: error instanceof Error ? error.message : String(error) },
    }
  }

  const completed: Record<string, unknown> = {}

  if (selection.github) {
    const target = githubReleaseTarget(input.config, manifestResult.manifest)
    if (!target) {
      return {
        ok: false,
        error: {
          code: 'GITHUB_RELEASE_CONFIG_MISSING',
          message: 'github publishing requires a github-assets host or publishers.github.repository',
        },
      }
    }
    const uploaded = await publishGithubReleaseAssets({
      manifest: manifestResult.manifest,
      manifestPath,
      repository: target.repository,
      tag: target.tag,
      dryRun: input.dryRun,
    })
    if (!uploaded.ok) {
      return {
        ok: false,
        error: { code: uploaded.code, message: uploaded.message, hint: JSON.stringify(uploaded.details ?? {}) },
      }
    }
    completed.github = uploaded
  }

  const shouldPlanPackages =
    selection.packageSelection === 'all' ||
    (Array.isArray(selection.packageSelection) && selection.packageSelection.length > 0)

  if (shouldPlanPackages) {
    const publisherConfig = publisherConfigFromReleasesConfig(input.config)
    const planResult = planReleasePublish({
      manifest: manifestResult.manifest,
      packages: manifestResult.manifest.packages,
      artifacts: artifactsFromManifest(manifestResult.manifest, manifestPath),
      selection: selection.packageSelection,
      ...(publisherConfig ? { config: publisherConfig } : {}),
    })
    if (!planResult.ok) {
      return {
        ok: false,
        error: {
          code: 'PUBLISH_PLAN_FAILED',
          message: 'release publish plan failed',
          hint: formatPlanFailures(planResult.failures),
        },
      }
    }

    const { credentials, oidc } = publisherCredentials(input.env)
    const preflight = preflightReleasePublish({ plan: planResult.plan, credentials })
    if (!preflight.ok) {
      return {
        ok: false,
        error: {
          code: 'PUBLISH_PREFLIGHT_FAILED',
          message: 'release publish preflight failed',
          hint: formatPreflightFailures(preflight.failures),
        },
      }
    }

    if (input.dryRun) {
      completed.packagePublish = { cleared: preflight.cleared, plan: planResult.plan }
    } else {
      const executed = await executeReleasePublish({
        plan: planResult.plan,
        credentials,
        executors: createCliPublisherExecutors(),
        ...(oidc ? { oidc } : {}),
      })
      if (!executed.ok) {
        return {
          ok: false,
          error: {
            code: executed.failure.code === 'EXECUTOR_MISSING'
              ? 'PUBLISH_EXECUTOR_MISSING'
              : 'PUBLISH_EXECUTION_FAILED',
            message: 'release publish execution failed',
            hint: formatExecuteFailure(executed.failure),
          },
        }
      }
      completed.packagePublish = { completed: executed.completed }
    }
  }

  return {
    ok: true,
    value: { dryRun: input.dryRun, manifest: manifestPath, ...completed },
  }
}

export async function runPublishCommand(
  ctx: ReleaseCommandContext<{ manifest: string }, { dryRun: boolean; ecosystems: string }>,
): Promise<unknown> {
  const result = await publishFromManifest({
    config: releaseConfig(ctx),
    cwd: process.cwd(),
    dryRun: ctx.options.dryRun,
    ecosystems: ctx.options.ecosystems,
    env: envRecord(ctx.env),
    manifest: ctx.args.manifest,
  })
  if (!result.ok) return ctx.error(result.error)
  return result.value
}
