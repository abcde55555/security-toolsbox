import type { Artifact } from '@en18031/shared';
import type { AgentToolContext, ToolResult } from '../agentContext.js';
import { startAgentStepRun, finalizeStepRun, toolError } from './common.js';

interface WriteArtifactArgs {
  type: Artifact['type'];
  title?: string;
  content?: string;
  fileRefs?: string[];
  functionModule?: string;
}

interface ReadArtifactArgs {
  type?: Artifact['type'];
}

export async function writeArtifact(ctx: AgentToolContext, args: WriteArtifactArgs): Promise<ToolResult> {
  if (!args.type) return toolError('缺少 type 参数');
  const phase = ctx.session.phase;
  const sr = startAgentStepRun(ctx, {
    stepType: 'evidence_attach',
    phase,
    title: `写入工件: ${args.title ?? args.type}`,
    functionModule: args.functionModule,
  });
  const artifact = ctx.deps.repos.artifacts.create({
    projectId: ctx.session.projectId,
    projectRunId: ctx.projectRunId,
    agentSessionId: ctx.session.id,
    type: args.type,
    title: args.title,
    content: args.content,
    fileRefs: args.fileRefs ?? [],
    functionModule: args.functionModule,
    createdBy: ctx.deps.userId,
  });
  ctx.deps.repos.projects.updateStepRun(sr.id, { artifacts: [artifact.id] });
  finalizeStepRun(ctx, sr.id, 'success');
  ctx.forward({ event: 'agent:artifact_written', sessionId: ctx.session.id, artifact });
  ctx.deps.repos.audit.insert({
    userId: ctx.deps.userId,
    action: 'agent.artifact_write',
    entityType: 'artifact',
    entityId: artifact.id,
    after: { type: args.type, title: args.title },
  });
  return {
    content: `工件已保存 (id=${artifact.id}, type=${args.type})`,
    artifact,
    stepRun: sr,
  };
}

export async function readArtifact(ctx: AgentToolContext, args: ReadArtifactArgs): Promise<ToolResult> {
  const all = ctx.deps.repos.artifacts.listBySession(ctx.session.id);
  const filtered = args.type ? all.filter((a) => a.type === args.type) : all;
  return {
    content: JSON.stringify(
      filtered.map((a) => ({ id: a.id, type: a.type, title: a.title, content: a.content, fileRefs: a.fileRefs })),
      null,
      2,
    ),
    data: filtered,
  };
}
