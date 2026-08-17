import type {
  ExecutionResult,
  ProjectRun,
  StepRun,
  StepRunStatus,
  TemplateStep,
} from '@en18031/shared';
import { substituteObject, nowIso } from '@en18031/shared';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';
import { createCancelToken } from '../engine/cancelToken.js';
import type { CancelToken } from '@en18031/shared';
import { ClauseMappingService } from './clauseMappingService.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface ActiveRun {
  runId: string;
  projectId: string;
  cancelToken: CancelToken & { cancel: () => void };
  status: ProjectRun['status'];
}

const activeRuns = new Map<string, ActiveRun>();

export class OrchestratorService {
  private clauseMapping: ClauseMappingService;

  constructor(private ctx: ServiceContext) {
    this.clauseMapping = new ClauseMappingService(ctx);
    this.reconcileOrphans();
  }

  private reconcileOrphans(): void {
    for (const sr of this.ctx.repos.projects.listIncompleteStepRuns()) {
      this.ctx.repos.projects.updateStepRun(sr.id, {
        status: 'cancelled',
        finishedAt: nowIso(),
        error: { code: 'INTERRUPTED', message: '服务重启，运行被中断' },
      });
    }
    for (const run of this.ctx.repos.projects.listIncompleteRuns()) {
      this.ctx.repos.projects.updateRun(run.id, {
        status: 'cancelled',
        finishedAt: nowIso(),
        progressPercent: run.progressPercent,
      });
      this.ctx.repos.projects.setStatus(run.projectId, 'cancelled', nowIso());
      activeRuns.delete(run.id);
    }
  }

