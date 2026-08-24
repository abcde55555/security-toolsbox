import type { AgentPhase, StepRun, StepType } from '@en18031/shared';
import { nowIso, uuid } from '@en18031/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import type { AgentToolContext, ToolResult } from '../agentContext.js';

/**
 * Create a step_run owned by the agent session, emit step_started, and mark
 * it running. Callers are responsible for finalizing it via finalizeStepRun.
 */
export function startAgentStepRun(
  ctx: AgentToolContext,
  params: {
    stepType: StepType;
    phase: AgentPhase;
    title: string;
    functionModule?: string;
    instruction?: string;
    expectedOutcome?: string;
  },
): StepRun {
  const { session, projectRunId, deps } = ctx;
  const stepId = `agent-${params.stepType}-${uuid().slice(0, 8)}`;
  const sr = deps.repos.projects.createAgentStepRun({
    projectRunId,
    stepId,
    stepType: params.stepType,
    phase: params.phase,
    agentSessionId: session.id,
    functionModule: params.functionModule,
    instruction: params.instruction,
    expectedOutcome: params.expectedOutcome,
    stepSnapshot: {
      stepId,
      title: params.title,
      toolId: `agent:${params.stepType}`,
      toolVersion: '1.0',
      params: {},
      dependsOn: [],
      onFailure: 'continue',
      position: 0,
      clauseId: null,
      agentStep: true,
    },
  });
  deps.repos.projects.updateStepRun(sr.id, {
    status: 'running',
    startedAt: nowIso(),
    percent: 0,
  });
  deps.repos.agent.setCurrentStep(session.id, sr.id);
  const started = deps.repos.projects.getStepRun(sr.id)!;
  ctx.emit({ type: 'tool_call', stepRunId: sr.id, toolName: `step:${params.stepType}`, toolArgs: { title: params.title } });
  ctx.forward({
    event: 'agent:step_started',
    sessionId: session.id,
    stepRunId: sr.id,
    stepType: params.stepType,
    phase: params.phase,
    title: params.title,
    seq: 0,
  });
  return started;
}

export function finalizeStepRun(
  ctx: AgentToolContext,
  stepRunId: string,
  status: StepRun['status'],
  extra: { percent?: number; error?: { code: string; message: string } } = {},
): void {
  ctx.deps.repos.projects.updateStepRun(stepRunId, {
    status,
    finishedAt: nowIso(),
    percent: extra.percent ?? 100,
    error: extra.error,
  });
}

export async function writeStepLog(
  stepRunId: string,
  kind: 'stdout' | 'stderr',
  content: string,
): Promise<string> {
  const dir = path.join(config.filesDir, 'evidence');
  await mkdir(dir, { recursive: true });
  const fileRef = path.join(dir, `${stepRunId}.${kind}.log`);
  await writeFile(fileRef, content, 'utf8');
  return fileRef;
}

export function toolError(message: string, data?: unknown): ToolResult {
  return { content: `错误: ${message}`, data, isError: true };
}
