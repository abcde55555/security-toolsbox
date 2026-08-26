import { Fragment } from 'react';
import { Timeline, Tag, Typography, Divider, Empty } from 'antd';
import {
  ApiOutlined,
  UserOutlined,
  RobotOutlined,
  FlagOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { AgentSessionState } from './types';
import type { ToolCallState, HumanStepState } from './types';
import ToolCallCard from './ToolCallCard';
import HumanStepCard from './HumanStepCard';
import EvidenceAttachCard from './EvidenceAttachCard';
import { AGENT_PHASES, PHASE_INDEX } from './utils';

function PhaseDivider({ phase }: { phase: string }) {
  const meta = AGENT_PHASES[PHASE_INDEX[phase as keyof typeof PHASE_INDEX] ?? -1];
  return (
    <Divider orientation="left" style={{ margin: '12px 0', fontSize: 13 }}>
      <Tag color={meta?.color ?? 'default'} icon={<FlagOutlined />}>
        {meta?.label ?? phase}
      </Tag>
    </Divider>
  );
}

export default function PhaseTimeline({
  state,
  currentStepId,
  onCompleteHumanStep,
  onReportIssue,
  onOpenEvidence,
  onAttachEvidence,
  sessionStatus,
}: {
  state: AgentSessionState;
  currentStepId?: string;
  sessionStatus?: string;
  onCompleteHumanStep: (stepRunId: string, body: {
    outcome?: string;
    fileRefs: string[];
    functionModule?: string;
    status: 'success' | 'fail' | 'blocked';
  }) => Promise<void> | void;
  onReportIssue?: (stepRunId: string, note: string) => void;
  onOpenEvidence?: (ref: string) => void;
  onAttachEvidence?: (files: unknown[]) => void;
}) {
  // Group tool/human/message entries by phase, rendering phase transitions as dividers.
  const phaseOrder = state.phases.map((p) => p.to);
  const currentPhase = state.session?.phase ?? 'onboarding';
  if (!phaseOrder.includes(currentPhase)) phaseOrder.push(currentPhase);

  // Collect renderable items ordered by start time.
  type Item =
    | { kind: 'tool'; phase: string; data: ToolCallState }
    | { kind: 'human'; phase: string; data: HumanStepState }
    | { kind: 'evidence'; phase: string; stepRunId: string }
    | { kind: 'message'; phase: string; role: string; content: string };

  const items: Item[] = [];
  for (const tc of state.toolCalls.values()) {
    const step = tc.stepRunId ? state.steps.get(tc.stepRunId) : undefined;
    items.push({ kind: 'tool', phase: tc.phase ?? step?.phase ?? currentPhase, data: tc });
  }
  for (const hs of state.humanSteps.values()) {
    items.push({ kind: 'human', phase: hs.phase ?? currentPhase, data: hs });
  }
  for (const step of state.steps.values()) {
    if (step.stepType === 'evidence_attach') {
      items.push({ kind: 'evidence', phase: step.phase ?? currentPhase, stepRunId: step.id });
    }
  }

  items.sort((a, b) => {
    const at = a.kind === 'tool' ? a.data.startedAt : a.kind === 'human' ? state.steps.get(a.data.stepRunId)?.startedAt : '';
    const bt = b.kind === 'tool' ? b.data.startedAt : b.kind === 'human' ? state.steps.get(b.data.stepRunId)?.startedAt : '';
    return (at ?? '').localeCompare(bt ?? '');
  });

  const byPhase = new Map<string, Item[]>();
  for (const it of items) {
    const arr = byPhase.get(it.phase) ?? [];
    arr.push(it);
    byPhase.set(it.phase, arr);
  }

  if (items.length === 0 && state.messages.length === 0) {
    return <Empty description="等待 Agent 开始执行…" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />;
  }

  return (
    <div style={{ padding: '4px 4px 16px' }}>
      {phaseOrder.map((phase) => {
        const phaseItems = byPhase.get(phase) ?? [];
        return (
          <Fragment key={phase}>
            <PhaseDivider phase={phase} />
            {phaseItems.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 8 }}>
                {phase === currentPhase ? '进行中…' : '无步骤'}
              </Typography.Text>
            ) : (
              <Timeline
                items={phaseItems.map((it) => {
                  if (it.kind === 'tool') {
                    return {
                      dot: <ApiOutlined style={{ fontSize: 16, color: '#2563eb' }} />,
                      children: <ToolCallCard tool={it.data} onOpenEvidence={onOpenEvidence} />,
                    };
                  }
                  if (it.kind === 'human') {
                    const active = currentStepId === it.data.stepRunId && !it.data.completed;
                    return {
                      color: active ? 'orange' : 'gray',
                      dot: <UserOutlined style={{ fontSize: 16, color: active ? '#d97706' : '#94a3b8' }} />,
                      children: (
                        <HumanStepCard
                          step={it.data}
                          active={active}
                          sessionStatus={sessionStatus ?? state.session?.status}
                          onComplete={(body) => onCompleteHumanStep(it.data.stepRunId, body)}
                          onReportIssue={(note) => onReportIssue?.(it.data.stepRunId, note)}
                        />
                      ),
                    };
                  }
                  if (it.kind === 'evidence') {
                    return {
                      dot: <FlagOutlined style={{ fontSize: 14 }} />,
                      children: <EvidenceAttachCard onAttach={(files) => onAttachEvidence?.(files)} />,
                    };
                  }
                  return { children: null };
                })}
              />
            )}
          </Fragment>
        );
      })}

      {state.messages.length > 0 && (
        <>
          <Divider orientation="left" style={{ fontSize: 13 }}>
            <Tag icon={<RobotOutlined />}>模型消息</Tag>
          </Divider>
          {state.messages.slice(-6).map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: 6,
                padding: '4px 8px',
                background: m.role === 'user' ? '#eff6ff' : '#f8fafc',
                borderRadius: 4,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                borderLeft: `3px solid ${m.role === 'user' ? '#2563eb' : '#7c3aed'}`,
              }}
            >
              <Typography.Text type="secondary">
                {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />} {m.role}：
              </Typography.Text>{' '}
              {m.content}
            </div>
          ))}
        </>
      )}

      {state.error && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="danger">
            <WarningOutlined /> {state.error}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
