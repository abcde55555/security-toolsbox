import { Steps, Tag, Space, Typography } from 'antd';
import { RobotOutlined, PauseCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { AgentSession, AgentPhase } from '@en18031/shared';
import { AGENT_PHASES, PHASE_INDEX, SESSION_STATUS_META } from './utils';

export default function PhaseHeader({
  session,
  connected,
}: {
  session: AgentSession | null;
  connected?: boolean;
}) {
  const phase: AgentPhase = session?.phase ?? 'onboarding';
  const status = session?.status;
  const statusMeta = status ? SESSION_STATUS_META[status] : null;
  const current = PHASE_INDEX[phase] ?? 0;

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size="middle" wrap>
          <RobotOutlined style={{ fontSize: 20, color: '#2563eb' }} />
          <Typography.Text strong>
            {session ? `会话 ${session.id.slice(0, 8)}` : 'Agent 会话'}
          </Typography.Text>
          {statusMeta && (
            <Tag color={statusMeta.color} icon={status === 'waiting_human' ? <PauseCircleOutlined /> : status === 'done' ? <CheckCircleOutlined /> : undefined}>
              {statusMeta.label}
            </Tag>
          )}
          <Tag color={connected ? 'success' : 'default'}>
            {connected ? '已连接' : '连接中…'}
          </Tag>
          {session && session.rollbackCount > 0 && (
            <Tag color="orange">回退 {session.rollbackCount} 次</Tag>
          )}
        </Space>
        {session?.planningModel && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            规划模型：{session.planningModel}
          </Typography.Text>
        )}
      </Space>
      <Steps
        size="small"
        current={current}
        style={{ marginTop: 12 }}
        status={status === 'error' ? 'error' : status === 'done' ? 'finish' : 'process'}
        items={AGENT_PHASES.map((p) => ({
          title: p.label,
          description: phase === p.key && status === 'waiting_human' ? '等待人工操作' : undefined,
        }))}
      />
    </div>
  );
}
