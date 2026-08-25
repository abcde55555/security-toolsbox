import { useMemo, useState } from 'react';
import { Layout, Space, Button, Tabs, Typography, Alert, Input, Tag, Spin, message } from 'antd';
import { ArrowLeftOutlined, SendOutlined, StopOutlined, PlayCircleOutlined, ExperimentOutlined } from '@ant-design/icons';
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

  const pendingCount = useMemo(
    () => agent.verdicts.filter((v) => v.reviewStatus === 'pending_review').length,
    [agent.verdicts],
  );

  const send = async () => {
    if (!chatInput.trim()) return;
    setSending(true);
    try {
      await agent.sendMessage(chatInput.trim());
      setChatInput('');
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

        <AiTranscriptCollapse messages={agent.state.messages} />

        <div style={{ padding: '8px 12px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="向 Agent 发送补充信息或指令…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onPressEnter={() => void send()}
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send}>发送</Button>
          </Space.Compact>
        </div>
      </Content>

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
