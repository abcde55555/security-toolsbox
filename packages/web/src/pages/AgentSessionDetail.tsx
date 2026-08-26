import { useMemo, useState } from 'react';
import { Layout, Space, Button, Tabs, Typography, Alert, Input, Tag, Spin, message, Drawer, Badge } from 'antd';
import { ArrowLeftOutlined, SendOutlined, StopOutlined, PlayCircleOutlined, ExperimentOutlined , LoadingOutlined , UserOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAgentSession } from '../hooks/useAgentSession';
import { useMockAgentSession } from '../hooks/useMockAgentSession';
import PhaseHeader from '../components/agent/PhaseHeader';
import PhaseTimeline from '../components/agent/PhaseTimeline';
import ArtifactPanel from '../components/agent/ArtifactPanel';
import VerdictReviewPanel from '../components/agent/VerdictReviewPanel';
import AiTranscriptCollapse from '../components/agent/AiTranscriptCollapse';
import type { UploadedEvidence } from '../components/agent/EvidenceUploader';
import { AgentApi } from '../api/endpoints';

const { Content, Sider } = Layout;

export default function AgentSessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const useMock = search.get('mock') === '1' || sessionId === 'mock' || sessionId === 'mock-session';
  const real = useAgentSession(useMock ? undefined : sessionId);
  const mock = useMockAgentSession();
  const agent = useMock ? mock : real;

  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);

  const pendingCount = useMemo(
    () => agent.verdicts.filter((v) => v.reviewStatus === 'pending_review').length,
    [agent.verdicts],
  );

  const status = agent.session?.status;
  const sessionClosed = status === 'done' || status === 'error' || status === 'aborted';
  const waitingHuman = status === 'waiting_human';

  const send = async () => {
    if (!chatInput.trim()) return;
    if (sessionClosed) {
      message.warning('该会话已结束——请新建一个 Agent 会话继续评估。');
      return;
    }
    setSending(true);
    try {
      await agent.sendMessage(chatInput.trim());
      setChatInput('');
      if (waitingHuman) {
        message.info('Agent 正在等待人工步骤完成，请先处理上方的待办卡片；你的消息已记录在案。');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const onAttachEvidence = async (files: UploadedEvidence[] | unknown[]) => {
    if (!sessionId || sessionId === 'mock' || sessionId === 'mock-session') {
      message.info(`演示模式：已记录 ${files.length} 份证据（不持久化）`);
      return;
    }
    const refs = (files as UploadedEvidence[]).map((f) => f.fileRef).filter(Boolean) as string[];
    if (refs.length === 0) {
      message.warning('没有可关联的证据文件');
      return;
    }
    try {
      await AgentApi.attachEvidence(sessionId, {
        fileRefs: refs,
        functionModule: (files as UploadedEvidence[])[0]?.functionModule,
        note: '人工补充证据',
      });
      message.success(`已上传并关联 ${refs.length} 份证据`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '证据上送失败');
    }
  };

  if (agent.loading) {
    return (
      <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" tip="加载会话…" />
      </Content>
    );
  }

  if (agent.error && !agent.session) {
    return (
      <Content style={{ padding: 24 }}>
        <Alert type="error" showIcon message="加载会话失败" description={agent.error} action={<Button onClick={() => navigate('/agent')}>返回列表</Button>} />
      </Content>
    );
  }

  return (
    <Layout style={{ height: '100%', background: '#f8fafc' }}>
      <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/agent')}>会话列表</Button>
              {useMock && <Tag color="purple">MOCK 演示数据</Tag>}
            </Space>
            <Space>
              {(agent.state.humanSteps.size > 0) && (
                <Badge count={[...agent.state.humanSteps.values()].filter((h) => !h.completed).length} size="small">
                  <Button size="small" icon={<UserOutlined />} onClick={() => setTodoOpen(true)}>人工待办</Button>
                </Badge>
              )}
              {agent.session?.status === 'running' || agent.session?.status === 'waiting_human' ? (
                <Button size="small" danger icon={<StopOutlined />} onClick={() => void agent.abort()}>中止</Button>
              ) : agent.session?.status === 'planning' ? (
                <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => void agent.start()}>启动</Button>
              ) : null}
            </Space>
          </Space>
        </div>

        <PhaseHeader session={agent.session} connected={agent.connected} />

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          <PhaseTimeline
            state={agent.state}
            currentStepId={agent.session?.currentStepId}
            onCompleteHumanStep={(stepRunId, body) => agent.completeHumanStep(stepRunId, body)}
            onReportIssue={(_stepRunId, note) => agent.sendMessage(`我遇到问题：${note}`)}
            onOpenEvidence={(ref) => window.open(`/api/upload/${encodeURIComponent(ref)}`, '_blank')}
            onAttachEvidence={onAttachEvidence}
          />
        </div>

        {bottomCollapsed ? (
          <div
            onClick={() => setBottomCollapsed(false)}
            style={{
              position: 'absolute', right: 18, bottom: 64, zIndex: 30,
              background: '#1e293b', color: '#fff', borderRadius: 16,
              padding: '4px 12px', fontSize: 12, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,.25)',
            }}
          >
            ▲ 工作上下文{agent.state.humanSteps.size ? ` · ${[...agent.state.humanSteps.values()].filter((h) => !h.completed).length} 待办` : ''}
          </div>
        ) : (
        <>
        {Object.values(agent.state.streaming).some((b) => b.text.length > 0 || b.reasoning.length > 0) && (
          <div
            style={{
              padding: '8px 14px',
              background: '#f8fafc',
              borderTop: '1px dashed #cbd5e1',
              maxHeight: 140,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              fontSize: 13,
              color: '#334155',
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <LoadingOutlined spin /> 正在生成…
            </Typography.Text>
            {(() => {
              const all = Object.values(agent.state.streaming);
              const reasoning = all.map((b) => b.reasoning).join('');
              const text = all.map((b) => b.text).join('');
              return (
                <>
                  {reasoning && (
                    <div style={{ color: '#94a3b8', fontStyle: 'italic', marginBottom: text ? 4 : 0 }}>
                      💭 {reasoning.slice(-400)}
                    </div>
                  )}
                  {text && <div>{text}</div>}
                </>
              );
            })()}
          </div>
        )}
        <AiTranscriptCollapse
          messages={agent.state.messages}
          phase={agent.state.session?.phase}
          status={agent.state.session?.status}
          stepCount={agent.state.steps.size}
          runningSteps={[...agent.state.steps.values()].filter((st) => st.status === 'running').length}
          evidenceCount={agent.state.evidences.length}
          verdictCount={agent.state.verdicts.length}
          humanTodos={[...agent.state.humanSteps.values()]
            .filter((h) => !h.completed)
            .map((h) => ({
              stepRunId: h.stepRunId,
              title: h.title || '人工操作步骤',
              detail: [h.instruction, h.expectedOutcome ? `预期：${h.expectedOutcome}` : null]
                .filter(Boolean)
                .join('\n'),
            }))}
          runningList={[...agent.state.steps.values()]
            .filter((st) => st.status === 'running' && st.stepType !== 'human_instruction')
            .map((st) => ({ stepRunId: st.id, title: st.title || st.functionModule || '执行中步骤', detail: st.instruction }))}
          onFocusStep={(stepRunId) => {
            const el = document.getElementById(`human-card-${stepRunId}`) ?? document.querySelector(`[data-step-run-id="${stepRunId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.scrollIntoView({ block: 'center' });
            (el as HTMLElement | null)?.animate?.(
              [{ boxShadow: '0 0 0 3px rgba(37,99,235,.6)' }, { boxShadow: '0 0 0 0 rgba(37,99,235,0)' }],
              { duration: 1200, iterations: 2 },
            );
          }}
        />

          <div style={{ textAlign: 'center', padding: '0 0 6px', background: '#fff' }}>
            <Button type="text" size="small" onClick={() => setBottomCollapsed(true)}>
              ⌄ 收起底部面板（不挡时间线）
            </Button>
          </div>
          </>
          )}

        <div style={{ padding: '8px 12px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={
                sessionClosed
                  ? '会话已结束——请新建会话继续'
                  : waitingHuman
                    ? 'Agent 正在等待人工步骤完成…（消息将记录在案）'
                    : '向 Agent 发送补充信息或指令…'
              }
              disabled={sessionClosed}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onPressEnter={() => void send()}
            />
            <Button type="primary" icon={<SendOutlined />} disabled={sessionClosed} loading={sending} onClick={send}>发送</Button>
          </Space.Compact>
        </div>
      </Content>

      <Drawer
        title={`🙋 人工待办（${[...agent.state.humanSteps.values()].filter((h) => !h.completed).length}）`}
        placement="right"
        width={400}
        open={todoOpen}
        onClose={() => setTodoOpen(false)}
      >
        {[...agent.state.humanSteps.values()].filter((h) => !h.completed).length === 0 ? (
          <Typography.Text type="secondary">当前没有需要你处理的步骤 🎉</Typography.Text>
        ) : (
          [...agent.state.humanSteps.values()]
            .filter((h) => !h.completed)
            .map((h) => (
              <div
                key={h.stepRunId}
                onClick={() => {
                  setTodoOpen(false);
                  setTimeout(() => {
                    const el = document.getElementById(`human-card-${h.stepRunId}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    (el as HTMLElement | null)?.animate?.(
                      [{ boxShadow: '0 0 0 3px rgba(217,119,6,.7)' }, { boxShadow: '0 0 0 0 rgba(217,119,6,0)' }],
                      { duration: 1200, iterations: 2 },
                    );
                  }, 120);
                }}
                style={{
                  padding: 10, marginBottom: 8, borderRadius: 8, cursor: 'pointer',
                  background: '#fffbeb', border: '1px solid #fde68a',
                }}
              >
                <Typography.Text strong style={{ fontSize: 13 }}>{h.title || '人工操作步骤'}</Typography.Text>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {h.instruction}
                </div>
                {h.expectedOutcome && (
                  <div style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>预期：{h.expectedOutcome}</div>
                )}
                {h.evidenceRequired && (
                  <Tag color="orange" style={{ marginTop: 6 }}>需上传证据</Tag>
                )}
              </div>
            ))
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          点击任意待办将定位到对应卡片；完成后卡片会显示「Agent 已收到」。
        </Typography.Text>
      </Drawer>

      <Sider width={380} theme="light" style={{ borderLeft: '1px solid #e2e8f0', overflow: 'auto', background: '#fff' }}>
        <Tabs
          size="small"
          style={{ padding: '0 8px' }}
          items={[
            {
              key: 'review',
              label: (
                <span>
                  判定审核
                  {pendingCount > 0 && <Tag color="red" style={{ marginLeft: 4 }}>{pendingCount}</Tag>}
                </span>
              ),
              children: (
                <VerdictReviewPanel
                  verdicts={agent.verdicts}
                  onApprove={(id) => agent.reviewVerdict(id, 'approve')}
                  onReject={(id, reason) => agent.reviewVerdict(id, 'reject', reason)}
                  onRequestEvidence={(clauseId) => {
                    message.loading({ content: '正在退回 B 阶段补采…', key: 'retry' });
                    agent.retryClause(clauseId).then(() => message.success({ content: '已请求补采', key: 'retry' }));
                  }}
                />
              ),
            },
            {
              key: 'artifacts',
              label: (
                <span>
                  <ExperimentOutlined /> 工件/证据
                </span>
              ),
              children: (
                <ArtifactPanel
                  artifacts={agent.artifacts}
                  evidences={agent.evidences}
                  onUploadEvidence={onAttachEvidence}
                />
              ),
            },
            {
              key: 'session',
              label: '会话信息',
              children: (
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>已选条款</Typography.Text>
                  <Space size={[4, 4]} wrap>
                    {agent.session?.selectedClauses.map((c) => <Tag key={c}>{c}</Tag>)}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8 }}>设备档案</Typography.Text>
                  <pre style={{ background: '#f1f5f9', padding: 8, borderRadius: 4, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                    {JSON.stringify(agent.session?.deviceProfile ?? {}, null, 2)}
                  </pre>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>授权工具</Typography.Text>
                  <Space size={[4, 4]} wrap>
                    {agent.session?.authorizedTools?.map((t) => <Tag key={t} color="geekblue">{t}</Tag>)}
                  </Space>
                </Space>
              ),
            },
          ]}
        />
      </Sider>
    </Layout>
  );
}
