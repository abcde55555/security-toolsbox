import { nowIso } from '@en18031/shared';

export interface HumanStepCompletion {
  note?: string;
  fileRefs: string[];
  completedAt: string;
  completedBy: string;
}

export interface PendingHumanStep {
  stepRunId: string;
  resolve: (completion: HumanStepCompletion) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Tracks in-flight human-instruction steps. The planner loop awaits
 * `wait()`; the REST complete-human-step handler calls `complete()` to
 * resolve the pending Promise. A timeout auto-archives the step so the
 * session does not hang forever.
 */
export class HumanStepCoordinator {
  private pending = new Map<string, PendingHumanStep>();

  wait(
    stepRunId: string,
    opts: { timeoutMs: number; onTimeout?: () => void },
  ): Promise<HumanStepCompletion> {
    return new Promise<HumanStepCompletion>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(stepRunId)) {
          this.pending.delete(stepRunId);
          opts.onTimeout?.();
          reject(new Error('人工步骤超时，已归档'));
        }
      }, opts.timeoutMs);
      // Do not keep the event loop alive solely for this timer.
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(stepRunId, { stepRunId, resolve, reject, timer });
    });
  }

  complete(stepRunId: string, completion: Omit<HumanStepCompletion, 'completedAt'>): boolean {
    const entry = this.pending.get(stepRunId);
    if (!entry) return false;
    this.pending.delete(stepRunId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve({ ...completion, completedAt: nowIso() });
    return true;
  }

  abortAll(reason = '会话已中止'): void {
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  isPending(stepRunId: string): boolean {
    return this.pending.has(stepRunId);
  }

  get size(): number {
    return this.pending.size;
  }
}
