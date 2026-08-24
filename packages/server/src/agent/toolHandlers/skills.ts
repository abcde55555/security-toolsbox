import type { AgentToolContext } from '../agentContext.js';
import type { ToolResult } from '../agentContext.js';
import { notify } from '../../services/notificationService.js';

/**
 * search_skills: let the planner consult previously sedimented experience.
 * Only current-version skills in draft/approved state are searchable —
 * archived knowledge should not steer new sessions.
 */
export async function searchSkills(ctx: AgentToolContext, args: { keyword?: string }): Promise<ToolResult> {
  const { items } = ctx.deps.repos.skills.list({ keyword: args.keyword, status: undefined });
  const usable = items.filter((s) => s.status !== 'archived').slice(0, 10);
  if (usable.length === 0) {
    return {
      content: JSON.stringify({ skills: [], note: '技能库中没有匹配的经验条目' }),
      data: { skills: [] },
    };
  }
  return {
    content: JSON.stringify({
      skills: usable.map((s) => ({
        skillKey: s.skillKey,
        title: s.title,
        status: s.status,
        whenToUse: (s.frontmatter as { whenToUse?: string }).whenToUse ?? '',
        body: s.body.slice(0, 1200),
      })),
    }),
    data: { count: usable.length },
  };
}

/**
 * propose_skill: non-blocking sedimentation proposal. The AI does NOT write
 * into the skill library directly — it raises a notification that a human
 * accepts (compiling it into a draft Skill) or dismisses.
 */
export async function proposeSkill(
  ctx: AgentToolContext,
  args: { title?: string; summary?: string; body?: string; sourceNoteIds?: string[] },
): Promise<ToolResult> {
  const title = (args.title ?? '').trim();
  if (!title) {
    return { content: '错误: 缺少必填参数 title', isError: true };
  }
  const summary = (args.summary ?? '').trim();
  if (!summary && !(args.body ?? '').trim()) {
    return { content: '错误: summary 与 body 至少提供其一', isError: true };
  }
  const notification = notify(ctx.deps.repos, ctx.bus, {
    type: 'skill_sediment',
    title,
    message: summary,
    reason: summary,
    payload: {
      title,
      summary,
      body: args.body ?? summary,
      sourceNoteIds: Array.isArray(args.sourceNoteIds) ? args.sourceNoteIds : [],
    },
    sessionId: ctx.session.id,
    projectId: ctx.session.projectId,
    createdBy: ctx.deps.userId ?? 'agent',
  });
  return {
    content: JSON.stringify({
      ok: true,
      notificationId: notification.id,
      note: '已向工程师发送沉淀建议（非阻塞），采纳后将生成草稿技能。',
    }),
    data: { notificationId: notification.id },
  };
}
