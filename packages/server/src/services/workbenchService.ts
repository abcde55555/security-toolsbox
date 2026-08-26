import type { AgentSession, ClauseVerdict, Project, ProjectRun, Report } from '@en18031/shared';
import type { Repositories } from '../repositories/index.js';
import { Errors } from './errors.js';

/**
 * 项目工作台（Project Workbench）聚合查询。
 *
 * 目标：前端“项目工作台”一屏只需要 GET /api/projects/:id/workbench 一次请求，
 * 即可拿到项目、最新运行、会话列表、人工待办、待审核判定草案、证据数量，
 * 以及由服务端根据项目状态推导出的 nextSuggestion（下一步建议）。
 *
 * 约束：只复用现有 repository 查询，不新增表、不改现有端点行为。
 */

/** 服务端可推导的下一步动作。 */
export type WorkbenchNextAction =
  | 'create_session' // 无会话 → 创建会话
  | 'handle_human_todos' // waiting_human / 有人工步骤未完成 → 处理待办
  | 'follow_session' // 会话进行中 → 去会话页跟进
  | 'review_verdicts' // 有 pending_review 判定草案 → 去审核
  | 'view_report'; // 已完成 → 查看/生成报告

export interface WorkbenchSuggestion {
  action: WorkbenchNextAction;
  /** 面向用户的标题（可直接作为工作台主按钮文案）。 */
  title: string;
  /** 一句话说明为什么给出这个建议。 */
  reason: string;
  /** action 相关的目标会话（handle_human_todos / follow_session 时存在）。 */
  sessionId?: string;
  /** 第一条待处理人工步骤的 stepRunId（handle_human_todos 时存在）。 */
  todoStepRunId?: string;
  /** 第一条待审核判定 id（review_verdicts 时存在）。 */
  verdictId?: string;
  /** 最新报告 id（view_report 且已有报告时存在）。 */
  reportId?: string;
}

export interface WorkbenchHumanTodo {
  stepRunId: string;
  sessionId: string;
  sessionName: string;
  instruction: string;
  phase: string | null;
  updatedAt: string;
}

/** 会话 + 该会话当前未完成人工步骤数（含状态/阶段，AgentSession 本身就有 status/phase）。 */
export type WorkbenchSession = AgentSession & { pendingHumanStepCount: number };

export interface WorkbenchPayload {
  project: Project;
  latestRun: ProjectRun | null;
  sessions: WorkbenchSession[];
  humanTodos: WorkbenchHumanTodo[];
  verdictDrafts: ClauseVerdict[];
  evidenceCount: number;
  latestReport: Report | null;
  nextSuggestion: WorkbenchSuggestion;
}

const ACTIVE_SESSION_STATUSES = new Set(['planning', 'running', 'waiting_confirm', 'review']);
const TERMINAL_SESSION_STATUSES = new Set(['done', 'aborted', 'error']);

/**
 * 纯函数：根据项目当前状态推导下一步建议。
 *
 * 优先级（高→低，与产品约定一致）：
 * 1. 无会话                → create_session
 * 2. waiting_human/有人工待办 → handle_human_todos
 * 3. 有进行中的会话          → follow_session
 * 4. 有判定草案             → review_verdicts
 * 5. 有完成会话或已有报告     → view_report
 * 6. 兜底                   → create_session
 */
