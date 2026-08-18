import type {
  ExecutionResult,
  StepVerdictRule,
  FinalCondition,
  FinalVerdictRule,
  ClauseAggregation,
  Severity,
} from '@en18031/shared';

/**
 * Evaluate a single step's result against its verdictRule to produce a
 * pass/fail signal. Returns null when the rule does not apply / cannot decide
 * (e.g. a module whose mapped verdict is absent).
 */
export function evaluateStepVerdict(
  rule: StepVerdictRule | undefined | null,
  result: ExecutionResult,
): { pass: boolean; severity?: Severity; reason: string } | null {
  if (!rule) return null;

  if (rule.kind === 'module') {
    // Module tools return verdicts directly in result.verdicts. Pick the one
    // matching mapClauseId (or the first verdict when not specified).
    const target = rule.mapClauseId;
    const match = target
      ? result.verdicts?.find((v) => v.clauseId === target)
      : result.verdicts?.[0];
    if (!match) return null;
    return {
      pass: match.pass,
      severity: match.severity,
      reason: match.reason,
    };
  }

  // command kind: evaluate exit code / output.
  const output = `${result.stdout}\n${result.stderr}`;
  const fail =
    (rule.failOnExitCode !== undefined && result.exitCode === rule.failOnExitCode) ||
    (rule.failOnOutputContains && output.includes(rule.failOnOutputContains)) ||
    (rule.failOnOutputRegex && safeRegexTest(rule.failOnOutputRegex, output));
  if (fail) {
    return {
      pass: false,
      severity: rule.severity,
      reason: rule.failOnOutputContains
        ? `输出包含「${rule.failOnOutputContains}」`
        : rule.failOnOutputRegex
          ? `输出匹配失败正则 /${rule.failOnOutputRegex}/`
          : `退出码 ${result.exitCode}`,
    };
  }

  const pass =
    (rule.passOnExitCode !== undefined && result.exitCode === rule.passOnExitCode) ||
    (rule.passOnOutputContains && output.includes(rule.passOnOutputContains)) ||
    (rule.passOnOutputRegex && safeRegexTest(rule.passOnOutputRegex, output));
  if (pass) {
    return {
      pass: true,
      severity: rule.severity,
      reason: rule.passOnOutputContains
        ? `输出包含「${rule.passOnOutputContains}」`
        : rule.passOnOutputRegex
          ? `输出匹配通过正则 /${rule.passOnOutputRegex}/`
          : `退出码 ${result.exitCode}`,
    };
  }

  return null;
}

function safeRegexTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'm').test(text);
  } catch {
    return false;
  }
}

/**
 * Evaluate a chain's final verdict rule against per-step results.
 * Returns the pass/fail decision with a reason; null means "not enough info".
 */
export function evaluateChainFinal(
  rule: FinalVerdictRule,
  results: Map<string, ExecutionResult>,
  skipped: Set<string>,
): { pass: boolean; severity?: Severity; reason: string } | null {
  const evalCond = (c: FinalCondition): boolean | null => {
    const r = results.get(c.step);
    if (!r) return null;
    if (c.type === 'exit_code') {
      const eq = r.exitCode === c.value;
      return c.op === 'eq' ? eq : !eq;
    }
    const output = `${r.stdout}\n${r.stderr}`;
    let matched: boolean;
    if (c.type === 'output_contains') matched = output.includes(c.value);
    else matched = safeRegexTest(c.value, output);
    return c.negate ? !matched : matched;
  };

  // failAny wins if any condition is definitively true.
  for (const c of rule.failAny ?? []) {
    if (evalCond(c) === true) {
      return { pass: false, severity: rule.severity, reason: rule.reason ?? describeCond(c, false) };
    }
  }
  // passAll requires every condition to hold.
  const passAll = rule.passAll ?? [];
  if (passAll.length > 0) {
    const values = passAll.map(evalCond);
    if (values.every((v) => v === true)) {
      return { pass: true, severity: rule.severity, reason: rule.reason ?? '所有链式条件满足' };
    }
    if (values.some((v) => v === false)) {
      return { pass: false, severity: rule.severity, reason: rule.reason ?? '链式条件未满足' };
    }
  }
  return null;
}

