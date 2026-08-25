import type { ClauseVerdict, Severity } from '@en18031/shared';
import { assertCanCreateVerdict } from '../phaseMachine.js';
import type { AgentToolContext, ToolResult } from '../agentContext.js';
import { startAgentStepRun, finalizeStepRun, toolError } from './common.js';

interface CreateVerdictArgs {
  clauseId: string;
  evidenceRefs?: string[];
  comment?: string;
}

const SEV_RANK: Record<Severity, number> = { high: 3, middle: 2, low: 1 };

/**
 * create_verdict: submit a verdict DRAFT. The model only supplies clauseId,
 * evidenceRefs and a comment; pass/severity are computed deterministically from
 * the referenced evidence so the AI cannot grade the device itself. Drafts are
 * persisted as pending_review and only enter compliance grading after a human
 * approves them (ReportService filters on reviewStatus='approved').
 */
export async function createVerdict(ctx: AgentToolContext, args: CreateVerdictArgs): Promise<ToolResult> {
  if (!args.clauseId) return toolError('缺少 clauseId 参数');
  const { session, deps, projectRunId } = ctx;

  try {
    assertCanCreateVerdict(session.phase);
  } catch (err) {
    return toolError((err as Error).message);
  }

  if (!session.selectedClauses.includes(args.clauseId)) {
    return toolError(`条款 ${args.clauseId} 不在本次会话选定范围内`);
  }

  const project = deps.repos.projects.getById(session.projectId);
  if (!project) return toolError('项目不存在');
  const clause = deps.repos.clauses.get(project.standardVersion, args.clauseId);
  if (!clause) return toolError(`条款不存在: ${args.clauseId}`);

  // 叶子条款软校验：章节父项（有子项）的判定不会计入合规定级报告。
  // 不硬拒绝——父项结论可作为审计留痕，但明确告知模型应改投叶子条款。
  const childCount = deps.repos.clauses
    .list(project.standardVersion)
    .filter((c) => c.parentId === args.clauseId).length;
  const parentWarning =
    childCount > 0
      ? ` 注意：条款 ${args.clauseId} 是章节父项（含 ${childCount} 个子项），本判定不会计入合规报告的通过率统计；请为叶子条款（如 ${args.clauseId}-x）另行提交判定。`
      : '';

  const evidenceRefs = args.evidenceRefs ?? [];
  // Validate evidence ownership and collect severities / failure signals.
  const allEvidence = deps.repos.results
    .listEvidenceByRun(projectRunId)
    .filter((e) => evidenceRefs.includes(e.id));
  if (allEvidence.length !== evidenceRefs.length) {
    const found = new Set(allEvidence.map((e) => e.id));
    const missing = evidenceRefs.filter((id) => !found.has(id));
    return toolError(`证据不存在或不属于本会话: ${missing.join(', ')}`);
  }

  // Deterministic verdict: any validation_error evidence -> fail; otherwise pass.
  // Severity is the worst severity among the referenced evidence, defaulting to
  // the clause's default severity. The AI comment is appended to the reason but
  // never determines pass/fail.
  const failures = allEvidence.filter((e) => e.type === 'validation_error');
  const pass = failures.length === 0;
  let severity: Severity = clause.defaultSeverity;
  for (const e of allEvidence) {
    if (SEV_RANK[e.severity] > SEV_RANK[severity]) severity = e.severity;
  }
  const reasonParts: string[] = [];
  reasonParts.push(
    pass
      ? `所引用证据未发现不符合项（${allEvidence.length} 条证据）`
      : `发现 ${failures.length} 条不符合证据: ${failures.map((f) => f.content.slice(0, 80)).join('; ')}`,
  );
  if (args.comment) reasonParts.push(`AI 备注: ${args.comment}`);
  const reason = reasonParts.join('\n');

  const sr = startAgentStepRun(ctx, {
    stepType: 'analysis',
    phase: 'adjudication',
    title: `判定草案: ${args.clauseId}`,
  });

  let verdict: ClauseVerdict;
  try {
    verdict = deps.repos.results.insertVerdict({
      stepRunId: sr.id,
      projectRunId,
      projectId: session.projectId,
      clauseId: args.clauseId,
      pass,
      severity,
      reason,
      evidenceRefs,
      verdictGroup: `agent:${session.id}:${args.clauseId}`,
      reviewStatus: 'pending_review',
      aiGenerated: true,
    });
  } catch (err) {
    finalizeStepRun(ctx, sr.id, 'fail', { error: { code: 'VERDICT_REJECTED', message: (err as Error).message } });
    return toolError(`判定被阶段边界触发器拒绝: ${(err as Error).message}`);
  }

  deps.repos.projects.updateStepRun(sr.id, { verdictCount: 1 });
  finalizeStepRun(ctx, sr.id, 'success');

  ctx.emit({
    type: 'verdict_draft',
    stepRunId: sr.id,
    content: JSON.stringify({ clauseId: args.clauseId, pass, severity }),
    toolStatus: 'pending_review',
  });
  ctx.forward({ event: 'agent:verdict_drafted', sessionId: session.id, verdict });
  deps.repos.audit.insert({
    userId: deps.userId,
    action: 'agent.verdict_draft',
    entityType: 'clause_verdict',
    entityId: verdict.id,
    after: { clauseId: args.clauseId, pass, severity, reviewStatus: 'pending_review' },
  });

  return {
    content: JSON.stringify(
      {
        verdictId: verdict.id,
        clauseId: args.clauseId,
        pass,
        severity,
        reviewStatus: 'pending_review',
        reason,
        ...(parentWarning ? { warning: parentWarning.trim() } : {}),
      },
      null,
      2,
    ),
    verdict,
    stepRun: sr,
  };
}
