import { useState } from 'react';
import {
  Drawer, Space, Descriptions, Tag, Typography, Card, Button, Spin, Modal,
  Input, Switch, message,
} from 'antd';
import { RedoOutlined } from '@ant-design/icons';
import type { StepRunDetail } from '../../api/endpoints';
import { ClausesApi } from '../../api/endpoints';
import { reportError } from '../../api/client';
import {
  stepStatusColor, stepStatusText, severityColor, severityText, evidenceTypeText,
} from '../../utils/ui';

const { TextArea } = Input;

interface StepDetailDrawerProps {
  detail: StepRunDetail | null;
  loading: boolean;
  onClose: () => void;
  onRetry: (stepRunId: string) => void;
  onVerdictOverride?: () => void;
}

interface OverrideState {
  verdictId: string;
  clauseId: string;
  pass: boolean;
  reason: string;
}

export default function StepDetailDrawer({
  detail, loading, onClose, onRetry, onVerdictOverride,
}: StepDetailDrawerProps) {
  const [override, setOverride] = useState<OverrideState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openOverride = (v: StepRunDetail['verdicts'][number]) => {
    setOverride({ verdictId: v.id, clauseId: v.clauseId, pass: v.pass, reason: '' });
  };

  const submitOverride = async () => {
    if (!override) return;
    if (!override.reason.trim()) {
      message.warning('请填写覆盖原因');
      return;
    }
    setSubmitting(true);
    try {
      await ClausesApi.overrideVerdict(override.verdictId, override.pass, override.reason);
      message.success('判定已覆盖');
      setOverride(null);
      onVerdictOverride?.();
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Drawer
        title={detail ? `${detail.stepSnapshot.title} (${detail.stepId})` : '步骤详情'}
        width={680}
        open={!!detail || loading}
        onClose={onClose}
        extra={detail && (detail.status === 'fail' || detail.status === 'timeout') ? (
          <Button icon={<RedoOutlined />} onClick={() => onRetry(detail.id)}>重试此步骤</Button>
        ) : null}
      >
        {loading ? <Spin /> : detail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="状态">
                <Tag color={stepStatusColor[detail.status]}>{stepStatusText[detail.status] ?? detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="退出码">{detail.exitCode ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="耗时">{detail.durationMs ? `${detail.durationMs} ms` : '-'}</Descriptions.Item>
              <Descriptions.Item label="工具">{detail.stepSnapshot.toolId}</Descriptions.Item>
              {detail.startedAt && <Descriptions.Item label="开始" span={2}>{new Date(detail.startedAt).toLocaleString('zh-CN')}</Descriptions.Item>}
              {detail.error && (
                <Descriptions.Item label="错误" span={2}>
                  <Typography.Text type="danger">{detail.error.message}</Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {detail.verdicts.length > 0 && (
              <>
                <Typography.Text strong>条款判定 ({detail.verdicts.length})</Typography.Text>
                {detail.verdicts.map((v) => (
                  <Card key={v.id} size="small">
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <Tag className={v.pass ? 'clause-pass' : 'clause-fail'} color={v.pass ? 'green' : 'red'}>
                            {v.pass ? '通过' : '不通过'}
                          </Tag>
                          <span className="mono">{v.clauseId}</span>
                          <Tag color={severityColor(v.severity)}>{severityText[v.severity] ?? v.severity}</Tag>
                          {v.overridden && <Tag color="orange">已人工覆盖</Tag>}
                        </Space>
                        <Button size="small" onClick={() => openOverride(v)}>人工覆盖判定</Button>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v.reason}</Typography.Text>
                      {v.overridden && v.overrideReason && (
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                          覆盖原因：{v.overrideReason}
                        </Typography.Text>
                      )}
                    </Space>
                  </Card>
                ))}
              </>
            )}

            {detail.evidences.length > 0 && (
              <>
                <Typography.Text strong>证据 ({detail.evidences.length})</Typography.Text>
                {detail.evidences.map((ev) => (
                  <Card key={ev.id} size="small" style={{ background: '#f8fafc' }}>
                    <Space style={{ marginBottom: 4 }}>
                      <Tag>{evidenceTypeText[ev.type] ?? ev.type}</Tag>
                      <Tag color={severityColor(ev.severity)}>{severityText[ev.severity] ?? ev.severity}</Tag>
                    </Space>
                    <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{ev.content}</pre>
                  </Card>
                ))}
              </>
            )}

            {detail.stdout && (
              <>
                <Typography.Text strong>stdout</Typography.Text>
                <pre className="terminal" style={{ height: 180, margin: 0 }}>{detail.stdout}</pre>
              </>
            )}
            {detail.stderr && (
              <>
                <Typography.Text strong>stderr</Typography.Text>
                <pre className="terminal" style={{ height: 120, margin: 0 }}>{detail.stderr}</pre>
              </>
            )}
          </Space>
        )}
      </Drawer>

      <Modal
        title="人工覆盖判定"
        open={!!override}
        onCancel={() => setOverride(null)}
        onOk={() => void submitOverride()}
        confirmLoading={submitting}
        okText="确认覆盖" cancelText="取消"
      >
        {override && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <span className="mono">{override.clauseId}</span>
              <Tag color={override.pass ? 'green' : 'red'}>{override.pass ? '通过' : '不通过'}</Tag>
            </Space>
            <Space>
              <Typography.Text>判定结果：</Typography.Text>
              <Switch
                checked={override.pass}
                onChange={(v) => setOverride((prev) => prev ? { ...prev, pass: v } : prev)}
                checkedChildren="通过"
                unCheckedChildren="不通过"
              />
            </Space>
            <Typography.Text>覆盖原因（必填）：</Typography.Text>
            <TextArea
              rows={4}
              value={override.reason}
              onChange={(e) => setOverride((prev) => prev ? { ...prev, reason: e.target.value } : prev)}
              placeholder="请说明人工覆盖此判定的理由"
            />
          </Space>
        )}
      </Modal>
    </>
  );
}
