import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WorkbenchApi,
  type WorkbenchPayload,
  type WorkbenchSuggestion,
} from '../api/endpoints';
import { ProjectsApi, AgentApi, ReportsApi } from '../api/endpoints';
import { isTerminalStatus } from '../utils/ui';

/**
 * useNextAction —— 「现在该干什么」的统一数据源（蓝图 §4.3）。
 *
 * 主路径：GET /projects/:id/workbench 的服务端 nextSuggestion（api-eng 口径）。
 * 回退路径：端点失败/字段缺失时，用现有接口拼装最小输入，走客户端 8 级规则表
 * （deriveNextAction 纯函数，便于单测与作为服务端推导的对齐基准）。
 */

/** UI 层归一化的动作种类（含客户端规则表特有的 follow_run/start_run 等）。 */
export type NextActionKind =
  | 'follow_run' // 规则1：非终态 run → 执行采集 Tab
  | 'handle_human_todos' // 规则2 / 服务端同名
  | 'review_verdicts' // 规则3 / 服务端同名
  | 'generate_report' // 规则4 / 服务端 view_report 且无报告
  | 'view_report' // 规则5 / 服务端 view_report 且有报告
  | 'fix_preflight' // 规则6
  | 'start_run' // 规则7
  | 'follow_session' // 服务端 follow_session
  | 'configure_vars' // 规则8 兜底·无模板
  | 'create_session'; // 规则8 兜底 / 服务端 create_session

export interface NextAction {
  kind: NextActionKind;
  /** 主按钮文案（一句话说明现在该干什么） */
  title: string;
  /** 副标题：为什么 */
  reason?: string;
  sessionId?: string;
  todoStepRunId?: string;
  verdictId?: string;
  reportId?: string;
  /** follow_run / generate_report 关联的运行 id（来自服务端 R1/R4） */
  runId?: string;
  /** follow_run 时的进度百分比 */
  percent?: number;
}

/** 客户端 8 级规则表的输入快照（全部来自现有接口字段）。 */
export interface NextActionInput {
  activeRunStatus?: string | null;
  runProgress?: number;
  humanTodoCount: number;
  pendingVerdictCount: number;
  hasReport: boolean;
  preflightIssueCount: number;
  hasTemplate: boolean;
  hasAnyRun: boolean;
  sessionCount: number;
}

/**
 * 蓝图 §4.3 前端回退规则表：按优先级取第一个命中。
 * 1 非终态 run → 2 人工待办 → 3 待审判定 → 4 报告缺失 → 5 报告导出/查看
 * → 6 预检缺口 → 7 可开始测试 → 8 兜底。
 */
export function deriveNextAction(input: NextActionInput): NextAction {
  const running = !!input.activeRunStatus && !isTerminalStatus(input.activeRunStatus);
  // 1 存在非终态 run
  if (running) {
    const pct = Math.round(input.runProgress ?? 0);
    return { kind: 'follow_run', title: `运行中 · ${pct}%`, reason: '编排运行进行中，去执行采集查看进度。', percent: pct };
  }
  // 2 人工待办
  if (input.humanTodoCount > 0) {
    return {
      kind: 'handle_human_todos',
      title: `${input.humanTodoCount} 个人工步骤等你处理`,
      reason: 'Agent 正在等待这些步骤的结果，处理后才会继续。',
    };
  }
  // 3 待审判定
  if (input.pendingVerdictCount > 0) {
    return {
      kind: 'review_verdicts',
      title: `${input.pendingVerdictCount} 条判定待你审核`,
      reason: 'AI 判定草案需人工确认后才会计入合规评分。',
    };
  }
  // 4 run 终态且报告缺失
  if (input.activeRunStatus && isTerminalStatus(input.activeRunStatus) && !input.hasReport) {
    return { kind: 'generate_report', title: '生成合规报告', reason: '最近一次运行已结束，可生成合规报告查看结论。' };
  }
  // 5 报告存在 → 查看（「未导出标记」暂无独立字段，合并为查看入口；导出在报告 Tab 内）
  if (input.hasReport) {
    return { kind: 'view_report', title: '查看合规报告', reason: '最新报告已生成，可查看详情或导出 Excel。' };
  }
  // 6 预检缺口
  if (input.preflightIssueCount > 0) {
    return { kind: 'fix_preflight', title: `修复预检问题（${input.preflightIssueCount}）`, reason: '存在影响测试执行的配置问题，先修复再开始。' };
  }
  // 7 无 run 且有模板
  if (!input.hasAnyRun && input.hasTemplate) {
    return { kind: 'start_run', title: '开始测试', reason: '项目已就绪，通过预检后即可开始第一次编排运行。' };
  }
  // 8 兜底
  if (!input.hasTemplate) {
    return { kind: 'configure_vars', title: '完善项目配置', reason: '请确认已绑定模板并补齐设备变量后再开始评估。' };
  }
  return { kind: 'create_session', title: '发起 Agent 会话', reason: '当前没有需要处理的进行中事项，可发起会话做深度测试。' };
}

/**
 * 服务端 nextSuggestion → 归一化 NextAction。
 * 服务端 action 口径（workbenchService）映射到 UI 动作：
 * - monitor_run + runId → follow_run（执行采集 Tab）；monitor_run + sessionId → follow_session
 * - export_report（服务端保留不产出）→ view_report
 * - agent_or_config（R8 兜底）→ 按项目是否绑定模板拆为 configure_vars / create_session
 */
