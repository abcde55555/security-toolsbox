import type { AgentToolContext, ToolResult } from '../agentContext.js';

/** list_clauses: return the selected clauses for this session (with title/method). */
export async function listClauses(ctx: AgentToolContext): Promise<ToolResult> {
  const { repos } = ctx.deps;
  const project = repos.projects.getById(ctx.session.projectId);
  if (!project) return { content: '错误: 项目不存在', isError: true };
  const ids = ctx.session.selectedClauses;
  const clauses = ids
    .map((id) => repos.clauses.get(project.standardVersion, id))
    .filter((c): c is NonNullable<typeof c> => !!c);
  return {
    content: JSON.stringify(
      clauses.map((c) => ({
        clauseId: c.clauseId,
        chapter: c.chapter,
        title: c.title,
        level: c.level,
        defaultSeverity: c.defaultSeverity,
        testingMethod: c.testingMethod ?? '',
      })),
      null,
      2,
    ),
    data: clauses,
  };
}
