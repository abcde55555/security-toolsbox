import type {
  BaseModule,
  CancelToken,
  CommandProgress,
  ExecutionResult,
  ModuleExecuteContext,
} from '@en18031/shared';
import { nowIso, uuid, sanitizeAndEnforceResult } from '@en18031/shared';
import { logger } from '../logger.js';
import {
  CommandExecutor,
  type RunCommandOptions,
} from './commandExecutor.js';
import type { ModuleLoader } from './moduleLoader.js';

export interface RunContext {
  projectId: string;
  stepId: string;
  userId: string;
  variables: Record<string, unknown>;
  onProgress: (p: CommandProgress) => void;
  cancelToken: CancelToken;
  timeoutMs?: number;
}

export class ExecutionEngine {
  readonly commandExecutor: CommandExecutor;

  constructor(private moduleLoader: ModuleLoader) {
    this.commandExecutor = new CommandExecutor();
  }

  async runCommand(
    command: string,
    opts: RunCommandOptions & { runId?: string; projectId?: string; stepId?: string; toolId?: string } = {},
  ): Promise<ExecutionResult> {
    const start = Date.now();
    const startedAt = nowIso();
    const runId = opts.runId ?? uuid();
    const result = await this.commandExecutor.runCommand(command, opts);
    const finishedAt = nowIso();
    return {
      runId,
      projectId: opts.projectId,
      stepId: opts.stepId,
      toolId: opts.toolId,
      status: result.status,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs || Date.now() - start,
      startedAt,
      finishedAt,
      evidence: [
        {
          type: 'stdout_line',
          content: result.stdout.slice(-8000) || '(无输出)',
          severity: 'low',
        },
      ],
      verdicts: [],
    };
  }

  async runModule(
    moduleId: string,
    params: Record<string, unknown>,
    ctx: RunContext,
  ): Promise<ExecutionResult> {
    const runId = uuid();
    const startedAt = nowIso();
    const start = Date.now();
    const module: BaseModule | undefined = this.moduleLoader.get(moduleId);
    if (!module) {
      return {
        runId,
        projectId: ctx.projectId,
        stepId: ctx.stepId,
        moduleId,
        status: 'crash',
        exitCode: 1,
        stdout: '',
        stderr: `Module not found: ${moduleId}`,
        durationMs: 0,
        startedAt,
        finishedAt: nowIso(),
        evidence: [
          {
            type: 'validation_error',
            content: `未找到模组: ${moduleId}`,
            severity: 'high',
          },
        ],
        verdicts: [],
        error: { code: 'MODULE_NOT_FOUND', message: `Module ${moduleId} not loaded` },
      };
    }

    const executeContext: ModuleExecuteContext = {
      projectId: ctx.projectId,
      stepId: ctx.stepId,
      userId: ctx.userId,
      variables: ctx.variables,
      onProgress: ctx.onProgress,
      cancelToken: ctx.cancelToken,
      engine: {
        runCommand: (command, opts = {}) =>
          this.runCommand(command, {
            ...opts,
            runId: uuid(),
            projectId: ctx.projectId,
            stepId: ctx.stepId,
            toolId: moduleId,
            cancelToken: ctx.cancelToken,
            onProgress: (p) => {
              opts.onProgress?.(p);
            },
          }).then((r) => ({
            status: r.status,
            exitCode: r.exitCode,
            stdout: r.stdout,
            stderr: r.stderr,
            durationMs: r.durationMs,
          })),
      },
    };

    let rawResult: unknown;
    try {
      rawResult = await module.execute(params, executeContext);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error({ err, moduleId }, 'module.execute threw uncaught exception');
      rawResult = {
        status: 'crash',
        exitCode: 1,
        stdout: '',
        stderr: err.stack || err.message,
        error: { code: 'UNCAUGHT_EXCEPTION', message: err.message, stack: err.stack },
        evidence: [
          {
            type: 'validation_error',
            content: `模组未捕获异常: ${err.message}`,
            severity: 'high',
          },
        ],
        verdicts: module.config.clauses.map((c) => ({
          clauseId: c.clauseId,
          pass: false,
          severity: 'high' as const,
          reason: `模组崩溃: ${err.message}`,
          evidenceRefs: [0],
        })),
      };
    }

    const { result, warnings } = sanitizeAndEnforceResult(rawResult, runId);
    for (const w of warnings) {
      logger.warn({ moduleId, runId, warning: w }, 'SDK contract warning');
    }
    result.runId = runId;
    result.projectId = ctx.projectId;
    result.stepId = ctx.stepId;
    result.moduleId = moduleId;
    result.toolId = moduleId;
    result.startedAt = (rawResult as ExecutionResult)?.startedAt || startedAt;
    result.finishedAt = (rawResult as ExecutionResult)?.finishedAt || nowIso();
    result.durationMs =
      (rawResult as ExecutionResult)?.durationMs || Date.now() - start;

    return result;
  }
}
