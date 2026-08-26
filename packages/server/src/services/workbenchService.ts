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
 * nextSuggestion 的字段口径对齐 docs/ux-redesign-plan.md §4.3 的 8 级优先级
 * 规则表：服务端按同表求值并给出主建议；前端 useNextAction 仅作回退。
 *
 * 约束：只复用现有 repository 查询（只读），不新增表、不改现有端点行为。
 */

/**
 * 服务端可推导的下一步动作。编号对应 §4.3 规则表的优先级行：
 * R1 monitor_run / R2 handle_human_todos / R3 review_verdicts /
 * R4 generate_report / R5 export_report / R6 fix_preflight /
 * R7 start_run / R8 agent_or_config。
 */
export type WorkbenchNextAction =
  | 'monitor_run' // R1 存在进行中的执行（模板 run 非终态，或 agent 会话活跃）
  | 'handle_human_todos' // R2 本项目有未完成人工步骤
  | 'review_verdicts' // R3 有 pending_review 判定草案
  | 'generate_report' // R4 最新 run 已终态但报告缺失/过期
  | 'export_report' // R5 报告未导出 —— 服务端无导出标记（schema 限制），当前不会返回
  | 'fix_preflight' // R6 预检有缺口（缺必填变量/工具缺口）
  | 'start_run' // R7 无 run 且模板就绪
  | 'agent_or_config'; // R8 兜底：发起 Agent 会话 / 配置变量

/** §4.3 规则行号（1..8）。 */
export type WorkbenchPriority = 1 | 2 | 3 | 4 | 6 | 7 | 8;

