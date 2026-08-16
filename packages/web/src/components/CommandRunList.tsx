import { useEffect, useMemo, useState } from 'react';
import {
  Table, Tag, Select, Input, Space, Button, Drawer, Typography, Tooltip, Empty,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@en18031/shared';
import { CommandRunsApi, ProjectsApi, type CommandRunDetail as CommandRunDetailDTO } from '../api/endpoints';
import { reportError } from '../api/client';
import { commandRunStatusColor, commandRunStatusText, formatDuration } from '../utils/ui';
import CommandRunDetail from './CommandRunDetail';

const NON_TERMINAL = new Set(['pending', 'running']);
const STATUS_OPTIONS = [
  { value: 'running', label: '运行中' },
  { value: 'success', label: '成功' },
  { value: 'fail', label: '失败' },
  { value: 'timeout', label: '超时' },
  { value: 'crash', label: '崩溃' },
  { value: 'cancelled', label: '已取消' },
];

export default function CommandRunList({ projectId, height }: { projectId?: string; height?: number | string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<CommandRunDetailDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [projects, setProjects] = useState<Project[]>([]);

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (id?: string | null) => id ? (map.get(id) ?? `${id.slice(0, 8)}…`) : '独立运行';
  }, [projects]);

  async function load() {
    setLoading(true);
    try {
      const res = await CommandRunsApi.list({
        page, pageSize, projectId, status, keyword: keyword.trim() || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, pageSize, projectId, status]);
  useEffect(() => {
    void ProjectsApi.list().then(setProjects).catch(() => {});
  }, []);

  // auto-refresh while any row is non-terminal
  const hasLive = items.some((r) => NON_TERMINAL.has(r.status));
  useEffect(() => {
    if (!hasLive) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [hasLive, page, pageSize, projectId, status, keyword]);

  const columns = [
    {
      title: '时间', dataIndex: 'createdAt', width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '工具', dataIndex: 'toolName', ellipsis: true,
      render: (v: string, r: CommandRunDetailDTO) => (
        <Tooltip title={r.toolId}>
          <Typography.Text strong>{v}</Typography.Text>
        </Tooltip>
      ),
    },
    { title: '命令', dataIndex: 'commandName', width: 160, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => (
        <Tag color={commandRunStatusColor[v]}>{commandRunStatusText[v] ?? v}</Tag>
      ),
    },
    {
      title: '退出码', dataIndex: 'exitCode', width: 90,
      render: (v?: number) => v === undefined ? <Typography.Text type="secondary">-</Typography.Text> : v,
    },
    {
      title: '耗时', dataIndex: 'durationMs', width: 90,
      render: (v?: number) => formatDuration(v),
    },
    {
      title: '项目', dataIndex: 'projectId', width: 140, ellipsis: true,
      render: (v?: string | null) => <Tag>{projectName(v)}</Tag>,
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          placeholder="搜索工具/命令"
          allowClear
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => { setPage(1); void load(); }}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 140 }}
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={STATUS_OPTIONS}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        columns={columns}
        onRow={(r) => ({ onClick: () => setActiveId(r.id), style: { cursor: 'pointer' } })}
        scroll={height ? { y: height } : undefined}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        locale={{ emptyText: <Empty description="暂无执行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />

      <Drawer
        title="执行记录详情"
        width={720}
        open={!!activeId}
        onClose={() => setActiveId(undefined)}
        destroyOnClose
      >
        {activeId && (
          <CommandRunDetail
            runId={activeId}
            onChanged={() => void load()}
            onRerun={(rid) => { setActiveId(rid); void load(); }}
          />
        )}
      </Drawer>
    </div>
  );
}
