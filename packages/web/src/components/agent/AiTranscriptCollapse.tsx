import { Collapse, Tag, Typography, Space, Statistic, Row, Col } from 'antd';
import {
  RobotOutlined,
  UserOutlined,
  CompassOutlined,
  FileSearchOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import type { TranscriptMessage } from './types';

const PHASE_LABEL: Record<string, string> = {
  onboarding: '接入建档',
  collection: '证据采集',
  adjudication: '合规裁定',
  review: '人工复核',
};

export interface AgentWorkbenchProps {
  messages: TranscriptMessage[];
  phase?: string;
  status?: string;
  stepCount?: number;
  runningSteps?: number;
  evidenceCount?: number;
  verdictCount?: number;
}

/**
 * 底部工作台面板：不再把原始对话流水冒充「规划记录」，
 * 而是先给执行概览（阶段/步骤/证据/判定），对话原文降级为「模型交互明细」。
 */
export default function AiTranscriptCollapse(props: AgentWorkbenchProps) {
  const { messages, phase, status, stepCount, runningSteps, evidenceCount, verdictCount } = props;
  if (messages.length === 0 && !stepCount) return null;
  return (
    <Collapse
      size="small"
      style={{ background: '#fff', borderTop: '1px solid #e2e8f0' }}
      items={[
        {
          key: 'overview',
          label: (
            <Space>
              <CompassOutlined />
              <span>Agent 工作上下文</span>
              {phase && <Tag color="geekblue">{PHASE_LABEL[phase] ?? phase}</Tag>}
              {status && <Tag>{status}</Tag>}
              <Tag>{messages.length} 条交互</Tag>
            </Space>
          ),
          children: (
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="步骤" value={stepCount ?? 0} valueStyle={{ fontSize: 18 }} prefix={<FileSearchOutlined />} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="进行中"
                  value={runningSteps ?? 0}
                  valueStyle={{ fontSize: 18, color: (runningSteps ?? 0) > 0 ? '#2563eb' : undefined }}
                />
              </Col>
              <Col span={6}>
                <Statistic title="证据" value={evidenceCount ?? 0} valueStyle={{ fontSize: 18 }} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="判定草案"
                  value={verdictCount ?? 0}
                  valueStyle={{ fontSize: 18 }}
                  prefix={<CheckSquareOutlined />}
                />
              </Col>
            </Row>
          ),
        },
        {
          key: 'transcript',
          label: (
            <Space>
              <RobotOutlined />
              <span>模型交互明细</span>
              <Tag>{messages.length}</Tag>
            </Space>
          ),
          children: (
            <div style={{ maxHeight: 240, overflow: 'auto', paddingRight: 8 }}>
              {messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 8,
                    padding: '6px 10px',
                    background: m.role === 'user' ? '#eff6ff' : '#f8fafc',
                    borderRadius: 6,
                    borderLeft: `3px solid ${m.role === 'user' ? '#2563eb' : '#7c3aed'}`,
                  }}
                >
                  <Space size={6} style={{ marginBottom: 2 }}>
                    {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {m.role === 'user' ? '你' : m.role}
                    </Typography.Text>
                  </Space>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{m.content}</div>
                </div>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}
