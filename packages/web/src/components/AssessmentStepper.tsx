import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Steps, Typography } from 'antd';
import {
  ToolOutlined, PlayCircleOutlined, RobotOutlined, CheckSquareOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { AgentApi } from '../api/endpoints';
import type { ProjectRun } from '@en18031/shared';

export type StepperStepKey = 'vars' | 'flow' | 'agent' | 'review' | 'report';

interface Props {
  projectId: string;
  hasTemplate: boolean;
  latestRun?: ProjectRun;
  reportGenerated: boolean;
  pendingVerdicts?: number;
  onGoto: (tab: string) => void;
  /** 由 useNextAction 推导的当前步进：命中的 wait 步会被高亮为 process（蓝图 §7 ui-eng） */
  emphasis?: StepperStepKey;
  /** Agent 步的跳转回调；缺省保留旧的整页跳转行为 */
  onGotoAgent?: () => void;
}

/**
 * 全流程导航条：回答「这个项目的完整评估走到哪一步了」。
 * 状态由数据推断：模板→执行→Agent 深测→判定审核→报告。
 */
export default function AssessmentStepper({ projectId, hasTemplate, latestRun, reportGenerated, onGoto, emphasis, onGotoAgent }: Props) {
  const [agentStat, setAgentStat] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  useEffect(() => {
    let alive = true;
    AgentApi.list({ projectId, limit: 50 })
      .then((d) => {
        if (!alive) return;
        const items = (d as { items?: Array<{ status: string }> }).items ?? [];
        setAgentStat({ total: items.length, done: items.filter((s) => ['done', 'error', 'aborted'].includes(s.status)).length });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  const runStatus = latestRun?.status;
  const items: Array<{
    key: StepperStepKey;
    title: string;
    icon: ReactNode;
    status: 'finish' | 'process' | 'wait';
    description?: string;
    onClick: () => void;
  }> = [
    {
      key: 'vars',
      title: '工具与模板',
      icon: <ToolOutlined />,
      status: hasTemplate ? ('finish' as const) : ('wait' as const),
      onClick: () => onGoto('vars'),
    },
    {
      key: 'flow',
      title: '执行采集',
      icon: <PlayCircleOutlined />,
      status:
        runStatus === 'success' ? ('finish' as const)
        : runStatus ? ('process' as const)
        : ('wait' as const),
      onClick: () => onGoto('flow'),
    },
    {
      key: 'agent',
      title: 'Agent 深度测试',
      icon: <RobotOutlined />,
      status:
        agentStat.total === 0 ? ('wait' as const)
        : agentStat.done > 0 ? ('finish' as const)
        : ('process' as const),
      description: agentStat.total > 0 ? `${agentStat.total} 个会话` : undefined,
      // Tab 内跳转优先（SPA 不整页刷新）；未提供回调时保留旧行为
      onClick: () => (onGotoAgent ? onGotoAgent() : (window.location.href = `/agent`)),
    },
    {
      key: 'review',
      title: '判定审核',
      icon: <CheckSquareOutlined />,
      status: reportGenerated ? ('finish' as const) : agentStat.done > 0 ? ('process' as const) : ('wait' as const),
      // 项目级审核视图属 Phase 5；过渡期落到报告 Tab
      onClick: () => onGoto('report'),
    },
    {
      key: 'report',
      title: '合规报告',
      icon: <FileTextOutlined />,
      status: reportGenerated ? ('finish' as const) : ('wait' as const),
      onClick: () => onGoto('report'),
    },
  ];

  // 高亮当前步进：nextSuggestion 指向的步骤若仍是 wait，则提升为 process
  const highlighted = items.map((it) =>
    emphasis && it.key === emphasis && it.status === 'wait' ? { ...it, status: 'process' as const } : it,
  );

  return (
    <div style={{ background: '#fff', padding: '10px 16px', borderRadius: 8, marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        完整评估流程（点击步骤跳转）
      </Typography.Text>
      <Steps
        size="small"
        items={highlighted.map(({ key, title, status, icon, description, onClick }) => ({
          key,
          title,
          status,
          icon,
          description,
          onClick,
          style: { cursor: 'pointer' },
        }))}
      />
    </div>
  );
}
