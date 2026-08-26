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

export interface WorkTodoItem {
  stepRunId: string;
  title: string;
  /** 人类需要提供什么（instruction 全文/摘要） */
  detail?: string;
}

export interface AgentWorkbenchProps {
  messages: TranscriptMessage[];
  phase?: string;
  status?: string;
  stepCount?: number;
  runningSteps?: number;
  evidenceCount?: number;
  verdictCount?: number;
  /** 等待人工的步骤清单（需要人类提供的信息） */
  humanTodos?: WorkTodoItem[];
  /** 正在执行的步骤清单 */
  runningList?: WorkTodoItem[];
  /** 点击待办项时滚动到对应卡片 */
  onFocusStep?: (stepRunId: string) => void;
}

/**
 * 待办清单复用件：会话页工作台面板与项目总览（OverviewTab）共用。
 */
export function TodoList({ items, kind, onFocus }: { items: WorkTodoItem[]; kind: 'human' | 'run'; onFocus?: (id: string) => void }) {
  if (items.length === 0) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {kind === 'human' ? '暂无——当前不需要你提供信息 🎉' : '暂无正在执行的步骤'}
      </Typography.Text>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it) => (
        <div
          key={it.stepRunId}
          id={`workbench-todo-${it.stepRunId}`}
          onClick={() => onFocus?.(it.stepRunId)}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: kind === 'human' ? '#fffbeb' : '#f8fafc',
            border: `1px solid ${kind === 'human' ? '#fde68a' : '#e2e8f0'}`,
            cursor: onFocus ? 'pointer' : 'default',
          }}
        >
          <Typography.Text strong style={{ fontSize: 13 }}>
            {kind === 'human' ? '🙋 ' : '⚙️ '}
            {it.title}
          </Typography.Text>
          {it.detail && (
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2, whiteSpace: 'pre-wrap' }}>
              {it.detail.length > 120 ? `${it.detail.slice(0, 120)}…` : it.detail}
            </div>
          )}
          {kind === 'human' && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              点击定位到卡片 ↓
            </Typography.Text>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AiTranscriptCollapse(props: AgentWorkbenchProps) {
  const { messages, phase, status, stepCount, runningSteps, evidenceCount, verdictCount, humanTodos, runningList, onFocusStep } = props;
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
            <>
              <Row gutter={16} style={{ marginBottom: humanTodos?.length ? 12 : 8 }}>
                <Col span={6}>
                  <Statistic title="步骤" value={stepCount ?? 0} valueStyle={{ fontSize: 16 }} prefix={<FileSearchOutlined />} />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="进行中"
                    value={runningSteps ?? 0}
                    valueStyle={{ fontSize: 16, color: (runningSteps ?? 0) > 0 ? '#2563eb' : undefined }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic title="证据" value={evidenceCount ?? 0} valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="判定草案"
                    value={verdictCount ?? 0}
                    valueStyle={{ fontSize: 16 }}
                    prefix={<CheckSquareOutlined />}
                  />
                </Col>
              </Row>
              {(humanTodos?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
                    🙋 需要你提供（{humanTodos!.length}）
                  </Typography.Text>
                  <TodoList items={humanTodos!} kind="human" onFocus={onFocusStep} />
                </div>
              )}
              {(runningList?.length ?? 0) > 0 && (
                <div>
                  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
                    ⚙️ 正在执行（{runningList!.length}）
                  </Typography.Text>
                  <TodoList items={runningList!} kind="run" />
                </div>
              )}
              {!humanTodos?.length && !runningList?.length && null}
            </>
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
