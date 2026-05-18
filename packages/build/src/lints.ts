import type { RuntimeNormalizedProgram } from './schema.js'

export type LintIssue = {
  code: string
  path: string
  message: string
  recommendation?: string
}

const FORBIDDEN_RECOMMENDATIONS: Record<string, string> = {
  info: 'get',
  format: 'json',
  'skip-confirmations': 'force',
  skipConfirmations: 'force',
}

const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/

export function lintProgram(runtime: RuntimeNormalizedProgram): LintIssue[] {
  const issues: LintIssue[] = []
  lintVocabulary(runtime, issues)
  runtime.operations.forEach((op, index) => lintOperation(op, index, runtime, issues))
  return issues
}

function lintVocabulary(runtime: RuntimeNormalizedProgram, issues: LintIssue[]): void {
  const vocab = runtime.vocabulary

  for (const flag of vocab.flags) {
    if (vocab.forbiddenFlags.includes(flag)) {
      issues.push(buildIssue('vocabulary/forbidden', `vocabulary.flags['${flag}']`, `Control flag '${flag}' is in the forbidden list`, flag))
    }
  }

  for (const verb of vocab.verbs) {
    if (vocab.forbiddenVerbs.includes(verb)) {
      issues.push(buildIssue('vocabulary/forbidden', `vocabulary.verbs['${verb}']`, `Verb '${verb}' is in the forbidden list`, verb))
    }
  }

  // override/guarded: if a program adds a name that exactly matches a default-forbidden item
  // without an explicit guard, fail. Phase 3 has no guard syntax; presence of the name in the
  // active list is the violation.
  for (const flag of vocab.flags) {
    const defaultForbidden = ['format', 'skip-confirmations', 'skipConfirmations']
    if (defaultForbidden.includes(flag) && !vocab.forbiddenFlags.includes(flag)) {
      issues.push(buildIssue('override/guarded', `vocabulary.flags['${flag}']`, `Flag '${flag}' overrides a default-forbidden control flag without an explicit guard`, flag))
    }
  }
}

function lintOperation(
  op: RuntimeNormalizedProgram['operations'][number],
  index: number,
  runtime: RuntimeNormalizedProgram,
  issues: LintIssue[],
): void {
  const base = `operations[${index}]`
  const vocab = runtime.vocabulary

  // operation/id-stable
  if (!ID_PATTERN.test(op.id)) {
    issues.push({
      code: 'operation/id-stable',
      path: `${base}.id`,
      message: `Operation id '${op.id}' does not match the stable id pattern (lowerCamel dot-segments)`,
    })
  }

  // vocabulary/verb
  if (vocab.forbiddenVerbs.includes(op.verb)) {
    issues.push(buildIssue('vocabulary/verb', `${base}.verb`, `Verb '${op.verb}' is forbidden`, op.verb))
  } else if (!vocab.verbs.includes(op.verb)) {
    issues.push({
      code: 'vocabulary/verb',
      path: `${base}.verb`,
      message: `Verb '${op.verb}' is not in the program vocabulary`,
      recommendation: `add '${op.verb}' to vocabulary({ verbs: [...] }) or use one of: ${vocab.verbs.join(', ')}`,
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
}

function buildIssue(code: string, path: string, message: string, name: string): LintIssue {
  const replacement = FORBIDDEN_RECOMMENDATIONS[name]
  if (replacement) {
    return { code, path, message, recommendation: `use '${replacement}' instead of '${name}'` }
  }
  return { code, path, message }
}
