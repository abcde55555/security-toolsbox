import { useState } from 'react';
import { Card, Tag, Space, Typography, Button, List, Input, Modal, Empty, message, Tooltip } from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  RedoOutlined,
  SafetyCertificateOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import type { VerdictDraft } from '../../api/endpoints';
import { severityText } from '../../utils/ui';
import { fileRefUrl, fileNameOf } from './utils';

function reviewTag(status?: string) {
  switch (status) {
    case 'approved':
      return <Tag icon={<CheckOutlined />} color="success">已通过</Tag>;
    case 'rejected':
      return <Tag icon={<CloseOutlined />} color="error">已拒绝</Tag>;
    case 'skipped':
      return <Tag>已跳过</Tag>;
    default:
      return <Tag color="processing">待审核</Tag>;
  }
}

export default function VerdictReviewPanel({
  verdicts,
  onApprove,
  onReject,
  onRequestEvidence,
  onLocateEvidence,
}: {
  verdicts: VerdictDraft[];
  onApprove: (id: string) => Promise<void> | void;
  onReject: (id: string, reason: string) => Promise<void> | void;
  onRequestEvidence: (clauseId: string) => Promise<void> | void;
  onLocateEvidence?: (ref: string) => void;
}) {
  const [rejecting, setRejecting] = useState<VerdictDraft | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const pending = verdicts.filter((v) => v.reviewStatus === 'pending_review');
  const reviewed = verdicts.filter((v) => v.reviewStatus !== 'pending_review');

  const act = async (id: string, fn: () => Promise<void> | void) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {pending.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text type="warning">
            <SafetyCertificateOutlined /> {pending.length} 条判定待审核
          </Typography.Text>
        </div>
      )}
      {verdicts.length === 0 ? (
        <Empty description="暂无判定，Agent 在 C 阶段产出后在此审核" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={[...pending, ...reviewed]}
          renderItem={(v) => (
            <Card
              size="small"
              style={{ marginBottom: 8, borderLeft: `3px solid ${v.pass ? '#16a34a' : '#dc2626'}` }}
              title={
                <Space size={6} wrap>
                  <Tag color={v.pass ? 'success' : 'error'}>{v.pass ? 'PASS' : 'FAIL'}</Tag>
                  <Typography.Text strong>{v.clauseId}</Typography.Text>
                  {v.severity && <Tag>{severityText[v.severity] ?? v.severity}</Tag>}
                  {reviewTag(v.reviewStatus)}
                  {v.aiGenerated && <Tag color="purple">AI 生成</Tag>}
                </Space>
              }
            >
              <Typography.Paragraph style={{ fontSize: 12, marginBottom: 6 }}>
                {v.reason || '（无理由说明）'}
              </Typography.Paragraph>
              {v.evidenceRefs?.length > 0 && (
                <Space size={4} wrap style={{ marginBottom: 8 }}>
                  {v.evidenceRefs.map((ref) => (
                    <Tooltip title={ref} key={ref}>
                      <Button
                        size="small"
                        type="link"
                        icon={<FileSearchOutlined />}
                        href={fileRefUrl(ref)}
                        target="_blank"
                        onClick={(e) => {
                          if (onLocateEvidence) {
                            e.preventDefault();
                            onLocateEvidence(ref);
                          }
                        }}
                      >
                        {fileNameOf(ref)}
                      </Button>
                    </Tooltip>
                  ))}
                </Space>
              )}
              {v.reviewStatus === 'pending_review' && (
                <Space size={6} wrap>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={busy === v.id}
                    onClick={() => act(v.id, () => onApprove(v.id))}
                  >
                    通过
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<CloseOutlined />}
                    loading={busy === v.id}
                    onClick={() => {
                      setRejecting(v);
                      setRejectReason('');
                    }}
                  >
                    拒绝
                  </Button>
                  <Tooltip title="退回 B 阶段补采证据（按条款重跑）">
                    <Button
                      size="small"
                      icon={<RedoOutlined />}
                      loading={busy === v.id}
                      onClick={() => act(v.id, () => onRequestEvidence(v.clauseId))}
                    >
                      补采
                    </Button>
                  </Tooltip>
                </Space>
              )}
              {v.reviewNote && (
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                  审核备注：{v.reviewNote}
                </Typography.Text>
              )}
            </Card>
          )}
        />
      )}

      <Modal
        title="拒绝判定（需说明理由，将按条款重跑）"
        open={!!rejecting}
        onOk={async () => {
          if (!rejectReason.trim()) {
            message.warning('请填写拒绝理由');
            return;
          }
          if (rejecting) {
            await act(rejecting.id, () => onReject(rejecting.id, rejectReason));
          }
          setRejecting(null);
        }}
        onCancel={() => setRejecting(null)}
        okText="提交并按条款重跑"
        cancelText="取消"
        confirmLoading={busy === rejecting?.id}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          条款 {rejecting?.clauseId}：{rejecting?.reason}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          placeholder="拒绝理由，例如证据不足、判定与实际不符…"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
