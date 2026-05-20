import { createHash } from 'node:crypto'
import type { PackageEcosystem } from '../manifest.js'
import type {
  HomebrewPublishStep,
  NpmPublishStep,
  PublishStep,
  PypiPublishStep,
  ReleasePublishPlan,
  ScoopPublishStep,
} from './plan.js'
import type {
  HomebrewCredentials,
  NpmCredentials,
  PublisherCredentials,
  PypiCredentials,
  ScoopCredentials,
} from './preflight.js'
import type { OidcExchangeEnv } from './oidc.js'

export type ExecutorFailure = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type StepExecutorResult =
  | { ok: true; metadata?: Record<string, unknown> }
  | { ok: false; failure: ExecutorFailure }

export type StepExecutorInput<Step, Creds> = {
  step: Step
  credentials: Creds
  bytes: Uint8Array
  oidc?: OidcExchangeEnv
}

export type NpmStepExecutor = (
  input: StepExecutorInput<NpmPublishStep, NpmCredentials>,
) => Promise<StepExecutorResult> | StepExecutorResult

export type PypiStepExecutor = (
  input: StepExecutorInput<PypiPublishStep, PypiCredentials>,
) => Promise<StepExecutorResult> | StepExecutorResult

export type HomebrewStepExecutor = (
  input: StepExecutorInput<HomebrewPublishStep, HomebrewCredentials>,
) => Promise<StepExecutorResult> | StepExecutorResult

export type ScoopStepExecutor = (
  input: StepExecutorInput<ScoopPublishStep, ScoopCredentials>,
) => Promise<StepExecutorResult> | StepExecutorResult

export type PublisherExecutorRegistry = {
  npm?: NpmStepExecutor
  pypi?: PypiStepExecutor
  homebrew?: HomebrewStepExecutor
  scoop?: ScoopStepExecutor
}

export type ExecutorReceipt = {
  step: PublishStep
  metadata?: Record<string, unknown>
}

export type ExecuteFailureCode =
  | 'ARTIFACT_READ_FAILED'
  | 'ARTIFACT_TAMPERED'
  | 'CREDENTIAL_MISSING'
  | 'OIDC_CONTEXT_MISSING'
  | 'EXECUTOR_MISSING'
  | 'EXECUTOR_FAILED'

export type ExecuteFailure = {
  stepIndex: number
  packageId: string
  ecosystem: PackageEcosystem
  code: ExecuteFailureCode
  message: string
  details?: Record<string, unknown>
}

export type ExecuteReleasePublishInput = {
  plan: ReleasePublishPlan
  credentials: PublisherCredentials
  executors: PublisherExecutorRegistry
  oidc?: OidcExchangeEnv
}

export type ExecuteReleasePublishResult =
  | { ok: true; completed: ExecutorReceipt[] }
  | { ok: false; completed: ExecutorReceipt[]; failure: ExecuteFailure }

async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function failure(
  stepIndex: number,
  step: PublishStep,
  code: ExecuteFailureCode,
  message: string,
  details?: Record<string, unknown>,
): ExecuteFailure {
  const result: ExecuteFailure = {
    stepIndex,
    packageId: step.packageId,
    ecosystem: step.ecosystem,
    code,
    message,
  }
  if (details) result.details = details
  return result
}

function tamperedDetails(
  stepIndex: number,
  step: PublishStep,
  actualSha256: string,
  actualSize: number,
): Record<string, unknown> {
  return {
    stepIndex,
    packageId: step.packageId,
    ecosystem: step.ecosystem,
    artifactPath: step.artifactPath,
    expectedSha256: step.sha256,
    actualSha256,
    expectedSize: step.size,
    actualSize,
  }
}

