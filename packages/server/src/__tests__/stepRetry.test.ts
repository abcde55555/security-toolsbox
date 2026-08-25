import { describe, it, expect } from 'vitest';
import { executeWithRetry, clampAttempts } from '../services/stepRetry.js';
import type { ExecutionResult } from '@en18031/shared';

function mkResult(status: ExecutionResult['status'], exitCode = 0): ExecutionResult {
  return {
    runId: 'r1', projectId: 'p1', stepId: 's1', toolId: 't',
    status, exitCode, stdout: '', stderr: '', durationMs: 0,
    startedAt: '', finishedAt: '', evidence: [], verdicts: [],
  };
}

describe('executeWithRetry —— TemplateStep.retry 自动重试语义', () => {
  it('fail 后自动重试并在成功时收敛', async () => {
    const calls: number[] = [];
    const sleeps: number[] = [];
    const { result, attempts, attemptNotes } = await executeWithRetry(
      async (n) => {
        calls.push(n);
        return n < 3 ? mkResult('fail', 1) : mkResult('success');
      },
      { maxAttempts: 3, backoffMs: 100, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(result.status).toBe('success');
    expect(attempts).toBe(3);
    expect(calls).toEqual([1, 2, 3]);
    // 线性退避：100×1, 100×2
    expect(sleeps).toEqual([100, 200]);
    expect(attemptNotes).toHaveLength(2);
    expect(attemptNotes[0]).toContain('第 1 次');
  });

  it('cancelled 是用户意图，绝不重试', async () => {
    let calls = 0;
    const { attempts } = await executeWithRetry(
      async () => { calls++; return mkResult('cancelled'); },
      { maxAttempts: 4, sleep: async () => {} },
    );
    expect(calls).toBe(1);
    expect(attempts).toBe(1);
  });

  it('达到上限后停止并返回最后一次结果', async () => {
    let calls = 0;
    const { result, attempts, attemptNotes } = await executeWithRetry(
      async () => { calls++; return mkResult('timeout'); },
      { maxAttempts: 3, sleep: async () => {} },
    );
    expect(calls).toBe(3);
    expect(attempts).toBe(3);
    expect(result.status).toBe('timeout');
    expect(attemptNotes).toHaveLength(2);
  });

  it('clampAttempts 钳制到 [1,5] 且缺省为 1', () => {
    expect(clampAttempts(undefined)).toBe(1);
    expect(clampAttempts(0)).toBe(1);
    expect(clampAttempts(-3)).toBe(1);
    expect(clampAttempts(99)).toBe(5);
    expect(clampAttempts(3)).toBe(3);
  });
});
