import { useEffect, useState } from 'react';
import { Spin, Space, Typography, Tag, Empty } from 'antd';
import type { StepRunDetail } from '../../api/endpoints';
import { ProjectsApi } from '../../api/endpoints';
import { reportError } from '../../api/client';

/**
 * Shows stdout/stderr and verdicts for an orchestration step run.
 */
export default function StepRunOutput({
  stepRunId,
  projectRunId,
  projectId,
}: {
  stepRunId: string;
  projectRunId: string;
  projectId: string;
}) {
  const [detail, setDetail] = useState<StepRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ProjectsApi.getStep(projectId, projectRunId, stepRunId)
      .then(setDetail)
      .catch(reportError)
      .finally(() => setLoading(false));
  }, [stepRunId, projectRunId, projectId]);

  if (loading) return <Spin />;
  if (!detail) return <Empty description="无法加载步骤输出" />;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Tag color="blue">{detail.stepId}</Tag>
        <Tag>{detail.status}</Tag>
        {typeof detail.exitCode === 'number' && <Tag>退出码 {detail.exitCode}</Tag>}
        {detail.durationMs != null && <Tag>{Math.round(detail.durationMs)}ms</Tag>}
      </Space>

      {detail.stdout && (
        <div>
          <Typography.Text strong>stdout</Typography.Text>
          <pre className="terminal" style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
            {detail.stdout}
          </pre>
        </div>
      )}
      {detail.stderr && (
        <div>
          <Typography.Text strong type="danger">stderr</Typography.Text>
          <pre
            className="terminal"
            style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', color: '#fca5a5' }}
          >
            {detail.stderr}
          </pre>
        </div>
      )}
      {!detail.stdout && !detail.stderr && (
        <Empty description="该步骤没有输出" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Space>
  );
}
