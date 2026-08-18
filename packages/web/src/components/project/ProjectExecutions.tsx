import { useEffect, useState } from 'react';
import { Table, Tag, Space, Typography, Empty, Button, Drawer, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { UnifiedExecution } from '../../api/endpoints';
import { ProjectsApi } from '../../api/endpoints';
import { reportError } from '../../api/client';
import { commandRunStatusColor, commandRunStatusText, formatDuration } from '../../utils/ui';
import StepRunOutput from './StepRunOutput';

const NON_TERMINAL = new Set(['pending', 'running', 'scheduled']);

/**
 * Unified tool-execution history for a project: orchestration step runs plus
 * manual command runs, newest first.
 */
export default function ProjectExecutions({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [items, setItems] = useState<UnifiedExecution[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<UnifiedExecution | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await ProjectsApi.executions(projectId, { page, pageSize });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, projectId, refreshKey]);

  const hasLive = items.some((r) => NON_TERMINAL.has(r.status));
  useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLive, page, pageSize, projectId, refreshKey]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'startedAt',
      width: 170,
      render: (v?: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (s: string) =>
        s === 'orchestration' ? <Tag color="purple">编排步骤</Tag> : <Tag color="cyan">单独执行</Tag>,
    },
    {
      title: '工具',
      dataIndex: 'toolName',
      ellipsis: true,
      render: (name: string, r: UnifiedExecution) => (
        <Space direction="vertical" size={0}>
          <span>{name || r.toolId}</span>
          {r.commandName && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {r.commandName}
            </Typography.Text>
          )}
          {r.source === 'orchestration' && r.title && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {r.title}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => (
        <Tag color={commandRunStatusColor[s] ?? 'default'}>{commandRunStatusText[s] ?? s}</Tag>
      ),
    },
    {
      title: '退出码',
      dataIndex: 'exitCode',
      width: 80,
      render: (v?: number) => v ?? '-',
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (v?: number) => (v ? formatDuration(v) : '-'),
    },
    {
      title: '结果',
      key: 'results',
      width: 120,
      render: (_: unknown, r: UnifiedExecution) => (
        <Space size={4}>
          {r.verdictCount > 0 && <Tag color="green">{r.verdictCount} 判定</Tag>}
          {r.evidenceCount > 0 && <Tag>{r.evidenceCount} 证据</Tag>}
          {!r.verdictCount && !r.evidenceCount && r.source === 'orchestration' && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>-</Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '',
      key: 'op',
      width: 80,
      render: (_: unknown, r: UnifiedExecution) => (
        <Button
          size="small"
          onClick={() => {
            setActive(r);
            setOutputOpen(true);
          }}
        >
          输出
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          包含编排步骤和单独执行的工具运行
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        locale={{ emptyText: <Empty description="暂无工具执行记录" /> }}
      />
      <Drawer
        title={active ? `${active.toolName} · ${active.commandName ?? active.title ?? ''}` : '执行输出'}
        open={outputOpen}
        onClose={() => setOutputOpen(false)}
        width={720}
      >
        {active ? (
          active.source === 'orchestration' ? (
            <StepRunOutput
              stepRunId={active.id}
              projectRunId={active.runId}
              projectId={projectId}
            />
          ) : (
            <ManualRunOutput runId={active.id} />
          )
        ) : (
          <Spin />
        )}
      </Drawer>
    </div>
  );
}

function ManualRunOutput({ runId }: { runId: string }) {
  const [data, setData] = useState<{ stdout?: string; stderr?: string; resolvedCommand?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    CommandRunsApiGet(runId)
      .then((d) => setData(d))
      .catch(reportError)
      .finally(() => setLoading(false));
  }, [runId]);
  if (loading) return <Spin />;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {data?.resolvedCommand && (
        <pre className="terminal" style={{ margin: 0 }}>
          $ {data.resolvedCommand}
        </pre>
      )}
      {data?.stdout && (
        <div>
          <Typography.Text strong>stdout</Typography.Text>
          <pre className="terminal" style={{ whiteSpace: 'pre-wrap' }}>{data.stdout}</pre>
        </div>
      )}
      {data?.stderr && (
        <div>
          <Typography.Text strong type="danger">stderr</Typography.Text>
          <pre className="terminal" style={{ whiteSpace: 'pre-wrap', color: '#fca5a5' }}>{data.stderr}</pre>
        </div>
      )}
    </Space>
  );
}

// Lazy import to avoid circular deps at module load.
async function CommandRunsApiGet(runId: string) {
  const { CommandRunsApi } = await import('../../api/endpoints');
  return CommandRunsApi.get(runId);
}