export function deriveNextSuggestion(input: {
  sessions: Array<Pick<AgentSession, 'id' | 'status' | 'phase'>>;
  humanTodos: WorkbenchHumanTodo[];
  verdictDrafts: Array<Pick<ClauseVerdict, 'id' | 'clauseId'>>;
  latestReport: Pick<Report, 'id' | 'grade'> | null;
}): WorkbenchSuggestion {
  const { sessions, humanTodos, verdictDrafts, latestReport } = input;

  // 1) 无会话 → 创建会话
  if (sessions.length === 0) {
    return {
      action: 'create_session',
      title: '创建 Agent 会话',
      reason: '该项目还没有任何 Agent 会话，创建一个会话即可开始评估。',
    };
  }

  // 2) waiting_human 或存在未完成人工步骤 → 处理待办
  const waiting = sessions.find((s) => s.status === 'waiting_human');
  if (humanTodos.length > 0 || waiting) {
    const firstTodo = humanTodos[0];
    return {
      action: 'handle_human_todos',
      title: '处理人工待办',
      reason:
        humanTodos.length > 0
          ? `有 ${humanTodos.length} 个人工步骤等待你处理，会话正在等待结果。`
          : '会话处于等待人工处理状态。',
      sessionId: firstTodo?.sessionId ?? waiting?.id,
      todoStepRunId: firstTodo?.stepRunId,
    };
  }

  // 3) 有进行中的会话 → 跟进
  const active = sessions.find((s) => ACTIVE_SESSION_STATUSES.has(s.status));
  if (active) {
    return {
      action: 'follow_session',
      title: '跟进运行中的会话',
      reason: `会话仍在进行中（${active.status}/${active.phase}），去会话页查看进展或继续对话。`,
      sessionId: active.id,
    };
  }

  // 4) 有判定草案 → 审核
  if (verdictDrafts.length > 0) {
    return {
      action: 'review_verdicts',
      title: '审核判定草案',
      reason: `有 ${verdictDrafts.length} 条 AI 判定草案待人工确认，确认后才会计入合规评分。`,
      verdictId: verdictDrafts[0].id,
    };
  }

  // 5) 已完成（有 done 会话或已有报告）→ 查看报告
  if (latestReport || sessions.some((s) => s.status === 'done')) {
    return {
      action: 'view_report',
      title: latestReport ? '查看评估报告' : '生成并查看评估报告',
      reason: latestReport
        ? `最新报告已生成（评级 ${latestReport.grade}），可以查看详情。`
        : '所有会话已完成，可生成评估报告并查看结论。',
      reportId: latestReport?.id,
    };
  }

  // 6) 兜底：只剩 aborted/error 的历史会话且无报告 → 新开会话重评
  const allTerminal = sessions.every((s) => TERMINAL_SESSION_STATUSES.has(s.status));
  return {
    action: 'create_session',
    title: '新建 Agent 会话',
    reason: allTerminal
      ? '现有会话均已结束且没有可用报告，可新建一个会话重新评估。'
      : '当前没有需要处理的进行中事项，可新建会话开始评估。',
  };
}

/**
 * 组装项目工作台聚合数据。只读；全部走现有 repository 查询。
 * 项目不存在时抛 404（AppError 9004）。
 */
export function buildWorkbench(repos: Repositories, projectId: string): WorkbenchPayload {
  const project = repos.projects.getById(projectId);
  if (!project) throw Errors.notFound('项目', projectId);

  const latestRun = repos.projects.latestRun(projectId);
  const sessions = repos.agent.listSessions({ projectId }).items;
  const sessionIds = new Set(sessions.map((s) => s.id));

  // 全局待办列表按项目过滤（该 SQL 已限定 human_instruction + running + 活跃会话）
  const humanTodos = repos.projects
    .listPendingHumanSteps()
    .filter((t) => sessionIds.has(t.sessionId));

  const perSessionTodoCount = new Map<string, number>();
  for (const t of humanTodos) {
    perSessionTodoCount.set(t.sessionId, (perSessionTodoCount.get(t.sessionId) ?? 0) + 1);
  }

  const verdictDrafts = repos.results.listPendingReviewVerdictsByProject(projectId);
  const evidenceCount = repos.results.countByProject(projectId);
  const latestReport = repos.reports.latest(projectId);

  const nextSuggestion = deriveNextSuggestion({
    sessions,
    humanTodos,
    verdictDrafts,
    latestReport,
  });

  return {
    project,
    latestRun,
    sessions: sessions.map((s) => ({
      ...s,
      pendingHumanStepCount: perSessionTodoCount.get(s.id) ?? 0,
    })),
    humanTodos,
    verdictDrafts,
    evidenceCount,
    latestReport,
    nextSuggestion,
  };
}
