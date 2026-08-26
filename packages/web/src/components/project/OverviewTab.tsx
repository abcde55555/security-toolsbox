import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Tag, Typography, Skeleton, Space, message } from 'antd';
import {
  PlayCircleOutlined, UserOutlined, CheckSquareOutlined, FileTextOutlined,
  FileAddOutlined, ToolOutlined, SettingOutlined, PlusOutlined,
  RobotOutlined, LoadingOutlined, RightOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import type { NextAction } from '../../hooks/useNextAction';
import type { WorkbenchView } from '../../hooks/useNextAction';
import { ReportsApi } from '../../api/endpoints';
import { reportError } from '../../api/client';
import { useNavigate } from 'react-router-dom';
import { TodoList } from '../agent/AiTranscriptCollapse';
import { SESSION_STATUS_META } from '../agent/utils';
import EmptyGuide from '../common/EmptyGuide';
import { space, radius, fontSize, neutral, semantic, shadow, cardBase } from '../../theme/design-tokens';

/**
 * 项目总览（「工作台一屏」Phase 1，蓝图 §5.3 总览线框的前端半）：
 * NextAction 主行动卡 + 关键计数 + 本项目待办清单（复用 TodoList）+ 会话速览。
 * 数据来自 useNextAction（workbench 端点优先，客户端规则回退）。
 */

const ACTION_ACCENT: Record<NextAction['kind'], { color: string; icon: ReactNode }> = {
  follow_run: { color: semantic.inProgress.main, icon: <LoadingOutlined spin /> },
  start_run: { color: semantic.inProgress.main, icon: <PlayCircleOutlined /> },
  follow_session: { color: semantic.inProgress.main, icon: <RobotOutlined /> },
  handle_human_todos: { color: semantic.waitingHuman.main, icon: <UserOutlined /> },
  fix_preflight: { color: semantic.warning.main, icon: <ToolOutlined /> },
  review_verdicts: { color: semantic.warning.main, icon: <CheckSquareOutlined /> },
  configure_vars: { color: semantic.warning.main, icon: <SettingOutlined /> },
  generate_report: { color: semantic.success.main, icon: <FileAddOutlined /> },
  view_report: { color: semantic.success.main, icon: <FileTextOutlined /> },
  create_session: { color: semantic.inProgress.main, icon: <PlusOutlined /> },
};

function KpiCard({
  label, value, suffix, accent, children, onClick,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  accent?: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        ...cardBase,
        padding: space.md,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: fontSize.sm }}>{label}</Typography.Text>
      <div style={{ marginTop: 2 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: accent ?? neutral.textPrimary }}>
          {value}
        </span>
        {suffix && <span style={{ marginLeft: 4, color: neutral.textSecondary }}> {suffix}</span>}
      </div>
      {children && <div style={{ marginTop: space.xs, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

export default function OverviewTab({
  projectId,
  wb,
  onGotoTab,
  onStartTest,
  onCancelRun,
}: {
  projectId: string;
  /** useNextAction 的返回值（由 ProjectDetail 持有，保证 Stepper 与总览同源） */
  wb: { loading: boolean; source: 'server' | 'client' | null; payload: WorkbenchView | null; next: NextAction | null; refresh: () => void };
  onGotoTab: (tab: string) => void;
  /** 打开预检弹窗（fix_preflight / start_run 的直达动作） */
  onStartTest: () => void;
  onCancelRun?: () => void;
}) {
  const navigate = useNavigate();
  const { loading, source, payload, next, refresh } = wb;
  const [generating, setGenerating] = useState(false);

  const goSession = (sessionId?: string, focusStepRunId?: string, verdictId?: string) => {
    if (!sessionId) return false;
    const params = new URLSearchParams();
    if (focusStepRunId) params.set('focus', focusStepRunId);
    if (verdictId) params.set('verdict', verdictId);
    const qs = params.toString();
    navigate(`/agent/${sessionId}${qs ? `?${qs}` : ''}`);
    return true;
  };

  const runAction = async () => {
    if (!next) return;
    switch (next.kind) {
      case 'follow_run':
        onGotoTab('flow');
        break;
      case 'start_run':
      case 'fix_preflight':
        onStartTest();
        break;
      case 'configure_vars':
        onGotoTab('vars');
        break;
      case 'handle_human_todos':
        if (!goSession(next.sessionId, next.todoStepRunId) && (payload?.humanTodos.length ?? 0) > 0) {
          const t = payload!.humanTodos[0];
          goSession(t.sessionId, t.stepRunId);
        }
        break;
      case 'follow_session':
        goSession(next.sessionId);
        break;
      case 'review_verdicts':
        // 项目级审核视图属 Phase 5；先落到最近会话的审核面板
        if (!goSession(payload?.sessions[0]?.id, undefined, next.verdictId)) onGotoTab('report');
        break;
      case 'generate_report': {
        setGenerating(true);
        try {
          await ReportsApi.generate(projectId, next.runId ?? payload?.latestRun?.id);
          message.success('报告已生成');
          onGotoTab('report');
          refresh();
        } catch (e) {
          reportError(e);
        } finally {
          setGenerating(false);
        }
        break;
      }
      case 'view_report':
        onGotoTab('report');
        break;
      case 'create_session':
        navigate(`/agent/new?projectId=${projectId}`);
        break;
    }
  };

  if (loading && !payload) {
    return (
      <div style={cardBase}>
        <Skeleton active paragraph={{ rows: 6 }} style={{ padding: space.lg }} />
      </div>
    );
  }
  if (!payload) {
    return (
      <div style={cardBase}>
        <EmptyGuide
          compact
          title="总览数据加载失败"
          hint="无法获取项目工作台聚合数据。"
          action={{ label: '重试', onClick: refresh }}
        />
      </div>
    );
  }

  const activeSessions = payload.sessions.filter((s) =>
    ['planning', 'running', 'waiting_human', 'waiting_confirm', 'review'].includes(s.status));
  const statusCounts = new Map<string, number>();
  for (const s of payload.sessions) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);

  const accent = next ? ACTION_ACCENT[next.kind] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      {/* —— Next Best Action 主行动卡 —— */}
      <div
        style={{
          ...cardBase,
          boxShadow: shadow.card,
          borderLeft: `4px solid ${accent?.color ?? neutral.border}`,
          padding: `${space.lg}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
          flexWrap: 'wrap',
          borderRadius: radius.lg,
        }}
      >
        <div style={{ minWidth: 240, flex: 1 }}>
          <Typography.Text type="secondary" style={{ fontSize: fontSize.sm }}>
            现在最该做什么{source === 'client' ? '（本地推导）' : ''}
          </Typography.Text>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
            {accent?.icon} {next?.title ?? '—'}
          </div>
          {next?.reason && (
            <Typography.Text type="secondary" style={{ fontSize: fontSize.md, display: 'block', marginTop: 2 }}>
              {next.reason}
            </Typography.Text>
          )}
        </div>
        <Space>
          {next?.kind === 'follow_run' && (
            <Button danger onClick={() => { onCancelRun?.(); }}>取消运行</Button>
          )}
          <Button type="primary" size="large" loading={generating} onClick={() => void runAction()}>
            {next?.title ?? '查看'} <RightOutlined />
          </Button>
        </Space>
      </div>

      {/* —— 关键计数 —— */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: space.md }}>
        <KpiCard
          label="Agent 会话"
          value={payload.sessions.length}
          suffix={`个 · ${activeSessions.length} 个进行中`}
          onClick={payload.sessions[0] ? () => goSession(activeSessions[0]?.id ?? payload.sessions[0].id) : undefined}
        >
          {[...statusCounts.entries()].map(([st, n]) => {
            const meta = (SESSION_STATUS_META as Record<string, { label: string; color: string }>)[st];
            return <Tag key={st} color={meta?.color ?? 'default'} style={{ marginRight: 0 }}>{meta?.label ?? st} {n}</Tag>;
          })}
          {payload.sessions.length === 0 && <Tag>暂无会话</Tag>}
        </KpiCard>
        <KpiCard
          label="人工待办"
          value={payload.humanTodos.length}
          suffix="项等你处理"
          accent={payload.humanTodos.length > 0 ? semantic.waitingHuman.main : undefined}
          onClick={payload.humanTodos[0] ? () => goSession(payload.humanTodos[0].sessionId, payload.humanTodos[0].stepRunId) : undefined}
        >
          <Tag color={payload.humanTodos.length > 0 ? 'warning' : 'default'} style={{ marginRight: 0 }}>
            {payload.humanTodos.length > 0 ? '点击直达卡片' : '暂无'}
          </Tag>
        </KpiCard>
        <KpiCard
          label="判定草案"
          value={payload.verdictDrafts.length}
          suffix="条待审核"
          accent={payload.verdictDrafts.length > 0 ? semantic.warning.main : semantic.success.main}
          onClick={payload.verdictDrafts[0] ? () => goSession(payload.sessions[0]?.id, undefined, payload.verdictDrafts[0].id) : undefined}
        >
          <Tag color={payload.verdictDrafts.length > 0 ? 'processing' : 'success'} style={{ marginRight: 0 }}>
            {payload.verdictDrafts.length > 0 ? '审完才计入评分' : '已清零'}
          </Tag>
        </KpiCard>
        <KpiCard
          label="证据数"
          value={payload.evidenceCount >= 0 ? payload.evidenceCount : '—'}
          suffix="条"
          onClick={() => onGotoTab('cmdruns')}
        />
        <KpiCard
          label="最新报告"
          value={payload.latestReport ? (payload.latestReport.grade || '已生成') : '未生成'}
          accent={payload.latestReport ? semantic.success.main : neutral.textTertiary}
          onClick={() => onGotoTab('report')}
        >
          {payload.latestReport?.generatedAt && (
            <Tag style={{ marginRight: 0 }}>{new Date(payload.latestReport.generatedAt).toLocaleDateString('zh-CN')}</Tag>
          )}
        </KpiCard>
      </div>

      {/* —— 本项目待办清单（复用会话页 TodoList）—— */}
      <div style={{ ...cardBase, padding: space.lg }}>
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: space.sm }}>
          🙋 待你处理的人工步骤
        </Typography.Title>
        <TodoList
          kind="human"
          items={payload.humanTodos.map((t) => ({
            stepRunId: t.stepRunId,
            title: t.instruction || t.sessionName,
            detail: new Date(t.updatedAt).toLocaleString('zh-CN'),
          }))}
          onFocus={(stepRunId) => {
            const t = payload.humanTodos.find((x) => x.stepRunId === stepRunId);
            if (t) goSession(t.sessionId, t.stepRunId);
          }}
        />
      </div>

      {/* —— 会话速览 —— */}
      <div style={{ ...cardBase, padding: space.lg }}>
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: space.sm }}>
          <ExperimentOutlined /> 最近会话
        </Typography.Title>
        {payload.sessions.length === 0 ? (
          <EmptyGuide
            compact
            title="本项目还没有 Agent 会话"
            hint="发起会话后，Agent 将按标准逐条款做深度测试并产出判定草案。"
            action={{ label: '发起 Agent 会话', onClick: () => navigate(`/agent/new?projectId=${projectId}`) }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
            {payload.sessions.slice(0, 5).map((s) => {
              const meta = (SESSION_STATUS_META as Record<string, { label: string; color: string }>)[s.status];
              return (
                <div
                  key={s.id}
                  onClick={() => goSession(s.id)}
                  style={{
                    padding: `${space.xs + 2}px ${space.sm + 2}px`,
                    borderRadius: radius.md,
                    background: neutral.bgSubtle,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: space.sm,
                    flexWrap: 'wrap',
                  }}
                >
                  <Space size={6} wrap>
                    <RobotOutlined style={{ color: semantic.inProgress.main }} />
                    <Typography.Text strong style={{ fontSize: fontSize.md }}>会话 {s.id.slice(0, 8)}</Typography.Text>
                    <Tag color={meta?.color ?? 'default'}>{meta?.label ?? s.status}</Tag>
                    {s.pendingHumanStepCount > 0 && (
                      <Tag color="warning">待人工 ×{s.pendingHumanStepCount}</Tag>
                    )}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: fontSize.sm }}>
                    {new Date(s.updatedAt).toLocaleString('zh-CN')} <RightOutlined />
                  </Typography.Text>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
