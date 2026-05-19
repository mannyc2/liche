import type { Contract } from './schema.js'

export type LintIssue = {
  code: string
  path: string
  message: string
  recommendation?: string
}

const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/

export function lintContract(contract: Contract): LintIssue[] {
  const issues: LintIssue[] = []
  lintContractRemote(contract, issues)
  contract.operations.forEach((op, index) => lintOperation(op, index, contract, issues))
  return issues
}

function lintContractRemote(contract: Contract, issues: LintIssue[]): void {
  if (!contract.remote) return
  const baseUrl = contract.remote.baseUrl as { envVar?: string; literal?: string }
  if (!hasText(baseUrl.envVar) && !hasText(baseUrl.literal)) {
    issues.push({
      code: 'contract/remote-base-url',
      path: 'remote.baseUrl',
      message: `Contract '${contract.name}' remote.baseUrl must declare envVar or literal`,
      recommendation: `set remote.baseUrl.envVar to the environment variable that provides the API base URL, or set remote.baseUrl.literal for a fixed base URL`,
    })
  }
}

function lintOperation(
  op: Contract['operations'][number],
  index: number,
  contract: Contract,
  issues: LintIssue[],
): void {
  const base = `operations[${index}]`
  const vocab = contract.vocabulary

  // operation/id-stable
  if (!ID_PATTERN.test(op.id)) {
    issues.push({
      code: 'operation/id-stable',
      path: `${base}.id`,
      message: `Operation id '${op.id}' does not match the stable id pattern (lowerCamel dot-segments)`,
    })
  }

  const verb = op.command.at(-1)
  if (!verb) {
    issues.push({
      code: 'operation/command-required',
      path: `${base}.command`,
      message: `Operation '${op.id}' must declare at least one command segment`,
    })
  } else if (!vocab.verbs.includes(verb)) {
    issues.push({
      code: 'vocabulary/verb',
      path: `${base}.command`,
      message: `Command action '${verb}' is not in the contract vocabulary`,
      recommendation: `add '${verb}' to vocabulary({ verbs: [...] }) or use one of: ${vocab.verbs.join(', ')}`,
    })
  }

  // operation/output-required — output is required by the TS type, but catch
  // explicitly-empty outputs (void/never/undefined) that produce no useful surface.
  const outputDef = (op.output as { _def?: { type?: string } })?._def
  const outputType = outputDef?.type
  if (outputType === 'void' || outputType === 'never' || outputType === 'undefined') {
    issues.push({
      code: 'operation/output-required',
      path: `${base}.output`,
      message: `Operation '${op.id}' must declare a non-empty output schema (got z.${outputType}())`,
    })
  }

  // operation/locality-required
  if (op.locality.modes.length === 0) {
    issues.push({
      code: 'operation/locality-required',
      path: `${base}.locality.modes`,
      message: `Operation '${op.id}' must declare at least one locality mode`,
    })
  } else if (!op.locality.modes.includes(op.locality.default)) {
    issues.push({
      code: 'operation/locality-required',
      path: `${base}.locality.default`,
      message: `Operation '${op.id}' locality.default '${op.locality.default}' is not in modes [${op.locality.modes.join(', ')}]`,
    })
  }

  if (op.locality.modes.includes('local') && !op.local) {
    issues.push({
      code: 'operation/locality-binding',
      path: `${base}.local`,
      message: `Operation '${op.id}' declares local locality but has no local binding`,
      recommendation: `add local: { module, export } or remove 'local' from locality.modes`,
    })
  }
  if (op.locality.modes.includes('remote') && !op.remote) {
    issues.push({
      code: 'operation/locality-binding',
      path: `${base}.remote`,
      message: `Operation '${op.id}' declares remote locality but has no remote binding`,
      recommendation: `add remote: { method, path, bind } or remove 'remote' from locality.modes`,
    })
  }
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
