import { describe, it, expect } from 'vitest';
import { aggregateClause } from '../services/verdictEvaluator.js';
import type { ClauseAggregation, ExecutionResult } from '@en18031/shared';

function res(stepId: string, exitCode: number, stdout = ''): ExecutionResult {
  return {
    runId: 'r1', projectId: 'p1', stepId, toolId: 't',
    status: exitCode === 0 ? 'success' : 'fail', exitCode,
    stdout, stderr: '', durationMs: 0, startedAt: '', finishedAt: '',
    evidence: [], verdicts: [],
  };
}

const chainAgg: ClauseAggregation = {
  mode: 'chain',
  finalVerdict: {
    severity: 'high',
    failAny: [{ step: 'scan', type: 'output_contains', value: 'VULN' }],
    passAll: [
      { step: 'scan', type: 'exit_code', op: 'eq', value: 0 },
      { step: 'check', type: 'output_contains', value: 'OK' },
    ],
  },
} as unknown as ClauseAggregation;

describe('aggregateClause —— chain 模式 finalVerdict 真正参与求值（v0.4）', () => {
  it('传入 results 时：failAny 命中 → 判失败并给出规则理由', () => {
    const results = new Map([
      ['scan', res('scan', 0, 'found VULN-123')],
      ['check', res('check', 0, 'all OK')],
    ]);
    const v = aggregateClause(chainAgg, [
      { pass: true, reason: 'ok' },
      { pass: true, reason: 'ok' },
    ], [], results);
    expect(v.pass).toBe(false);
    expect(v.severity).toBe('high');
  });

  it('传入 results 时：全部条件满足 → 判通过', () => {
    const results = new Map([
      ['scan', res('scan', 0, 'clean output')],
      ['check', res('check', 0, 'result OK')],
    ]);
    const v = aggregateClause(chainAgg, [
      { pass: true, reason: '' },
      { pass: true, reason: '' },
    ], [], results);
    expect(v.pass).toBe(true);
  });

  it('不传 results（向后兼容）：走信号回退路径，不因条件缺信息而误判', () => {
    const signals = [
      { pass: true, reason: '' },
      { pass: true, reason: '' },
    ];
    const v = aggregateClause(chainAgg, signals, []);
    // 无结果时 evaluateChainFinal 返回 null → 回退"全部通过"
    expect(v.pass).toBe(true);
    expect(v.reason).toContain('链式步骤全部通过');
  });

  it('skipped 存在时仍优先判失败（上游断链语义不变）', () => {
    const v = aggregateClause(chainAgg, [], ['上游步骤X'], new Map());
    expect(v.pass).toBe(false);
    expect(v.reason).toContain('上游步骤失败');
  });
});
