import { useMemo, useState } from 'react';
import { Card, Tag, Space, Typography, Collapse, Button, Tooltip } from 'antd';
import {
  CodeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import Terminal, { type TerminalLine } from '../Terminal';
import type { ToolCallState } from './types';
import { outputToLines, fileNameOf } from './utils';
import { formatDuration } from '../../utils/ui';

function statusTag(status?: string) {
  if (!status || status === 'running') return <Tag icon={<LoadingOutlined />} color="processing">运行中</Tag>;
  if (status === 'success') return <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>;
  if (status === 'fail' || status === 'error') return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>;
  if (status === 'timeout') return <Tag color="warning">超时</Tag>;
  if (status === 'cancelled') return <Tag>已取消</Tag>;
  return <Tag>{status}</Tag>;
}

export default function ToolCallCard({
  tool,
  onOpenEvidence,
  defaultOpen,
}: {
  tool: ToolCallState;
  onOpenEvidence?: (ref: string) => void;
  defaultOpen?: boolean;
}) {
  const lines = useMemo<TerminalLine[]>(() => {
    const out = outputToLines(tool.stdout || tool.output, 'stdout');
    const err = outputToLines(tool.stderr, 'stderr');
    // Merge preserving rough order is not necessary for display; show stdout then stderr.
    return [...out, ...err];
  }, [tool.stdout, tool.stderr, tool.output]);

  const running = tool.status === 'running' || !tool.status;
  const hasArgs = tool.args && Object.keys(tool.args).length > 0;
  // 默认折叠：仅运行中的卡片自动展开输出区；点击可随时展开/收起
  const [openKeys, setOpenKeys] = useState<string[]>(running ? ['output'] : []);

  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      styles={{ body: { padding: '8px 12px' } }}
      title={
        <Space size={6} wrap>
          <CodeOutlined />
          <Typography.Text strong>{tool.toolName}</Typography.Text>
          {statusTag(tool.status)}
          {tool.exitCode !== undefined && (
            <Tag color={tool.exitCode === 0 ? 'green' : 'red'}>退出码 {tool.exitCode}</Tag>
          )}
          {tool.durationMs !== undefined && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatDuration(tool.durationMs)}
            </Typography.Text>
          )}
        </Space>
      }
    >
      <Collapse
        size="small"
        ghost
        activeKey={defaultOpen ? [...new Set([...openKeys, 'args', 'output'])] : openKeys}
        onChange={(keys) => setOpenKeys(Array.isArray(keys) ? keys : [keys])}
        items={[
          ...(hasArgs
            ? [
                {
                  key: 'args',
                  label: <Typography.Text type="secondary" style={{ fontSize: 12 }}>入参</Typography.Text>,
                  children: (
                    <pre style={{ margin: 0, maxHeight: 200, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 4, fontSize: 12 }}>
                      {JSON.stringify(tool.args, null, 2)}
                    </pre>
                  ),
                },
              ]
            : []),
          {
            key: 'output',
            label: <Typography.Text type="secondary" style={{ fontSize: 12 }}>输出{lines.length > 0 ? `（${lines.length} 行）` : ''}</Typography.Text>,
            children: (
              <Terminal lines={lines} height={180} empty={running ? '等待工具输出…' : '无输出'} truncated={lines.length > 1500} />
            ),
          },
        ]}
      />
      {tool.error?.message && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          {tool.error.message}
        </Typography.Text>
      )}
      {(tool.evidenceRefs?.length || tool.artifactRefs?.length) ? (
        <Space size={6} wrap style={{ marginTop: 8 }}>
          {tool.evidenceRefs?.map((ref) => (
            <Tooltip title={ref} key={ref}>
              <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => onOpenEvidence?.(ref)}>
                {fileNameOf(ref)}
              </Button>
            </Tooltip>
          ))}
          {tool.artifactRefs?.map((ref) => (
            <Tooltip title={ref} key={ref}>
              <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => onOpenEvidence?.(ref)}>
                {fileNameOf(ref)}
              </Button>
            </Tooltip>
          ))}
        </Space>
      ) : null}
    </Card>
  );
}
