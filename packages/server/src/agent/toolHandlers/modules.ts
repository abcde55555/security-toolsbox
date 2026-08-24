import type { ExecutionResult } from '@en18031/shared';
import { createCancelToken } from '../../engine/cancelToken.js';
import type { AgentToolContext, ToolResult } from '../agentContext.js';
import { startAgentStepRun, finalizeStepRun, writeStepLog, toolError } from './common.js';

interface RunModuleArgs {
  moduleId: string;
  params?: Record<string, unknown>;
  title?: string;
  functionModule?: string;
  clauseId?: string;
}

/**
 * run_module: execute a registered (form-mode) module via the existing
 * ExecutionEngine. Reuses onProgress streaming, cancelToken propagation, and
 * persists stdout/stderr/evidence exactly like OrchestratorService does.
 */
export async function runModule(ctx: AgentToolContext, args: RunModuleArgs): Promise<ToolResult> {
  if (!args.moduleId) return toolError('缺少 moduleId 参数');
  const { deps, session, projectRunId } = ctx;
  const module = deps.moduleLoader.get(args.moduleId);
  if (!module) return toolError(`模组未加载: ${args.moduleId}`);

  const phase = session.phase;
  const sr = startAgentStepRun(ctx, {
    stepType: 'tool_exec',
    phase,
    title: args.title ?? `执行模组: ${module.config.name}`,
    functionModule: args.functionModule,
  });
  const toolCallId = sr.id;
  const params = args.params ?? {};
  const project = deps.repos.projects.getById(session.projectId)!;

  ctx.forward({
    event: 'agent:tool_call',
    sessionId: session.id,
    stepRunId: sr.id,
    toolCallId,
    tool: args.moduleId,
    args: params,
  });

  const cancelToken = createCancelToken();
  const onAbort = () => cancelToken.cancel();
  ctx.signal.addEventListener('abort', onAbort, { once: true });

  const onProgress = (p: { percent?: number; message?: string; logLine?: string }): void => {
    if (p.logLine) {
      ctx.forward({
        event: 'agent:tool_output',
        sessionId: session.id,
        stepRunId: sr.id,
        toolCallId,
        stream: 'stdout',
        chunk: p.logLine,
      });
    }
    if (p.percent !== undefined) {
      const pct = Math.max(0, Math.min(100, Math.round(p.percent)));
      deps.repos.projects.updateStepRun(sr.id, { percent: pct });
      ctx.forward({
        event: 'agent:progress',
        sessionId: session.id,
        stepRunId: sr.id,
        percent: pct,
        message: p.message,
      });
    }
  };

  let result: ExecutionResult;
  try {
    result = await deps.engine.runModule(args.moduleId, params, {
      projectId: session.projectId,
      stepId: sr.stepId,
      userId: deps.userId,
      variables: project.variables,
      onProgress,
      cancelToken,
    });
  } catch (err) {
    ctx.signal.removeEventListener('abort', onAbort);
    finalizeStepRun(ctx, sr.id, 'fail', { error: { code: 'MODULE_ERROR', message: (err as Error).message } });
    return toolError(`模组执行异常: ${(err as Error).message}`);
  }
  ctx.signal.removeEventListener('abort', onAbort);

  const stdoutRef = await writeStepLog(sr.id, 'stdout', result.stdout);
  if (result.stderr) await writeStepLog(sr.id, 'stderr', result.stderr);
  deps.repos.projects.updateStepRun(sr.id, { stdoutFileRef: stdoutRef });

  // Persist evidence rows (B-phase evidence has clauseId null; C-phase may bind a clause).
  const evidenceRefs: string[] = [];
  for (const ev of result.evidence ?? []) {
    const row = deps.repos.results.insertEvidence({
      stepRunId: sr.id,
      projectRunId,
      projectId: session.projectId,
      type: ev.type,
      content: ev.content,
      fileRef: ev.path,
      hash: ev.hash,
      severity: ev.severity,
      functionModule: args.functionModule,
      clauseId: args.clauseId,
      sourceStepType: 'tool_exec',
      mimeType: ev.path ? guessMime(ev.path) : undefined,
    });
    evidenceRefs.push(row.id);
  }

  const finalStatus =
    result.status === 'success' ? 'success'
      : result.status === 'cancelled' ? 'cancelled'
      : result.status === 'timeout' ? 'timeout'
      : 'fail';
  finalizeStepRun(ctx, sr.id, finalStatus, { error: result.error });

  ctx.emit({
    type: 'tool_result',
    stepRunId: sr.id,
    toolName: args.moduleId,
    toolStatus: finalStatus,
    content: result.stdout.slice(-4000) || result.stderr.slice(-2000),
  });
  ctx.forward({
    event: 'agent:tool_result',
    sessionId: session.id,
    stepRunId: sr.id,
    toolCallId,
    status: finalStatus,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: result.stdout.slice(-4000),
    evidenceRefs,
  });

  return {
    content: JSON.stringify(
      {
        status: finalStatus,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout.slice(-4000),
        stderr: result.stderr.slice(-2000),
        evidenceCount: evidenceRefs.length,
        evidenceRefs,
        error: result.error,
      },
      null,
      2,
    ),
    data: { result, evidenceRefs },
    stepRun: sr,
    isError: finalStatus !== 'success',
  };
}

function guessMime(filePath: string): string | undefined {
  const ext = filePath.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    txt: 'text/plain', log: 'text/plain', json: 'application/json',
    pcap: 'application/vnd.tcpdump.pcap', pcapng: 'application/vnd.tcpdump.pcap',
    pdf: 'application/pdf', csv: 'text/csv',
  };
  return ext ? map[ext] : undefined;
}
