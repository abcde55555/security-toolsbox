import { useEffect, useRef, useState } from 'react';
import { Card, Tag, Space, Typography, Button, Alert, Input, Collapse, Tooltip, message } from 'antd';
import {
  UserOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { HumanStepState } from './types';
import RichEvidenceEditor, { type RichValue } from './RichEvidenceEditor';

/**
 * Very small plain-text "markdown" renderer: preserves line breaks,
 * renders bullet lists and **bold**. We avoid pulling react-markdown for
 * P0; the implementation plan asks for react-markdown + rehype-sanitize later.
 */
function MiniMarkdown({ text }: { text?: string }) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
      {lines.map((line, i) => {
        if (/^\s*[-*]\s+/.test(line)) {
          return (
            <div key={i} style={{ paddingLeft: 12 }}>
              • {renderInline(line.replace(/^\s*[-*]\s+/, ''))}
            </div>
          );
        }
        return <div key={i}>{line.trim() ? renderInline(line) : ' '}</div>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    const img = p.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (img) {
      return (
        <img
          key={i}
          src={`/api/upload/${encodeURIComponent(img[1])}`}
          style={{ maxWidth: '100%', borderRadius: 6, margin: '4px 0' }}
          alt="证据"
        />
      );
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3 }}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

export default function HumanStepCard({
  step,
  onComplete,
  onReportIssue,
  active,
}: {
  step: HumanStepState;
  onComplete: (body: { outcome?: string; fileRefs: string[]; functionModule?: string; status: 'success' | 'fail' | 'blocked' }) => Promise<void> | void;
  onReportIssue?: (note: string) => void;
  active?: boolean;
}) {
  const [rich, setRich] = useState<RichValue>({ markdown: '', fileRefs: [] });
  const [submitting, setSubmitting] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  const evidenceRequired = step.evidenceRequired ?? false;
  const canSubmit = evidenceRequired ? rich.fileRefs.length > 0 : rich.markdown.trim().length > 0 || rich.fileRefs.length > 0;

  // Scroll into view and pulse the document title while waiting.
  useEffect(() => {
    if (!active || step.completed) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const original = document.title;
    let toggle = false;
    const t = setInterval(() => {
      toggle = !toggle;
      document.title = toggle ? '⚠ 等待人工操作' : original;
    }, 1200);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [active, step.completed]);

  const handleComplete = async () => {
    if (!canSubmit) {
      message.warning('请至少上传一份证据后再完成');
      return;
    }
    setSubmitting(true);
    try {
      await onComplete({
        outcome: rich.markdown || undefined,
        fileRefs: rich.fileRefs,
        functionModule: step.functionModule,
        status: 'success',
      });
      message.success('已提交，Agent 继续执行');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const border = step.completed ? '#16a34a' : active ? '#d97706' : '#d97706';
  const pulse = active && !step.completed;

  return (
    <div
      ref={cardRef}
      id={`human-card-${step.stepRunId}`}
      data-step-run-id={step.stepRunId}
      className={pulse ? 'agent-human-pulse' : undefined}
      style={{
        border: `2px solid ${border}`,
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        background: step.completed ? '#f0fdf4' : '#fffbeb',
        boxShadow: pulse ? '0 0 0 3px rgba(217,119,6,0.15)' : undefined,
      }}
    >
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <UserOutlined style={{ color: '#d97706' }} />
          <Typography.Text strong>
            {step.title ?? '人工操作步骤'}
          </Typography.Text>
          {step.functionModule && <Tag>{step.functionModule}</Tag>}
          {step.completed ? (
            <Tag icon={<CheckCircleOutlined />} color="success">Agent 已收到，继续执行中</Tag>
          ) : (
            <Tag color="warning">待人工处理</Tag>
          )}
        </Space>
      </Space>

      <div style={{ marginTop: 10 }}>
        <MiniMarkdown text={step.instruction} />
      </div>

      {step.expectedOutcome && (
        <Alert
          style={{ marginTop: 10 }}
          type="info"
          showIcon
          message="预期结果"
          description={<MiniMarkdown text={step.expectedOutcome} />}
        />
      )}

      {step.referenceCommand && (
        <Collapse
          size="small"
          ghost
          style={{ marginTop: 8 }}
          items={[
            {
              key: 'ref',
              label: <Space><CodeOutlined /> 参考命令</Space>,
              children: (
                <pre style={{ margin: 0, background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 4, fontSize: 12, overflow: 'auto' }}>
                  {step.referenceCommand}
                </pre>
              ),
            },
          ]}
        />
      )}

      {step.completed && (
        <Alert
          style={{ marginTop: 10 }}
          type="success"
          showIcon
          message="已闭环：Agent 确认收到你的提交"
          description={
            <div style={{ fontSize: 12 }}>
              <div>
                {step.completedAt ? `提交时间：${new Date(step.completedAt).toLocaleString()}` : null}
                {step.fileRefs?.length ? ` · 附件 ${step.fileRefs.length} 份` : ''}
              </div>
              {step.outcome && <div style={{ marginTop: 4 }}><MiniMarkdown text={step.outcome} /></div>}
              <div style={{ marginTop: 6, color: '#64748b' }}>
                无需更多操作——Agent 已带着这些信息继续评估；如需补充，直接在下方输入框留言即可。
              </div>
            </div>
          }
        />
      )}

      {!step.completed && (
        <>
          <div style={{ marginTop: 10 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              操作记录与证据 {evidenceRequired && <span style={{ color: '#dc2626' }}>（至少贴一张图片）</span>}
            </Typography.Text>
            <RichEvidenceEditor
              placeholder="描述操作过程、粘贴结果截图…（支持文字与图片混排）"
              onChange={setRich}
            />
          </div>
          <Space style={{ marginTop: 10 }}>
            <Button type="primary" icon={<CheckCircleOutlined />} loading={submitting} onClick={handleComplete}>
              完成并继续
            </Button>
            <Tooltip title="遇到设备/环境问题，记录原因让 Agent 调整方案">
              <Button danger icon={<WarningOutlined />} onClick={() => setIssueOpen((v) => !v)}>
                我遇到问题
              </Button>
            </Tooltip>
          </Space>
          {issueOpen && (
            <div style={{ marginTop: 8 }}>
              <Input.TextArea
                rows={2}
                placeholder="描述遇到的问题，Agent 将据此调整方案"
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
              />
              <Button
                size="small"
                style={{ marginTop: 6 }}
                onClick={() => {
                  onReportIssue?.(issueNote);
                  setIssueOpen(false);
                  setIssueNote('');
                }}
              >
                提交问题
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
