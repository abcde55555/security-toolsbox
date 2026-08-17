import fs from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  CommandRun,
  CommandRunDetail,
  ExecutionError,
  ExecutionResult,
  Tool,
  ToolCommand,
} from '@en18031/shared';
import {
  renderCommandTemplate,
  validateFormValues,
  commandRunStartSchema,
} from '@en18031/shared';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';
import { createCancelToken } from '../engine/cancelToken.js';
import { ClauseMappingService } from './clauseMappingService.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const MAX_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const PREVIEW_TAIL_BYTES = 4096;
const DETAIL_TAIL_BYTES = 200 * 1024;

interface ActiveRun {
  token: ReturnType<typeof createCancelToken>;
  promise: Promise<CommandRun>;
}

function applyDefaults(cmd: ToolCommand, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  for (const f of cmd.params) {
    if (out[f.id] === undefined && f.value !== undefined) {
      out[f.id] = f.value;
    }
  }
  return out;
}

function fillFormValues(cmd: ToolCommand, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of cmd.params) {
    const v = values[f.id];
    if (f.type === 'checkbox') {
      out[f.id] = v === undefined || v === null ? Boolean(f.value) : Boolean(v);
    } else if (f.type === 'number' || f.type === 'stepper') {
      out[f.id] = v === undefined || v === '' || v === null ? f.value : Number(v);
    } else {
      out[f.id] = v === undefined || v === null ? (f.value ?? '') : v;
    }
  }
  return out;
}

export class CommandRunnerService {
  private active = new Map<string, ActiveRun>();
  private runningCount = 0;
  private waitQueue: Array<() => void> = [];
  private clauseMapping: ClauseMappingService;

  constructor(private ctx: ServiceContext) {
    this.clauseMapping = new ClauseMappingService(ctx);
    this.reconcileOrphans();
  }

  private reconcileOrphans(): void {
    const orphans = this.ctx.repos.commandRuns.listRunning();
    for (const o of orphans) {
      this.ctx.repos.commandRuns.markFinished(o.id, {
        status: 'cancelled',
        exitCode: 130,
        durationMs: 0,
        error: { code: 'INTERRUPTED', message: '服务重启，运行被中断' },
      });
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.runningCount < MAX_CONCURRENCY) {
      this.runningCount++;
      return;
    }
    await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    // The slot was handed off directly by releaseSlot; runningCount is unchanged.
  }