function describeCond(c: FinalCondition, pass: boolean): string {
  if (c.type === 'exit_code') return `步骤 ${c.step} 退出码${c.op === 'eq' ? '=' : '≠'}${c.value}`;
  if (c.type === 'output_contains')
    return `${c.negate ? '不包含' : '包含'}「${c.value}」`;
  return `${c.negate ? '不匹配' : '匹配'} /${c.value}/`;
}

/**
 * Aggregate per-step pass/fail signals into a clause verdict according to the
 * aggregation mode. `signals` only includes steps that produced a decision.
 * `skipped` lists stepIds that were skipped (upstream failure / unavailable).
 */
export function aggregateClause(
  agg: ClauseAggregation,
  signals: Array<{ pass: boolean; severity?: Severity; reason: string }>,
  skipped: string[],
): { pass: boolean; severity?: Severity; reason: string } {
  if (agg.mode === 'chain') {
    // Chain: if anything was skipped due to upstream failure, clause fails.
    if (skipped.length > 0) {
      return {
        pass: false,
        severity: agg.finalVerdict.severity,
        reason: `上游步骤失败，已跳过: ${skipped.join(', ')}`,
      };
    }
    const final = evaluateChainFinal(agg.finalVerdict, new Map(), new Set());
    if (final) return final;
    // Fallback: any fail -> fail, all pass -> pass.
    if (signals.some((s) => !s.pass)) {
      const f = signals.find((s) => !s.pass)!;
      return { pass: false, severity: f.severity, reason: f.reason };
    }
    if (signals.length > 0 && signals.every((s) => s.pass)) {
      return { pass: true, severity: agg.finalVerdict.severity, reason: '链式步骤全部通过' };
    }
    return { pass: false, severity: agg.finalVerdict.severity, reason: '无法判定（条件未覆盖）' };
  }

  // cross_check
  const passes = signals.filter((s) => s.pass);
  const fails = signals.filter((s) => !s.pass);
  const worst = [...fails].sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0];

  switch (agg.strategy) {
    case 'any_pass':
      if (passes.length > 0) return { pass: true, reason: '任一检查通过' };
      if (fails.length > 0)
        return { pass: false, severity: worst?.severity ?? agg.severity, reason: '所有检查均未通过' };
      break;
    case 'any_fail':
      if (fails.length > 0)
        return { pass: false, severity: worst?.severity ?? agg.severity, reason: worst?.reason ?? '存在失败项' };
      if (passes.length > 0) return { pass: true, reason: '所有检查通过' };
      break;
    case 'majority': {
      if (signals.length === 0) break;
      const passCount = passes.length;
      const failCount = fails.length;
      if (passCount > failCount) return { pass: true, reason: `多数通过 (${passCount}/${signals.length})` };
      if (failCount > passCount)
        return { pass: false, severity: worst?.severity ?? agg.severity, reason: `多数失败 (${failCount}/${signals.length})` };
      // tie -> fail (conservative)
      return { pass: false, severity: agg.severity, reason: '平票，按失败处理' };
    }
    case 'all_pass':
    default:
      if (fails.length > 0)
        return { pass: false, severity: worst?.severity ?? agg.severity, reason: worst?.reason ?? '存在失败项' };
      if (passes.length > 0 && passes.length === signals.length)
        return { pass: true, reason: `全部通过 (${passes.length})` };
      break;
  }
  return { pass: false, severity: agg.severity, reason: '没有足够的检查结果' };
}

function sevRank(s?: Severity): number {
  if (s === 'high') return 3;
  if (s === 'middle') return 2;
  if (s === 'low') return 1;
  return 0;
}