  async startRun(
    projectId: string,
    options: { stepIds?: string[]; concurrencyOverride?: number; fromStepId?: string } = {},
  ): Promise<ProjectRun> {
    const project = this.ctx.repos.projects.getById(projectId);
    if (!project) throw Errors.notFound('项目', projectId);
    const template = this.ctx.repos.templates.getById(project.templateId);
    if (!template) throw Errors.notFound('模板', project.templateId);

    const variables = { ...project.variables } as Record<string, unknown>;
    const templateDefaults: Record<string, unknown> = {};
    for (const v of template.variables) {
      if (v.default !== undefined && variables[v.name] === undefined) {
        variables[v.name] = v.default;
        templateDefaults[v.name] = v.default;
      }
    }

    let steps = template.steps;
    if (options.stepIds && options.stepIds.length > 0) {
      const set = new Set(options.stepIds);
      steps = steps.filter((s) => set.has(s.stepId));
    }
    if (options.fromStepId) {
      const idx = steps.findIndex((s) => s.stepId === options.fromStepId);
      if (idx < 0) throw Errors.invalidStep(`起始步骤不存在: ${options.fromStepId}`);
      steps = steps.slice(idx);
    }

    this.validateDag(steps);

    for (const step of steps) {
      const tool = this.ctx.repos.tools.getById(step.toolId);
      if (!tool) throw Errors.validation(`步骤 ${step.stepId} 引用的工具 ${step.toolId} 不存在`);
      if (tool.healthStatus === 'red') {
        throw Errors.toolUnhealthy(`工具 ${tool.name} 健康状态为红色，请先修复`);
      }
    }

    const run = this.ctx.repos.projects.createRun({
      projectId,
      startedBy: this.ctx.userId,
      snapshotVariables: variables,
    });

    this.ctx.repos.projects.setStatus(projectId, 'running');
    for (const step of steps) {
      this.ctx.repos.projects.createStepRun({
        projectRunId: run.id,
        stepId: step.stepId,
        stepSnapshot: step,
      });
    }

    const cancelToken = createCancelToken();
    activeRuns.set(run.id, { runId: run.id, projectId, cancelToken, status: 'running' });

    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'run.start',
      entityType: 'project_run',
      entityId: run.id,
      after: { projectId, stepCount: steps.length },
    });

    void this.executeRun(run.id, projectId, template.id, steps, variables, templateDefaults, options.concurrencyOverride ?? template.concurrencyLimit)
      .catch((err) => logger.error({ err, runId: run.id }, 'executeRun rejected'));
    return this.ctx.repos.projects.getRun(run.id)!;
  }

  cancelRun(runId: string): void {
    const active = activeRuns.get(runId);
    if (active) {
      active.cancelToken.cancel();
      active.status = 'cancelled';
    }
    this.ctx.repos.projects.updateRun(runId, { cancelRequested: true });
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'run.cancel',
      entityType: 'project_run',
      entityId: runId,
    });
  }

  async retryStep(projectId: string, runId: string, stepRunId: string): Promise<StepRun> {
    const project = this.ctx.repos.projects.getById(projectId);
    if (!project) throw Errors.notFound('项目', projectId);
    const old = this.ctx.repos.projects.getStepRun(stepRunId);
    if (!old) throw Errors.notFound('步骤执行', stepRunId);
    if (old.projectRunId !== runId) throw Errors.validation('该步骤不属于此运行');
    const run = this.ctx.repos.projects.getRun(runId);
    if (!run) throw Errors.notFound('运行', runId);
    if (activeRuns.has(runId)) {
      throw Errors.validation('运行仍在进行中，无法重试');
    }
    const retryable: StepRunStatus[] = ['fail', 'timeout', 'cancelled', 'fail_abort_triggered', 'partial'];
    if (!retryable.includes(old.status)) {
      throw Errors.validation('只能重试失败、超时或已取消的步骤');
    }
    const template = this.ctx.repos.templates.getById(project.templateId);
    if (!template) throw Errors.notFound('模板', project.templateId);

    const variables = run.snapshotVariables as Record<string, unknown>;
    const templateDefaults: Record<string, unknown> = {};
    for (const v of template.variables) {
      if (v.default !== undefined) templateDefaults[v.name] = v.default;
    }

    // Create a fresh attempt for the target step (retryOf preserves history).
    const newSr = this.ctx.repos.projects.createStepRun({
      projectRunId: runId,
      stepId: old.stepId,
      stepSnapshot: old.stepSnapshot,
      retryOf: old.id,
    });

    // Reconstruct the step graph from the run's existing step snapshots.
    const latest = this.latestStepRunMap(runId);
    latest.set(old.stepId, newSr);
    const steps = [...latest.values()]
      .map((sr) => sr.stepSnapshot as TemplateStep)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    this.validateDag(steps);

    // Reset every transitive dependent of the target so the scheduler reruns them.
    const descendants = this.computeDescendants(steps, old.stepId);
    for (const depStepId of descendants) {
      const depSr = latest.get(depStepId);
      if (!depSr || depSr.id === newSr.id) continue;
      this.ctx.repos.projects.updateStepRun(depSr.id, {
        status: 'pending',
        startedAt: undefined,
        finishedAt: undefined,
        exitCode: undefined,
        durationMs: undefined,
        error: undefined,
        percent: 0,
      });
      const reset = this.ctx.repos.projects.getStepRun(depSr.id)!;
      latest.set(depStepId, reset);
      this.emitStatus(projectId, runId, reset);
    }
    this.emitStatus(projectId, runId, newSr);

    // Flip the parent run/project back to running with a new cancellable token.
    const cancelToken = createCancelToken();
    activeRuns.set(runId, { runId, projectId, cancelToken, status: 'running' });
    this.ctx.repos.projects.updateRun(runId, {
      status: 'running',
      startedAt: run.startedAt,
      finishedAt: undefined,
      progressPercent: 0,
      cancelRequested: false,
    });
    this.ctx.repos.projects.setStatus(projectId, 'running');
    this.ctx.bus.emit('run:batchProgress', { projectId, runId, percent: 0, status: 'running' });
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'run.retry_step',
      entityType: 'project_run',
      entityId: runId,
      after: { stepRunId: newSr.id, stepId: old.stepId, retryOf: old.id },
    });

    void this.driveScheduler({
      runId,
      projectId,
      templateId: template.id,
      steps,
      variables,
      templateDefaults,
      concurrency: template.concurrencyLimit,
    })
      .then(async () => {
        try {
          const { reportService } = await import('./reportService.js');
          await reportService.generateReport(projectId, runId);
        } catch (e) {
          this.ctx.bus.emit('run:logLine', {
            projectId,
            runId,
            line: `[警告] 重试后报告生成失败: ${(e as Error).message}`,
          });
        }
      })
      .catch((err) => logger.error({ err, runId }, 'retry driveScheduler rejected'));

    return newSr;
  }

  private latestStepRunMap(runId: string): Map<string, StepRun> {
    const map = new Map<string, StepRun>();
    for (const sr of this.ctx.repos.projects.listStepRuns(runId)) {
      map.set(sr.stepId, sr);
    }
    return map;
  }

  private computeDescendants(steps: TemplateStep[], rootStepId: string): string[] {
    const dependents = new Map<string, string[]>();
    for (const s of steps) {
      for (const dep of s.dependsOn) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep)!.push(s.stepId);
      }
    }
    const result: string[] = [];
    const stack = [rootStepId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const child of dependents.get(cur) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        result.push(child);
        stack.push(child);
      }
    }
    return result;
  }

  private validateDag(steps: TemplateStep[]): void {
    const ids = new Set(steps.map((s) => s.stepId));
    for (const s of steps) {
      for (const d of s.dependsOn) {
        if (!ids.has(d)) throw Errors.invalidStep(`步骤 ${s.stepId} 依赖不存在的 ${d}`);
      }
    }
    const visited = new Set<string>();
    const stack = new Set<string>();
    const dfs = (id: string): void => {
      if (stack.has(id)) throw Errors.cycle(`循环依赖: ${id}`);
      if (visited.has(id)) return;
      stack.add(id);
      const s = steps.find((x) => x.stepId === id);
      for (const d of s?.dependsOn ?? []) dfs(d);
      stack.delete(id);
      visited.add(id);
    };
    for (const s of steps) dfs(s.stepId);
  }

  private async executeRun(
    runId: string,
    projectId: string,
    templateId: string,
    steps: TemplateStep[],
    variables: Record<string, unknown>,
    templateDefaults: Record<string, unknown>,
    concurrency: number,
  ): Promise<void> {
    await this.driveScheduler({
      runId,
      projectId,
      templateId,
      steps,
      variables,
      templateDefaults,
      concurrency,
    });

    try {
      const reportService = (await import('./reportService.js')).reportService;
      await reportService.generateReport(projectId, runId);
    } catch (e) {
      this.ctx.bus.emit('run:logLine', { projectId, runId, line: `[警告] 报告生成失败: ${(e as Error).message}` });
    }
  }

  private async driveScheduler(params: {
    runId: string;
    projectId: string;
    templateId: string;
    steps: TemplateStep[];
    variables: Record<string, unknown>;
    templateDefaults: Record<string, unknown>;
    concurrency: number;
  }): Promise<void> {
    const { runId, projectId, templateId, steps, variables, concurrency } = params;
    const active = activeRuns.get(runId)!;
    const stepRunByStepId = this.latestStepRunMap(runId);
    const stepOutputs = await this.rebuildStepOutputs(steps, runId);
    const terminalStatuses = new Set<StepRunStatus>([
      'success',
      'fail',
      'fail_abort_triggered',
      'skipped',
      'timeout',
      'cancelled',
      'partial',
    ]);
    const running = new Set<string>();
    let abortTriggered = false;

    const totalWeight = steps.reduce((sum, s) => sum + (s.weight ?? 1), 0);

    const updateBatchProgress = (): void => {
      let weighted = 0;
      for (const step of steps) {
        const sr = stepRunByStepId.get(step.stepId);
        if (!sr) continue;
        const w = step.weight ?? 1;
        weighted += w * sr.percent;
      }
      const rawPercent = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;
      const percent = Math.max(0, Math.min(100, rawPercent));
      // ETA based on average duration of completed steps and remaining work.
      let eta: string | undefined;
      const completed = [...stepRunByStepId.values()].filter(
        (sr) => sr.status === 'success' || sr.status === 'fail' || sr.status === 'skipped',
      );
      if (completed.length > 0) {
        const knownDurations = completed.map((s) => s.durationMs).filter((d): d is number => typeof d === 'number');
        if (knownDurations.length > 0) {
          const avg = knownDurations.reduce((a, b) => a + b, 0) / knownDurations.length;
          const remaining = steps.filter((s) => {
            const sr = stepRunByStepId.get(s.stepId);
            return sr && (sr.status === 'pending' || sr.status === 'running' || sr.status === 'scheduled');
          }).length;
          if (remaining > 0) {
            eta = new Date(Date.now() + avg * remaining).toISOString();
            this.ctx.repos.projects.updateRun(runId, { progressPercent: percent, eta });
          } else {
            this.ctx.repos.projects.updateRun(runId, { progressPercent: percent });
          }
        } else {
          this.ctx.repos.projects.updateRun(runId, { progressPercent: percent });
        }
      } else {
        this.ctx.repos.projects.updateRun(runId, { progressPercent: percent });
      }
      this.ctx.bus.emit('run:batchProgress', { projectId, runId, percent, eta });
    };

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const tick = (): void => {
        if (settled) return;
        if (active.cancelToken.isRequested) {
          for (const sr of stepRunByStepId.values()) {
            if (!terminalStatuses.has(sr.status)) {
              this.ctx.repos.projects.updateStepRun(sr.id, { status: 'cancelled', finishedAt: nowIso() });
              this.emitStatus(projectId, runId, this.ctx.repos.projects.getStepRun(sr.id)!);
            }
          }
          this.ctx.repos.projects.updateRun(runId, { status: 'cancelled', finishedAt: nowIso(), progressPercent: 100 });
          this.ctx.repos.projects.setStatus(projectId, 'cancelled', nowIso());
          activeRuns.delete(runId);
          done();
          return;
        }

        for (const sr of this.latestStepRunMap(runId).values()) {
          stepRunByStepId.set(sr.stepId, sr);
        }

        for (const step of steps) {
          if (running.has(step.stepId)) continue;
          const sr = stepRunByStepId.get(step.stepId)!;
          if (terminalStatuses.has(sr.status)) continue;
          if (abortTriggered && sr.status === 'pending') {
            this.ctx.repos.projects.updateStepRun(sr.id, { status: 'skipped', finishedAt: nowIso() });
            const skipped = this.ctx.repos.projects.getStepRun(sr.id)!;
            stepRunByStepId.set(step.stepId, skipped);
            this.emitStatus(projectId, runId, skipped);
            continue;
          }
          const deps = step.dependsOn;
          const depStatuses = deps.map((d) => {
            const depSr = stepRunByStepId.get(d);
            return depSr?.status ?? 'pending';
          });
          const allDepsDone = deps.length === 0 || depStatuses.every((s) => terminalStatuses.has(s));
          if (!allDepsDone) continue;
          const depFailed = deps.some((d) => {
            const ds = stepRunByStepId.get(d)?.status;
            return ds === 'fail' || ds === 'fail_abort_triggered' || ds === 'timeout' || ds === 'cancelled';
          });
          if (depFailed) {
            this.ctx.repos.projects.updateStepRun(sr.id, { status: 'skipped', finishedAt: nowIso() });
            const skipped = this.ctx.repos.projects.getStepRun(sr.id)!;
            stepRunByStepId.set(step.stepId, skipped);
            this.emitStatus(projectId, runId, skipped);
            continue;
          }
          if (running.size >= concurrency) continue;

          running.add(step.stepId);
          this.ctx.repos.projects.updateStepRun(sr.id, { status: 'running', startedAt: nowIso(), percent: 0 });
          const runningSr = this.ctx.repos.projects.getStepRun(sr.id)!;
          stepRunByStepId.set(step.stepId, runningSr);
          this.emitStatus(projectId, runId, runningSr);

          void this.executeSingleStep(sr.id, projectId, runId, step, variables, stepOutputs)
            .then((result) => {
              running.delete(step.stepId);
              if (result.status !== 'success' && step.onFailure === 'abort') {
                abortTriggered = true;
                this.ctx.repos.projects.updateStepRun(sr.id, { status: 'fail_abort_triggered' });
              }
              if (result.status === 'success' && step.exportVars) {
                stepOutputs[step.stepId] = this.extractExportVars(step, result);
              }
              this.emitStatus(projectId, runId, this.ctx.repos.projects.getStepRun(sr.id)!);
              updateBatchProgress();
              if (this.isAllDone(steps, stepRunByStepId)) {
                this.finishRun(runId, projectId, templateId);
                done();
              } else {
                tick();
              }
            })
            .catch((err) => {
              running.delete(step.stepId);
              this.ctx.repos.projects.updateStepRun(sr.id, {
                status: 'fail',
                finishedAt: nowIso(),
                error: { code: 'ORCHESTRATOR_ERROR', message: (err as Error).message },
              });
              this.emitStatus(projectId, runId, this.ctx.repos.projects.getStepRun(sr.id)!);
              if (this.isAllDone(steps, stepRunByStepId)) {
                this.finishRun(runId, projectId, templateId);
                done();
              } else {
                tick();
              }
            });
          updateBatchProgress();
        }

        if (running.size === 0 && this.isAllDone(steps, stepRunByStepId)) {
          this.finishRun(runId, projectId, templateId);
          done();
        }
      };
      tick();
    });
  }

  private async rebuildStepOutputs(
    steps: TemplateStep[],
    runId: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {};
    const latest = this.latestStepRunMap(runId);
    for (const step of steps) {
      if (!step.exportVars) continue;
      const sr = latest.get(step.stepId);
      if (!sr || sr.status !== 'success' || !sr.stdoutFileRef) continue;
      try {
        const stdout = await readFile(sr.stdoutFileRef, 'utf8');
        out[step.stepId] = this.extractExportVars(step, { stdout } as ExecutionResult);
      } catch {
        // ignore unreadable evidence; downstream steps will re-run or fail naturally
      }
    }
    return out;
  }

  private isAllDone(steps: TemplateStep[], map: Map<string, StepRun>): boolean {
    return steps.every((s) => {
      const sr = map.get(s.stepId);
      return sr && ![ 'pending', 'scheduled', 'running' ].includes(sr.status);
    });
  }

  private finishRun(runId: string, projectId: string, templateId: string): void {
    if (!activeRuns.has(runId)) return;
    // Only the latest attempt per step counts toward aggregate status; superseded
    // (retried) attempts remain in history but must not flip a recovered run to fail.
    const srs = [...this.latestStepRunMap(runId).values()];
    const hasFail = srs.some((s) => s.status === 'fail' || s.status === 'fail_abort_triggered');
    const hasTimeout = srs.some((s) => s.status === 'timeout');
    const hasPartial = srs.some((s) => s.status === 'partial');
    const allSuccess = srs.every((s) => s.status === 'success' || s.status === 'skipped');
    let status: ProjectRun['status'] = 'success';
    let projectStatus = 'success';
    if (hasFail) {
      status = 'fail';
      projectStatus = 'fail';
    } else if (hasTimeout || hasPartial) {
      status = 'partial';
      projectStatus = 'partial';
    } else if (!allSuccess) {
      status = 'partial';
      projectStatus = 'partial';
    }
    this.ctx.repos.projects.updateRun(runId, { status, finishedAt: nowIso(), progressPercent: 100 });
    this.ctx.repos.projects.setStatus(projectId, projectStatus, nowIso());
    this.ctx.bus.emit('run:batchProgress', { projectId, runId, percent: 100, status });
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'run.finish',
      entityType: 'project_run',
      entityId: runId,
      after: { status, steps: srs.length },
    });
    activeRuns.delete(runId);
  }

  private emitStatus(projectId: string, runId: string, sr: StepRun): void {
    this.ctx.bus.emit('run:status', { projectId, runId, stepRunId: sr.id, stepId: sr.stepId, status: sr.status, percent: sr.percent });
  }

  private async executeSingleStep(
    stepRunId: string,
    projectId: string,
    runId: string,
    step: TemplateStep,
    projectVariables: Record<string, unknown>,
    stepOutputs: Record<string, Record<string, unknown>>,
  ): Promise<ExecutionResult> {
    const project = this.ctx.repos.projects.getById(projectId)!;
    const template = this.ctx.repos.templates.getById(project.templateId)!;
    const templateDefaults: Record<string, unknown> = {};
    for (const v of template.variables) {
      if (v.default !== undefined) templateDefaults[v.name] = v.default;
    }

    const subbed = substituteObject(step.params, projectVariables, templateDefaults, stepOutputs);
    if (subbed.missing.length > 0) {
      const errResult: ExecutionResult = {
        runId: stepRunId,
        projectId,
        stepId: step.stepId,
        toolId: step.toolId,
        status: 'fail',
        exitCode: 1,
        stdout: '',
        stderr: `未解析的占位符: ${subbed.missing.join(', ')}`,
        durationMs: 0,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        evidence: [{ type: 'validation_error', content: `未解析的占位符: ${subbed.missing.join(', ')}`, severity: 'high' }],
        verdicts: [],
        error: { code: 'UNRESOLVED_PLACEHOLDER', message: subbed.missing.join(', ') },
      };
      await this.persistResult(stepRunId, projectId, runId, step.toolId, errResult);
      this.ctx.repos.projects.updateStepRun(stepRunId, {
        status: 'fail',
        finishedAt: nowIso(),
        percent: 100,
        error: errResult.error,
        exitCode: 1,
      });
      return errResult;
    }
    const params = subbed.value as Record<string, unknown>;

    const tool = this.ctx.repos.tools.getById(step.toolId)!;
    const onProgress = (p: { percent?: number; message?: string; logLine?: string }): void => {
      if (p.logLine) {
        this.ctx.bus.emit('run:logLine', { projectId, runId, stepRunId, stepId: step.stepId, line: p.logLine });
      }
      if (p.percent !== undefined) {
        const pct = Math.max(0, Math.min(100, Math.round(p.percent)));
        this.ctx.repos.projects.updateStepRun(stepRunId, { percent: pct });
        this.ctx.bus.emit('run:progress', { projectId, runId, stepRunId, stepId: step.stepId, percent: pct, message: p.message });
      }
    };

    const active = activeRuns.get(runId);
    const cancelToken = active?.cancelToken ?? createCancelToken();

    let result: ExecutionResult;
    if (tool.interactionMode === 'form' || step.interactionModeOverride === 'form') {
      result = await this.ctx.engine.runModule(step.toolId, params, {
        projectId,
        stepId: step.stepId,
        userId: this.ctx.userId,
        variables: projectVariables,
        onProgress,
        cancelToken,
        timeoutMs: step.timeoutMs,
      });
    } else {
      const command = this.buildCommand(step, params);
      result = await this.ctx.engine.runCommand(command, {
        projectId,
        stepId: step.stepId,
        toolId: step.toolId,
        timeoutMs: step.timeoutMs ?? config.executionTimeoutMs,
        onProgress,
        cancelToken,
      });
    }

    await this.persistResult(stepRunId, projectId, runId, step.toolId, result);
    this.ctx.repos.projects.updateStepRun(stepRunId, {
      status: result.status === 'success' ? 'success' : result.status === 'cancelled' ? 'cancelled' : result.status === 'timeout' ? 'timeout' : 'fail',
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      finishedAt: nowIso(),
      percent: 100,
      error: result.error,
    });
    return result;
  }

  private async persistResult(
    stepRunId: string,
    projectId: string,
    runId: string,
    toolId: string,
    result: ExecutionResult,
  ): Promise<void> {
    const project = this.ctx.repos.projects.getById(projectId)!;
    const stdoutPath = path.join(config.filesDir, 'evidence', `${stepRunId}.stdout.log`);
    const stderrPath = path.join(config.filesDir, 'evidence', `${stepRunId}.stderr.log`);
    await mkdir(path.dirname(stdoutPath), { recursive: true });
    await writeFile(stdoutPath, result.stdout, 'utf8');
    if (result.stderr) await writeFile(stderrPath, result.stderr, 'utf8');
    this.ctx.repos.projects.updateStepRun(stepRunId, {
      stdoutFileRef: stdoutPath,
      stderrFileRef: result.stderr ? stderrPath : undefined,
    });
    this.clauseMapping.processAndPersist({
      projectId,
      projectRunId: runId,
      stepRunId,
      standardVersion: project.standardVersion,
      toolId,
      result,
    });
  }

  async runToolManually(
    projectId: string,
    toolId: string,
    params: Record<string, unknown>,
    opts: { commandId?: string; timeoutMs?: number } = {},
  ): Promise<{ runId: string; stepRunId: string; result: ExecutionResult }> {
    const project = this.ctx.repos.projects.getById(projectId);
    if (!project) throw Errors.notFound('项目', projectId);
    const tool = this.ctx.repos.tools.getById(toolId);
    if (!tool) throw Errors.notFound('工具', toolId);
    const run = this.ctx.repos.projects.createRun({
      projectId,
      startedBy: this.ctx.userId,
      snapshotVariables: project.variables as Record<string, unknown>,
      triggerMode: 'manual',
    });
    const step: TemplateStep = {
      stepId: `manual-${toolId}-${Date.now()}`,
      title: `手动执行: ${tool.name}`,
      toolId,
      toolVersion: tool.version,
      params,
      dependsOn: [],
      onFailure: 'continue',
      position: 0,
    };
    const sr = this.ctx.repos.projects.createStepRun({
      projectRunId: run.id,
      stepId: step.stepId,
      stepSnapshot: step,
    });

    const onProgress = (p: { percent?: number; message?: string; logLine?: string }): void => {
      if (p.logLine) {
        this.ctx.bus.emit('run:logLine', { projectId, runId: run.id, stepRunId: sr.id, stepId: step.stepId, line: p.logLine });
      }
      if (p.percent !== undefined) {
        this.ctx.repos.projects.updateStepRun(sr.id, { percent: p.percent });
      }
    };

    this.ctx.repos.projects.updateStepRun(sr.id, { status: 'running', startedAt: nowIso() });
    let result: ExecutionResult;
    if (tool.interactionMode === 'form') {
      result = await this.ctx.engine.runModule(toolId, params, {
        projectId,
        stepId: step.stepId,
        userId: this.ctx.userId,
        variables: project.variables as Record<string, unknown>,
        onProgress,
        cancelToken: createCancelToken(),
        timeoutMs: opts.timeoutMs,
      });
    } else {
      const command = this.buildCommand(step, params);
      result = await this.ctx.engine.runCommand(command, {
        projectId,
        stepId: step.stepId,
        toolId,
        timeoutMs: opts.timeoutMs ?? config.executionTimeoutMs,
        onProgress,
        cancelToken: createCancelToken(),
      });
    }
    await this.persistResult(sr.id, projectId, run.id, toolId, result);
    const runStatus: 'success' | 'fail' | 'cancelled' =
      result.status === 'success'
        ? 'success'
        : result.status === 'cancelled'
          ? 'cancelled'
          : 'fail';
    this.ctx.repos.projects.updateStepRun(sr.id, {
      status: runStatus,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      finishedAt: nowIso(),
      percent: 100,
      error: result.error,
    });
    this.ctx.repos.projects.updateRun(run.id, { status: runStatus, finishedAt: nowIso(), progressPercent: 100 });
    this.ctx.repos.projects.setStatus(projectId, runStatus, nowIso());
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'run.manual_tool',
      entityType: 'project_run',
      entityId: run.id,
      after: { toolId, status: result.status },
    });
    try {
      const { reportService } = await import('./reportService.js');
      await reportService.generateReport(projectId, run.id);
    } catch {
      // report generation failure should not fail the manual run
    }
    return { runId: run.id, stepRunId: sr.id, result };
  }

  async fileHash(p: string): Promise<string> {
    try {
      return crypto.createHash('sha256').update(await readFile(p)).digest('hex');
    } catch {
      return '';
    }
  }

  private buildCommand(step: TemplateStep, params: Record<string, unknown>): string {
    const tool = this.ctx.repos.tools.getById(step.toolId);
    const parts: string[] = [];
    if (tool?.path) parts.push(tool.path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'boolean') {
        if (v) parts.push(`--${k}`);
      } else {
        parts.push(`--${k} ${this.shellQuote(String(v))}`);
      }
    }
    return parts.join(' ');
  }

  private shellQuote(s: string): string {
    if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(s)) return s;
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }

  private extractExportVars(step: TemplateStep, result: ExecutionResult): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!step.exportVars) return out;
    for (const [varName, rule] of Object.entries(step.exportVars)) {
      try {
        if (rule.type === 'field') {
          out[varName] = (result as unknown as Record<string, unknown>)[rule.field as string] ?? (result.stdout as unknown);
        } else if (rule.type === 'regex') {
          const re = new RegExp(rule.pattern as string, 'm');
          const m = result.stdout.match(re);
          out[varName] = m ? (rule.group !== undefined ? m[Number(rule.group)] : m[0]) : '';
        } else if (rule.type === 'jsonpath') {
          out[varName] = this.jsonPath(result.stdout, rule.path as string);
        } else if (rule.type === 'file') {
          out[varName] = '';
        }
      } catch {
        out[varName] = '';
      }
    }
    return out;
  }

  private jsonPath(json: string, path: string): unknown {
    try {
      const data = JSON.parse(json);
      const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
      let cur: unknown = data;
      for (const p of parts) {
        const arrMatch = p.match(/^([^\[]+)\[(\*|\d+)\]$/);
        if (arrMatch) {
          const [, key, idx] = arrMatch;
          const arr = (cur as Record<string, unknown>)[key] as unknown[];
          if (idx === '*') {
            cur = arr;
          } else {
            cur = arr[Number(idx)];
          }
        } else {
          cur = (cur as Record<string, unknown>)[p];
        }
      }
      return cur;
    } catch {
      return null;
    }
  }
}