  private releaseSlot(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
      return;
    }
    this.runningCount--;
  }

  private toolAndCommand(toolId: string, commandId: string) {
    const tool = this.ctx.repos.tools.getById(toolId);
    if (!tool) throw Errors.notFound('工具', toolId);
    const cmd = (tool.commands ?? []).find((c) => c.id === commandId);
    if (!cmd) throw Errors.notFound('命令', commandId);
    return { tool, cmd };
  }

  start(
    toolId: string,
    commandId: string,
    rawBody: unknown = {},
  ): { runId: string; run: CommandRun } {
    const parsed = commandRunStartSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw Errors.validation(msg || '参数校验失败', parsed.error.issues);
    }
    const body = parsed.data;
    const { tool, cmd } = this.toolAndCommand(toolId, commandId);

    if (cmd.platforms && cmd.platforms.length > 0 && !cmd.platforms.includes(process.platform as 'linux' | 'darwin' | 'win32')) {
      const labels: Record<string, string> = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
      const supported = cmd.platforms.map((p) => labels[p] ?? p).join('/');
      const current = labels[process.platform] ?? process.platform;
      throw Errors.validation(`该命令仅支持 ${supported}，当前系统为 ${current}`);
    }

    const withDefaults = applyDefaults(cmd, body.params ?? {});
    const formErrors = validateFormValues(cmd.params, withDefaults);
    if (Object.keys(formErrors).length > 0) {
      throw Errors.validation('表单参数不合法', formErrors);
    }
    const values = fillFormValues(cmd, withDefaults);
    const rawKeys = new Set(cmd.rawParams ?? []);
    if (rawKeys.size > 0) {
      const forbidden = /[;|&$`<>\n\r{}()\\!#]/;
      for (const key of rawKeys) {
        const v = values[key];
        if (typeof v === 'string' && forbidden.test(v)) {
          throw Errors.validation(`原始参数 "${key}" 包含不允许的 shell 控制字符`);
        }
      }
    }
    const rendered = renderCommandTemplate(cmd.commandTemplate, values, {
      rawKeys: cmd.rawParams,
    });
    if (rendered.missing.length > 0) {
      throw Errors.validation(`未解析的占位符: ${rendered.missing.join(', ')}`);
    }

    const run = this.ctx.repos.commandRuns.create({
      toolId: tool.id,
      toolName: tool.name,
      commandId: cmd.id,
      commandName: cmd.name,
      projectId: body.projectId,
      clauseId: body.clauseId,
      note: body.note,
      params: values,
      resolvedCommand: rendered.command,
      createdBy: this.ctx.userId,
    });

    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'command_run.start',
      entityType: 'command_run',
      entityId: run.id,
      after: { toolId, commandId, resolvedCommand: rendered.command, projectId: body.projectId },
    });

    const token = createCancelToken();
    const promise = this.execute(run.id, tool, cmd, body.timeoutMs, token);
    this.active.set(run.id, { token, promise });
    promise.catch((err) => {
      logger.error({ err, runId: run.id }, 'command run promise rejected');
    });

    return { runId: run.id, run };
  }

  private async execute(
    runId: string,
    tool: Tool,
    cmd: ToolCommand,
    overrideTimeoutMs: number | undefined,
    token: ReturnType<typeof createCancelToken>,
  ): Promise<CommandRun> {
    const runDir = path.join(config.filesDir, 'cmdruns');
    const stdoutPath = path.join(runDir, `${runId}.stdout.log`);
    const stderrPath = path.join(runDir, `${runId}.stderr.log`);
    let stdoutStream: fs.WriteStream | undefined;
    let stderrStream: fs.WriteStream | undefined;
    let start = Date.now();
    let slotAcquired = false;

    const onStreamError = (label: string) => (err: Error) => {
      logger.warn({ err, runId, label }, 'command run log stream error');
    };
    const emitStatus = (status: string, extra: Record<string, unknown> = {}): void => {
      this.ctx.bus.emit('run:status', { runId, status, ...extra });
    };

    try {
      await this.acquireSlot();
      slotAcquired = true;
      await mkdir(runDir, { recursive: true });
      const out = fs.createWriteStream(stdoutPath, { flags: 'a' });
      const errStream = fs.createWriteStream(stderrPath, { flags: 'a' });
      stdoutStream = out;
      stderrStream = errStream;
      out.on('error', onStreamError('stdout'));
      errStream.on('error', onStreamError('stderr'));

      const existing = this.ctx.repos.commandRuns.getById(runId);
      const rawTimeout = overrideTimeoutMs ?? cmd.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutMs = Math.min(Math.max(1, rawTimeout), MAX_TIMEOUT_MS);
      start = Date.now();

      emitStatus('running', { resolvedCommand: existing?.resolvedCommand });

      const env = { ...(tool.envVars ?? {}), ...(cmd.envVars ?? {}) };
      const setup = (tool.setupCommand ?? '').trim();
      const fullCommand = setup
        ? `${setup} && ${existing!.resolvedCommand}`
        : existing!.resolvedCommand;
      const result = await this.ctx.engine.commandExecutor.runCommand(fullCommand, {
        timeoutMs,
        cwd: cmd.workingDir || undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
        cancelToken: token,
        collectOutput: false,
        onProgress: (p) => {
          if (p.message) {
            this.ctx.bus.emit('run:progress', { runId, message: p.message });
          }
          if (p.logLine) {
            const stream = p.stream ?? 'stdout';
            if (stream === 'stderr') {
              errStream.write(p.logLine + '\n');
            } else {
              out.write(p.logLine + '\n');
            }
            this.ctx.bus.emit('run:logLine', {
              runId,
              line: p.logLine,
              stream,
            });
          }
        },
      });

      await Promise.all([
        new Promise<void>((res) => out.end(() => res())),
        new Promise<void>((res) => errStream.end(() => res())),
      ]);

      const durationMs = Date.now() - start;
      const status = result.status === 'success' ? 'success' : result.status;
      const finished = this.ctx.repos.commandRuns.markFinished(runId, {
        status: status as CommandRun['status'],
        exitCode: result.exitCode,
        durationMs,
        stdoutFileRef: stdoutPath,
        stderrFileRef: stderrPath,
        stdoutPreview: tailFile(stdoutPath, PREVIEW_TAIL_BYTES),
      })!;

      this.ctx.repos.audit.insert({
        userId: this.ctx.userId,
        action: 'command_run.finish',
        entityType: 'command_run',
        entityId: runId,
        after: { status: finished.status, exitCode: finished.exitCode, durationMs },
      });

      emitStatus(finished.status, {
        exitCode: finished.exitCode,
        durationMs,
        stdoutPreview: finished.stdoutPreview,
      });

      if (finished.projectId && finished.status === 'success') {
        await this.processProjectResult(finished, tool, cmd, stdoutPath);
      }

      return finished;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error({ err, runId }, 'command run crashed');
      if (stderrStream) {
        try {
          stderrStream.write(`\n[runner crash] ${err.message}\n`);
        } catch {
          // ignore stream write failure
        }
      }
      await Promise.all([
        new Promise<void>((res) => stdoutStream?.end(() => res()) ?? res()),
        new Promise<void>((res) => stderrStream?.end(() => res()) ?? res()),
      ]);
      const error: ExecutionError = { code: 'CRASH', message: err.message, stack: err.stack };
      const finished = this.ctx.repos.commandRuns.markFinished(runId, {
        status: 'crash',
        exitCode: 1,
        durationMs: Date.now() - start,
        stdoutFileRef: stdoutStream ? stdoutPath : undefined,
        stderrFileRef: stderrStream ? stderrPath : undefined,
        stdoutPreview: tailFile(stdoutPath, PREVIEW_TAIL_BYTES),
        error,
      })!;
      this.ctx.repos.audit.insert({
        userId: this.ctx.userId,
        action: 'command_run.finish',
        entityType: 'command_run',
        entityId: runId,
        after: { status: 'crash', error: err.message },
      });
      emitStatus('crash', { exitCode: 1, message: err.message });
      return finished;
    } finally {
      this.active.delete(runId);
      this.releaseSlot();
    }
  }

  /**
   * When a command run is tied to a project and succeeds, anchor its output to
   * a project run/step run, run clause mapping (producing evidence + verdicts),
   * and regenerate the report. Mirrors OrchestratorService.persistResult flow.
   */
  private async processProjectResult(
    run: CommandRun,
    tool: Tool,
    cmd: ToolCommand,
    stdoutPath: string,
  ): Promise<void> {
    const projectId = run.projectId!;
    try {
      const project = this.ctx.repos.projects.getById(projectId);
      if (!project) return;

      const readBounded = async (p: string | undefined): Promise<string> => {
        if (!p) return '';
        try {
          const buf = await readFile(p);
          return buf.toString('utf8').slice(-DETAIL_TAIL_BYTES);
        } catch {
          return '';
        }
      };

      const [stdout, stderr] = await Promise.all([
        readBounded(stdoutPath),
        readBounded(run.stderrFileRef),
      ]);

      // Create an anchoring project run + step run so evidence/verdicts have a home.
      const projectRun = this.ctx.repos.projects.createRun({
        projectId,
        startedBy: run.createdBy,
        snapshotVariables: {},
        triggerMode: 'manual_command',
      });
      const stepId = `cmd-${cmd.id}`;
      const stepSnapshot = {
        stepId,
        title: cmd.name,
        toolId: tool.id,
        params: run.params,
        dependsOn: [],
        onFailure: 'continue',
        position: 0,
      };
      const sr = this.ctx.repos.projects.createStepRun({
        projectRunId: projectRun.id,
        stepId,
        stepSnapshot,
      });

      const result: ExecutionResult = {
        runId: run.id,
        projectId,
        stepId,
        toolId: tool.id,
        status: 'success',
        exitCode: run.exitCode ?? 0,
        stdout,
        stderr,
        durationMs: run.durationMs ?? 0,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? new Date().toISOString(),
        evidence: [
          {
            type: 'stdout_line',
            content: stdout.slice(-8000) || '(无输出)',
            severity: 'low',
            path: stdoutPath,
          },
        ],
        verdicts: [],
      };

      this.clauseMapping.processAndPersist({
        projectId,
        projectRunId: projectRun.id,
        stepRunId: sr.id,
        standardVersion: project.standardVersion,
        toolId: tool.id,
        result,
        commandId: cmd.id,
      });

      // If the run was explicitly attached to a clause, record an evidence/verdict link.
      if (run.clauseId) {
        const clause = this.ctx.repos.clauses.get(project.standardVersion, run.clauseId);
        if (clause) {
          const evidence = this.ctx.repos.results.listEvidenceByStepRun(sr.id);
          const evidenceId = evidence[0]?.id;
          this.ctx.repos.results.insertVerdict({
            stepRunId: sr.id,
            projectRunId: projectRun.id,
            projectId,
            clauseId: run.clauseId,
            pass: true,
            severity: clause.defaultSeverity,
            reason: run.note
              ? `命令执行成功（手动关联）：${run.note}`
              : '命令执行成功（手动关联条款）',
            evidenceRefs: evidenceId ? [evidenceId] : [],
            verdictGroup: run.id,
          });
          this.ctx.repos.projects.updateStepRun(sr.id, {
            evidenceCount: evidence.length,
          });
        }
      }

      this.ctx.repos.projects.updateStepRun(sr.id, {
        status: 'success',
        exitCode: run.exitCode ?? 0,
        durationMs: run.durationMs ?? 0,
        finishedAt: run.finishedAt ?? new Date().toISOString(),
        stdoutFileRef: stdoutPath,
        stderrFileRef: run.stderrFileRef,
        percent: 100,
      });
      this.ctx.repos.projects.updateRun(projectRun.id, {
        status: 'success',
        finishedAt: run.finishedAt ?? new Date().toISOString(),
        progressPercent: 100,
      });

      const { reportService } = await import('./reportService.js');
      await reportService.generateReport(projectId, projectRun.id);
    } catch (e) {
      logger.warn({ err: e, runId: run.id, projectId }, 'command run clause mapping/report failed');
    }
  }

  cancel(runId: string): { cancelled: boolean } {
    const active = this.active.get(runId);
    if (active) {
      active.token.cancel();
      this.ctx.repos.audit.insert({
        userId: this.ctx.userId,
        action: 'command_run.cancel',
        entityType: 'command_run',
        entityId: runId,
      });
      this.ctx.bus.emit('run:status', { runId, status: 'cancelled' });
      return { cancelled: true };
    }
    const run = this.ctx.repos.commandRuns.getById(runId);
    if (run && run.status === 'running') {
      this.ctx.repos.commandRuns.markFinished(runId, {
        status: 'cancelled',
        exitCode: 130,
        error: { code: 'CANCELLED', message: '运行已取消' },
      });
      this.ctx.bus.emit('run:status', { runId, status: 'cancelled' });
      return { cancelled: true };
    }
    throw Errors.validation('运行不在进行中，无法取消');
  }

  list(query: Parameters<ServiceContext['repos']['commandRuns']['list']>[0]) {
    return this.ctx.repos.commandRuns.list({ workspaceId: 'default', ...query });
  }

  get(runId: string): CommandRunDetail {
    const run = this.ctx.repos.commandRuns.getById(runId);
    if (!run) throw Errors.notFound('运行记录', runId);
    return {
      ...run,
      stdout: run.stdoutFileRef ? tailFile(run.stdoutFileRef, DETAIL_TAIL_BYTES) : run.stdoutPreview ?? '',
      stderr: run.stderrFileRef ? tailFile(run.stderrFileRef, DETAIL_TAIL_BYTES) : '',
    };
  }

  attachToProject(
    runId: string,
    patch: { projectId: string; clauseId?: string | null; note?: string | null },
  ): CommandRun {
    const run = this.ctx.repos.commandRuns.getById(runId);
    if (!run) throw Errors.notFound('运行记录', runId);
    const updated = this.ctx.repos.commandRuns.setLink(runId, patch);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'command_run.attach',
      entityType: 'command_run',
      entityId: runId,
      after: patch,
    });
    return updated!;
  }

  waitFor(runId: string): Promise<CommandRun> {
    const active = this.active.get(runId);
    if (active) return active.promise;
    const run = this.ctx.repos.commandRuns.getById(runId);
    if (!run) throw Errors.notFound('运行记录', runId);
    return Promise.resolve(run);
  }
}

function tailFile(filePath: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    try {
      const start = Math.max(0, stat.size - maxBytes);
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}