export function normalizeServerSuggestion(
  s: WorkbenchSuggestion,
  projectTemplateId?: string,
): NextAction {
  const base = {
    title: s.title,
    reason: s.reason,
    sessionId: s.sessionId,
    todoStepRunId: s.todoStepRunId,
    verdictId: s.verdictId,
    reportId: s.reportId,
    runId: s.runId,
  };
  switch (s.action) {
    case 'monitor_run':
      if (s.runId) return { ...base, kind: 'follow_run', percent: s.percent };
      return { ...base, kind: 'follow_session' };
    case 'export_report':
      return { ...base, kind: 'view_report' };
    case 'agent_or_config':
      return projectTemplateId
        ? { ...base, kind: 'create_session' }
        : { ...base, kind: 'configure_vars', title: base.title || '完善项目配置' };
    case 'handle_human_todos':
      return { ...base, kind: 'handle_human_todos' };
    case 'review_verdicts':
      return { ...base, kind: 'review_verdicts' };
    case 'generate_report':
      return { ...base, kind: 'generate_report' };
    case 'fix_preflight':
      return { ...base, kind: 'fix_preflight' };
    case 'start_run':
      return { ...base, kind: 'start_run' };
    default:
      return { ...base, kind: 'create_session' };
  }
}

/** OverviewTab/Stepper 用：动作 → 项目工作台的目标步进（vars|flow|agent|review|report）。 */
export function actionToStepKey(kind: NextActionKind): 'vars' | 'flow' | 'agent' | 'review' | 'report' {
  switch (kind) {
    case 'follow_run':
    case 'start_run':
      return 'flow';
    case 'handle_human_todos':
    case 'follow_session':
    case 'create_session':
      return 'agent';
    case 'review_verdicts':
      return 'review';
    case 'generate_report':
    case 'view_report':
      return 'report';
    case 'fix_preflight':
    case 'configure_vars':
    default:
      return 'vars';
  }
}

export interface UseNextActionResult {
  loading: boolean;
  /** 'server' = workbench 端点；'client' = 本地规则回退；null = 尚无结果 */
  source: 'server' | 'client' | null;
  /** 聚合数据（回退路径下部分字段可能缺失：evidenceCount=-1 表示未知） */
  payload: WorkbenchView | null;
  next: NextAction | null;
  refresh: () => void;
}

/** hook 对外暴露的聚合视图：nextSuggestion 已被归一化为 next，不重复暴露。 */
export type WorkbenchView = Omit<WorkbenchPayload, 'nextSuggestion'>;

export function useNextAction(projectId: string): UseNextActionResult {
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'server' | 'client' | null>(null);
  const [payload, setPayload] = useState<WorkbenchView | null>(null);
  const [next, setNext] = useState<NextAction | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!projectId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const wb = await WorkbenchApi.get(projectId);
      if (seqRef.current !== seq) return;
      const { nextSuggestion: _ignored, ...view } = wb;
      void _ignored;
      setPayload(view);
      setNext(normalizeServerSuggestion(wb.nextSuggestion, wb.project?.templateId));
      setSource('server');
    } catch {
      // workbench 未就绪/失败 → 静默回退到客户端规则（不弹错、不白屏）
      try {
        const [p, sessions] = await Promise.all([
          ProjectsApi.get(projectId),
          AgentApi.list({ projectId }).then((d) => d.items),
        ]);
        if (seqRef.current !== seq) return;
        const sessionIds = new Set(sessions.map((s) => s.id));
        const [todos, verdicts, latestReport] = await Promise.all([
          WorkbenchApi.globalHumanTodos()
            .then((all) => all.filter((t) => sessionIds.has(t.sessionId)))
            .catch(() => []),
          WorkbenchApi.pendingVerdicts(projectId).catch(() => []),
          ReportsApi.latest(projectId).catch(() => null),
        ]);
        if (seqRef.current !== seq) return;
        const suggestion = deriveNextAction({
          activeRunStatus: p.latestRun?.status ?? null,
          runProgress: p.latestRun?.progressPercent ?? 0,
          humanTodoCount: todos.length,
          pendingVerdictCount: verdicts.length,
          hasReport: !!latestReport,
          preflightIssueCount: 0, // 预检需启动校验流程才能拿到，回退期视为无已知缺口
          hasTemplate: !!p.templateId,
          hasAnyRun: !!p.latestRun,
          sessionCount: sessions.length,
        });
        const perSessionTodos = new Map<string, number>();
        for (const t of todos) perSessionTodos.set(t.sessionId, (perSessionTodos.get(t.sessionId) ?? 0) + 1);
        setPayload({
          project: p,
          latestRun: p.latestRun ?? null,
          sessions: sessions.map((s) => ({ ...s, pendingHumanStepCount: perSessionTodos.get(s.id) ?? 0 })),
          humanTodos: todos,
          verdictDrafts: verdicts,
          evidenceCount: -1, // 回退路径拿不到聚合计数，UI 显示为「—」
          latestReport,
        });
        setNext(suggestion);
        setSource('client');
      } catch {
        if (seqRef.current !== seq) return;
        setPayload(null);
        setNext(null);
        setSource(null);
      }
    } finally {
      if (seqRef.current === seq) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  return { loading, source, payload, next, refresh: () => void load() };
}
