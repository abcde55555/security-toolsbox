import { useEffect, useState } from 'react';
import { Steps, Typography } from 'antd';
import {
  ToolOutlined, PlayCircleOutlined, RobotOutlined, CheckSquareOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { AgentApi } from '../api/endpoints';
import type { ProjectRun } from '@en18031/shared';

interface Props {
  projectId: string;
  hasTemplate: boolean;
  latestRun?: ProjectRun;
  reportGenerated: boolean;
  pendingVerdicts?: number;
  onGoto: (tab: string) => void;
}

/**
 * 全流程导航条：回答「这个项目的完整评估走到哪一步了」。
 * 状态由数据推断：模板→执行→Agent 深测→判定审核→报告。
 */
export default function AssessmentStepper({ projectId, hasTemplate, latestRun, reportGenerated, onGoto }: Props) {
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
  const items = [
    {
      title: '工具与模板',
      icon: <ToolOutlined />,
      status: hasTemplate ? ('finish' as const) : ('wait' as const),
      onClick: () => onGoto('vars'),
    },
    {
      title: '执行采集',
      icon: <PlayCircleOutlined />,
      status:
        runStatus === 'success' ? ('finish' as const)
        : runStatus ? ('process' as const)
        : ('wait' as const),
      onClick: () => onGoto('flow'),
    },
    {
      title: 'Agent 深度测试',
      icon: <RobotOutlined />,
      status:
        agentStat.total === 0 ? ('wait' as const)
        : agentStat.done > 0 ? ('finish' as const)
        : ('process' as const),
      description: agentStat.total > 0 ? `${agentStat.total} 个会话` : undefined,
      onClick: () => (window.location.href = `/agent`),
    },
    {
      title: '判定审核',
      icon: <CheckSquareOutlined />,
      status: reportGenerated ? ('finish' as const) : agentStat.done > 0 ? ('process' as const) : ('wait' as const),
      onClick: () => onGoto('report'),
    },
    {
      title: '合规报告',
      icon: <FileTextOutlined />,
      status: reportGenerated ? ('finish' as const) : ('wait' as const),
      onClick: () => onGoto('report'),
    },
  ];

  return (
    <div style={{ background: '#fff', padding: '10px 16px', borderRadius: 8, marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        完整评估流程（点击步骤跳转）
      </Typography.Text>
      <Steps size="small" items={items.map(({ title, status, icon, description }) => ({ title, status, icon, description }))} />
    </div>
  );
}
