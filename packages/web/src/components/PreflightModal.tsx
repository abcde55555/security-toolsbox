import { useEffect, useState } from 'react';
import { Modal, Button, List, Tag, Space, Typography, Alert, Spin, Card } from 'antd';
import { CheckCircleFilled, ExclamationCircleFilled, MinusCircleFilled } from '@ant-design/icons';
import { ProjectsApi, type PreflightResult } from '../api/endpoints';
import { reportError } from '../api/client';

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onConfirm: () => void;
}

export default function PreflightModal({ open, projectId, onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setResult(null);
    ProjectsApi.preflight(projectId)
      .then(setResult)
      .catch(reportError)
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const unavailable = result?.tools.filter((t) => !t.available) ?? [];
  const canProceed = result?.ready ?? false;

  return (
    <Modal
      title="运行前预检"
      open={open}
      onCancel={onClose}
      width={620}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            disabled={!canProceed || loading}
            onClick={onConfirm}
          >
            {unavailable.length > 0 ? `跳过 ${unavailable.length} 个不可用步骤并开始` : '开始测试'}
          </Button>
        </Space>
      }
    >
      {loading && <Spin tip="正在检查…" />}
      {result && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {/* Variables */}
          <Card size="small" title="项目变量">
            {result.variables.ok ? (
              <Space><CheckCircleFilled style={{ color: '#16a34a' }} /> 必填变量已齐全</Space>
            ) : (
              <Alert
                type="error" showIcon
                message={`缺少 ${result.variables.missing.length} 个必填变量`}
                description={
                  <span>
                    请先到「变量」标签页填写：
                    <strong>{result.variables.missing.join('、')}</strong>
                  </span>
                }
              />
            )}
            {result.variables.empty.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                未填写的可选变量：{result.variables.empty.join('、')}
              </Typography.Text>
            )}
          </Card>

          {/* Tools */}
          <Card size="small" title={`工具可用性 (${result.tools.length - unavailable.length}/${result.tools.length} 可用)`}>
            {result.tools.length === 0 ? (
              <Typography.Text type="secondary">该模板没有步骤</Typography.Text>
            ) : (
              <List
                size="small"
                dataSource={result.tools}
                renderItem={(t) => (
                  <List.Item>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Space>
                        {t.available ? (
                          <CheckCircleFilled style={{ color: '#16a34a' }} />
                        ) : (
                          <MinusCircleFilled style={{ color: '#d97706' }} />
                        )}
                        <span>{t.name}</span>
                        <Tag>{t.stepId}</Tag>
                      </Space>
                      {t.available ? (
                        <Tag color="green">{healthLabel(t.healthStatus)}</Tag>
                      ) : (
                        <Space>
                          <Tag color="orange">将跳过</Tag>
                          {t.message && (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {t.message}
                            </Typography.Text>
                          )}
                        </Space>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>

          {!result.ready && (
            <Alert
              type="warning" showIcon
              icon={<ExclamationCircleFilled />}
              message="有必填变量未填写，无法开始"
            />
          )}
          {result.ready && unavailable.length > 0 && (
            <Alert
              type="info" showIcon
              message={`${unavailable.length} 个工具不可用，对应步骤将被跳过，不影响其他步骤执行。`}
            />
          )}
        </Space>
      )}
    </Modal>
  );
}

function healthLabel(s: string): string {
  if (s === 'green') return '可用';
  if (s === 'yellow') return '版本不匹配';
  if (s === 'red') return '异常';
  return '未检查';
}