export interface WorkbenchSuggestion {
  /** 命中的规则优先级（1..8，见 docs/ux-redesign-plan.md §4.3）；5 由服务端保留但不产出。 */
  priority: WorkbenchPriority;
  action: WorkbenchNextAction;
  /** 主按钮文案（已含计数/百分比等动态片段，可直接渲染）。 */
  title: string;
  /** 一句话说明为什么给出这个建议（副标题/tooltip）。 */
  reason: string;
  /** R1：目标 run（模板编排触发时）。 */
  runId?: string;
  /** R1：run 进度百分比（仅 run 目标时存在；agent 会话目标时缺省）。 */
  percent?: number;
  /** R1（agent 会话目标）/ R2：目标会话 id。 */
  sessionId?: string;
  /** R2：第一条待处理人工步骤的 stepRunId（用于高亮卡片）。 */
  todoStepRunId?: string;
  /** R3：待审核判定数量。 */
  verdictCount?: number;
  /** R3：首条待审核判定 id。 */
  verdictId?: string;
  /** R4/R5：相关报告 id（R4 报告缺失时不带）。 */
  reportId?: string;
  /** R6：预检缺口总数（缺失必填变量数 + 工具缺口数）。 */
  gapCount?: number;
  /** R6：缺失的必填变量名列表（可为空数组——缺口全部来自工具时）。 */
  missingVariables?: string[];
  /** R6/R7：项目绑定的模板 id。 */
  templateId?: string;
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

const TERMINAL_RUN_STATUSES = new Set(['success', 'fail', 'partial', 'cancelled']);
const ACTIVE_SESSION_STATUSES = new Set(['planning', 'running', 'waiting_confirm', 'review']);

/** R6 预检缺口的廉价只读估算（不发健康检查命令）。 */
interface PreflightGaps {
  count: number;
  missingVariables: string[];
}

/**
 * 纯函数：按 docs/ux-redesign-plan.md §4.3 的 8 级优先级规则表推导下一步建议，
 * 取第一个命中的规则。
 *
 * 服务端口径说明（相对前端回退表的两点细化，均已与计划文档语义一致）：
 * - R1 的「非终态 run」按**有效执行**判定：agent 触发的 project_runs 行在会话
 *   结束后不会被收尾（orchestrator 才写 run 状态），因此其是否“进行中”以绑定
 *   会话状态为准（planning|running|waiting_confirm|review 视为进行中；
 *   waiting_human 交由 R2/R8 处理）。
 * - R5 需要报告上的「未导出」标记，reports 表无该列且禁止改 schema，故服务端
 *   不产出 export_report，该规则仅在前端回退路径生效。
 */
export function deriveNextSuggestion(input: {
  runs: Array<
    Pick<ProjectRun, 'id' | 'status' | 'triggerMode' | 'progressPercent' | 'startedAt' | 'finishedAt'>
  >;
  sessions: Array<Pick<AgentSession, 'id' | 'status' | 'phase'>>;
  humanTodos: WorkbenchHumanTodo[];
  verdictDrafts: Array<Pick<ClauseVerdict, 'id'>>;
  latestReport: Pick<Report, 'id' | 'generatedAt'> | null;
  /** null 表示项目未绑定有效模板（R6/R7 直接跳过）。 */
  preflightGaps: PreflightGaps | null;
  /** 项目绑定的模板 id（R6/R7 回填到建议里；无模板时传 null）。 */
  templateId: string | null;
}): WorkbenchSuggestion {
  const { runs, sessions, humanTodos, verdictDrafts, latestReport, preflightGaps, templateId } = input;

  // R1 存在进行中的执行 → 跳执行采集 Tab / 会话页
  const runningTemplateRun = runs.find(
    (r) => r.triggerMode !== 'agent' && !TERMINAL_RUN_STATUSES.has(r.status),
  );
  const activeSession = sessions.find((s) => ACTIVE_SESSION_STATUSES.has(s.status));
  if (runningTemplateRun || activeSession) {
    if (runningTemplateRun) {
      const percent = Number(runningTemplateRun.progressPercent ?? 0);
      return {
        priority: 1,
        action: 'monitor_run',
        title: `运行中 · ${percent}%`,
        reason: '存在非终态的测试运行，可查看实时进度或取消。',
        runId: runningTemplateRun.id,
        percent,
      };
    }
    return {
      priority: 1,
      action: 'monitor_run',
      title: 'Agent 会话进行中',
      reason: `会话仍在执行（${activeSession!.status}/${activeSession!.phase}），去会话页查看或继续对话。`,
      sessionId: activeSession!.id,
    };
  }

  // R2 本项目有未完成人工步骤 → 跳会话并高亮卡片
  if (humanTodos.length > 0) {
    return {
      priority: 2,
      action: 'handle_human_todos',
      title: `${humanTodos.length} 个人工步骤等你处理`,
      reason: '会话正在等待人工结果，处理后会自动恢复执行。',
      sessionId: humanTodos[0].sessionId,
      todoStepRunId: humanTodos[0].stepRunId,
    };
  }

  // R3 有待审核判定草案 → 跳判定审核视图
  if (verdictDrafts.length > 0) {
    return {
      priority: 3,
      action: 'review_verdicts',
      title: `${verdictDrafts.length} 条判定待你审核`,
      reason: '确认后判定才会计入合规评分。',
      verdictCount: verdictDrafts.length,
      verdictId: verdictDrafts[0].id,
    };
  }

  // R4 最新 run 已终态且报告缺失/过期 → 生成合规报告
  const latestRun = runs[0];
  if (
    latestRun &&
    TERMINAL_RUN_STATUSES.has(latestRun.status) &&
    (!latestReport ||
      latestReport.generatedAt < (latestRun.finishedAt ?? latestRun.startedAt ?? ''))
  ) {
    return {
      priority: 4,
      action: 'generate_report',
      title: '生成合规报告',
      reason: latestReport
        ? '最近一次运行晚于现有报告，报告已过期，请重新生成。'
        : '运行已完成，还没有生成合规报告。',
      runId: latestRun.id,
    };
  }

  // R5（export_report）需要报告导出标记，服务端 schema 无此状态，跳过；
  // 该规则仅存在于前端回退路径。

  // R6 预检有缺口 → 打开预检 / 变量配置
  if (preflightGaps && preflightGaps.count > 0) {
    return {
      priority: 6,
      action: 'fix_preflight',
      title: `修复预检问题（${preflightGaps.count}）`,
      reason:
        preflightGaps.missingVariables.length > 0
          ? `还有必填变量未填写：${preflightGaps.missingVariables.join('、')}。`
          : '部分工具不可用或缺失，先修复再开始测试。',
      gapCount: preflightGaps.count,
      missingVariables: preflightGaps.missingVariables,
      templateId: templateId ?? undefined,
    };
  }

  // R7 无 run 且模板就绪 → 开始测试
  if (preflightGaps && runs.length === 0) {
    return {
      priority: 7,
      action: 'start_run',
      title: '开始测试',
      reason: '预检就绪且尚未运行过，可直接发起一次编排运行。',
      templateId: templateId ?? undefined,
    };
  }

  // R8 兜底：发起 Agent 会话 / 配置变量
  return {
    priority: 8,
    action: 'agent_or_config',
    title: '发起 Agent 会话 / 配置变量',
    reason: allSessionsEnded(sessions)
      ? '现有执行均已结束且没有可生成的报告，可发起新一轮评估。'
      : '当前没有需要处理的进行中事项，可发起 Agent 会话或完善项目变量。',
  };
}

function allSessionsEnded(sessions: Array<{ status: string }>): boolean {
  const terminal = new Set(['done', 'aborted', 'error']);
  return sessions.length > 0 && sessions.every((s) => terminal.has(s.status));
}

/**
 * R6/R7 所需的模板预检缺口（廉价版）：只读 template.variables 与 tools 表里
 * 已存的健康状态，**不执行**任何健康检查命令（区别于 GET /preflight 的完整版）。
 * 项目没有有效模板时返回 null（R6/R7 跳过）。
 */
function computePreflightGaps(repos: Repositories, project: Project): PreflightGaps | null {
  const template = repos.templates.getById(project.templateId);
  if (!template) return null;
  const values = (project.variables ?? {}) as Record<string, unknown>;
  const isEmpty = (v: unknown) => v === undefined || v === null || v === '';
  const missingVariables = template.variables
    .filter((v) => v.required && isEmpty(values[v.name]))
    .map((v) => v.name);
  let toolGaps = 0;
  for (const step of template.steps) {
    const tool = repos.tools.getById(step.toolId);
    if (!tool || tool.healthStatus === 'red') toolGaps += 1;
  }
  return { count: missingVariables.length + toolGaps, missingVariables };
}

/**
 * 组装项目工作台聚合数据。只读；全部走现有 repository 查询。
 * 项目不存在时抛 404（AppError 9004）。
 */
export function buildWorkbench(repos: Repositories, projectId: string): WorkbenchPayload {
  const project = repos.projects.getById(projectId);
  if (!project) throw Errors.notFound('项目', projectId);

  const runs = repos.projects.listRuns(projectId); // startedAt DESC
  const latestRun = runs[0] ?? null;
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

  const suggestion = deriveNextSuggestion({
    runs,
    sessions,
    humanTodos,
    verdictDrafts,
    latestReport,
    preflightGaps: computePreflightGaps(repos, project),
    templateId: project.templateId ?? null,
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
    nextSuggestion: suggestion,
  };
}
