import type { AgentToolContext, ToolResult } from '../agentContext.js';
import { startAgentStepRun, finalizeStepRun, toolError } from './common.js';

interface PlanHumanStepArgs {
  title?: string;
  instruction: string;
  expectedOutcome?: string;
  referenceCommand?: string;
  evidenceReq?: { required?: boolean; functionModule?: string; accept?: string };
}

/**
 * plan_human_step: create a human_instruction stepRun, emit the request, and
 * block (await) until a human calls completeHumanStep (REST) or the timeout
 * fires. The planner loop therefore naturally pauses for the operator.
 */
export async function planHumanStep(ctx: AgentToolContext, args: PlanHumanStepArgs): Promise<ToolResult> {
  if (!args.instruction) return toolError('缺少 instruction 参数');
  const { session, deps } = ctx;
  const phase = session.phase;
  const sr = startAgentStepRun(ctx, {
    stepType: 'human_instruction',
    phase,
    title: args.title ?? '人工操作步骤',
    instruction: args.instruction,
    expectedOutcome: args.expectedOutcome,
    functionModule: args.evidenceReq?.functionModule,
  });

  deps.repos.projects.updateStepRun(sr.id, { status: 'running', percent: 0 });
  deps.repos.agent.updateStatus(session.id, 'waiting_human');

  ctx.forward({
    event: 'agent:human_step_requested',
    sessionId: session.id,
    stepRunId: sr.id,
    instruction: args.instruction,
    expectedOutcome: args.expectedOutcome,
    referenceCommand: args.referenceCommand,
  });
  ctx.emit({ type: 'human_step', stepRunId: sr.id, content: args.instruction, toolStatus: 'requested' });

  try {
    const completion = await deps.coordinator.wait(sr.id, {
      timeoutMs: deps.humanStepTimeoutMs,
      onTimeout: () => {
        finalizeStepRun(ctx, sr.id, 'timeout', { error: { code: 'HUMAN_STEP_TIMEOUT', message: '人工步骤超时' } });
        deps.repos.agent.updateStatus(session.id, 'error', '人工步骤超时');
        ctx.forward({ event: 'agent:error', sessionId: session.id, stepRunId: sr.id, message: '人工步骤超时，已归档' });
      },
    });

    // Attach any uploaded files as evidence.
    const evidenceRefs: string[] = [];
    for (const fileRef of completion.fileRefs) {
      const row = deps.repos.results.insertEvidence({
        stepRunId: sr.id,
        projectRunId: ctx.projectRunId,
        projectId: session.projectId,
        type: 'file_pointer',
        content: args.evidenceReq?.functionModule ? `证据: ${args.evidenceReq.functionModule}` : '人工步骤附件',
        fileRef,
        severity: 'low',
        functionModule: args.evidenceReq?.functionModule,
        sourceStepType: 'human_instruction',
        mimeType: guessMime(fileRef),
      });
      evidenceRefs.push(row.id);
      ctx.forward({
        event: 'agent:evidence_attached',
        sessionId: session.id,
        evidence: { id: row.id, type: 'file_pointer', content: row.content, functionModule: args.evidenceReq?.functionModule },
      });
    }

    deps.repos.projects.updateStepRun(sr.id, { artifacts: completion.fileRefs, percent: 100 });
    finalizeStepRun(ctx, sr.id, 'success');

    ctx.emit({
      type: 'human_step',
      stepRunId: sr.id,
      content: completion.note ?? '人工步骤已完成',
      toolStatus: 'completed',
    });
    ctx.forward({
      event: 'agent:human_step_completed',
      sessionId: session.id,
      stepRunId: sr.id,
      fileRefs: completion.fileRefs,
      note: completion.note,
    });
    deps.repos.audit.insert({
      userId: completion.completedBy,
      action: 'agent.human_step_complete',
      entityType: 'step_run',
      entityId: sr.id,
      after: { fileCount: completion.fileRefs.length, note: completion.note },
    });

    return {
      content: JSON.stringify(
        {
          completed: true,
          note: completion.note,
          fileRefs: completion.fileRefs,
          evidenceRefs,
          completedAt: completion.completedAt,
        },
        null,
        2,
      ),
      data: { completion, evidenceRefs },
      stepRun: sr,
    };
  } catch (err) {
    return toolError((err as Error).message);
  }
}

function guessMime(filePath: string): string | undefined {
  const ext = filePath.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    txt: 'text/plain', log: 'text/plain', json: 'application/json',
    pcap: 'application/vnd.tcpdump.pcap', pcapng: 'application/vnd.tcpdump.pcap',
    pdf: 'application/pdf',
  };
  return ext ? map[ext] : undefined;
}
