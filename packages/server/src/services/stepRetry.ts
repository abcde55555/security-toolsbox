/**
 * 步骤自动重试助手 —— 让 TemplateStep.retry / retryBackoffMs 真正生效。
 *
 * 语义：
 * - retry=N 表示最多尝试 N 次（N=1 即不重试）；上限钳制到 5 防止配置失误拖垮运行
 * - 仅 fail/timeout 触发重试；cancelled 是用户意图，绝不重试
 * - 退避 = backoffMs × 已试次数（线性），可通过注入 sleep 测试
 */
import type { ExecutionResult } from '@en18031/shared';

export const MAX_AUTO_RETRY_ATTEMPTS = 5;
export const DEFAULT_RETRY_BACKOFF_MS = 1000;

const RETRIABLE: ReadonlySet<string> = new Set(['fail', 'timeout']);

export interface RetryOutcome<T> {
  result: T;
  attempts: number;
  /** 每次重试前记录的失败说明（用于写入证据链） */
  attemptNotes: string[];
}

export function clampAttempts(retry?: number): number {
  return Math.max(1, Math.min(MAX_AUTO_RETRY_ATTEMPTS, Math.floor(retry ?? 1)));
}

export async function executeWithRetry<T extends Pick<ExecutionResult, 'status' | 'exitCode'>>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxAttempts: number; backoffMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<RetryOutcome<T>> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoffMs = Math.max(0, opts.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS);
  const attemptNotes: string[] = [];
  let attempts = 0;
  for (;;) {
    attempts++;
    const result = await fn(attempts);
    if (!RETRIABLE.has(result.status) || attempts >= opts.maxAttempts) {
      return { result, attempts, attemptNotes };
    }
    attemptNotes.push(
      `第 ${attempts} 次尝试失败（${result.status}${result.exitCode !== undefined ? `，退出码 ${result.exitCode}` : ''}）`,
    );
    if (backoffMs > 0) await sleep(backoffMs * attempts);
  }
}