async function dispatchExecutor(
  step: PublishStep,
  credentials: object,
  bytes: Uint8Array,
  oidc: OidcExchangeEnv | undefined,
  executors: PublisherExecutorRegistry,
): Promise<StepExecutorResult> {
  switch (step.kind) {
    case 'npm-publish': {
      const input: StepExecutorInput<NpmPublishStep, NpmCredentials> = {
        step,
        credentials: credentials as NpmCredentials,
        bytes,
      }
      if (oidc) input.oidc = oidc
      return executors.npm!(input)
    }
    case 'pypi-upload': {
      const input: StepExecutorInput<PypiPublishStep, PypiCredentials> = {
        step,
        credentials: credentials as PypiCredentials,
        bytes,
      }
      if (oidc) input.oidc = oidc
      return executors.pypi!(input)
    }
    case 'homebrew-write-formula': {
      const input: StepExecutorInput<HomebrewPublishStep, HomebrewCredentials> = {
        step,
        credentials: credentials as HomebrewCredentials,
        bytes,
      }
      if (oidc) input.oidc = oidc
      return executors.homebrew!(input)
    }
    case 'scoop-write-manifest': {
      const input: StepExecutorInput<ScoopPublishStep, ScoopCredentials> = {
        step,
        credentials: credentials as ScoopCredentials,
        bytes,
      }
      if (oidc) input.oidc = oidc
      return executors.scoop!(input)
    }
  }
}

async function executeStep(
  stepIndex: number,
  step: PublishStep,
  credentials: PublisherCredentials,
  executors: PublisherExecutorRegistry,
  oidc: OidcExchangeEnv | undefined,
): Promise<{ ok: true; receipt: ExecutorReceipt } | { ok: false; failure: ExecuteFailure }> {
  const bytes = await readBytes(step.artifactPath)
  if (!bytes) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'ARTIFACT_READ_FAILED',
        `could not read artifact bytes from '${step.artifactPath}'`,
        { artifactPath: step.artifactPath },
      ),
    }
  }

  const actualSize = bytes.byteLength
  const actualSha256 = sha256Hex(bytes)
  if (actualSize !== step.size || actualSha256 !== step.sha256) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'ARTIFACT_TAMPERED',
        `artifact at '${step.artifactPath}' does not match plan`,
        tamperedDetails(stepIndex, step, actualSha256, actualSize),
      ),
    }
  }

  const creds = credentials[step.ecosystem]
  if (!creds) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'CREDENTIAL_MISSING',
        `publisher '${step.ecosystem}' has steps but no credentials were supplied`,
      ),
    }
  }

  if ((creds as { kind?: unknown }).kind === 'oidc' && !oidc) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'OIDC_CONTEXT_MISSING',
        `publisher '${step.ecosystem}' has an OIDC credential but no OIDC exchange env was supplied`,
      ),
    }
  }

  const executor = executors[step.ecosystem]
  if (!executor) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'EXECUTOR_MISSING',
        `no executor registered for publisher '${step.ecosystem}'`,
      ),
    }
  }

  let result: StepExecutorResult
  try {
    result = await dispatchExecutor(step, creds, bytes, oidc, executors)
  } catch (error) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'EXECUTOR_FAILED',
        `executor for '${step.ecosystem}' threw: ${String(error)}`,
        { error: String(error) },
      ),
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      failure: failure(
        stepIndex,
        step,
        'EXECUTOR_FAILED',
        result.failure.message,
        { executorCode: result.failure.code, ...result.failure.details },
      ),
    }
  }

  const receipt: ExecutorReceipt = { step }
  if (result.metadata !== undefined) receipt.metadata = result.metadata
  return { ok: true, receipt }
}

export async function executeReleasePublish(
  input: ExecuteReleasePublishInput,
): Promise<ExecuteReleasePublishResult> {
  const completed: ExecutorReceipt[] = []
  for (let stepIndex = 0; stepIndex < input.plan.steps.length; stepIndex += 1) {
    const step = input.plan.steps[stepIndex]
    if (!step) continue
    const stepResult = await executeStep(
      stepIndex,
      step,
      input.credentials,
      input.executors,
      input.oidc,
    )
    if (!stepResult.ok) {
      return { ok: false, completed, failure: stepResult.failure }
    }
    completed.push(stepResult.receipt)
  }
  return { ok: true, completed }
}
