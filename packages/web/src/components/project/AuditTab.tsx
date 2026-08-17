import { useCallback, useEffect, useRef, useState } from 'react';
import { Table, Tag, Input, Select, DatePicker, Space, Button, Card } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { AuditLog } from '@en18031/shared';
import { ProjectsApi } from '../../api/endpoints';
import { reportError } from '../../api/client';
import { auditActionText } from '../../utils/ui';

const { RangePicker } = DatePicker;

type MaybeDate = { toISOString: () => string } | null;

interface AuditTabProps {
  projectId: string;
  /** 当此值变化时刷新（如运行结束） */
  refreshKey?: number;
}

const ACTION_OPTIONS = Object.entries(auditActionText).map(([value, label]) => ({ value, label }));

export default function AuditTab({ projectId, refreshKey }: AuditTabProps) {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [action, setAction] = useState<string>();
  const [dateRange, setDateRange] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const loadSeq = useRef(0);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedKeyword(keyword);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        pageSize: String(pageSize),
      };
      if (debouncedKeyword.trim()) params.keyword = debouncedKeyword.trim();
      if (action) params.action = action;
      const range = dateRange as [MaybeDate, MaybeDate] | null;
      if (range?.[0]) params.since = range[0].toISOString();
      if (range?.[1]) params.until = range[1].toISOString();
      const res = await ProjectsApi.logs(projectId, params);
      if (seq !== loadSeq.current) return;
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      reportError(e);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [projectId, page, pageSize, debouncedKeyword, action, dateRange]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <Card
      title="审计日志"
      extra={
        <Button icon={<ReloadOutlined />} aria-label="刷新审计日志" onClick={() => void load()}>刷新</Button>
      }
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          placeholder="搜索关键词"
          allowClear
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          placeholder="动作类型"
          allowClear
          style={{ width: 200 }}
          value={action}
          onChange={(v) => { setAction(v); setPage(1); }}
          options={ACTION_OPTIONS}
        />
        <RangePicker
          showTime
          value={dateRange as React.ComponentProps<typeof RangePicker>['value']}
          onChange={(v) => { setDateRange(v); setPage(1); }}
        />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={items}
        pagination={{
          current: page, pageSize, total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 180, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
          { title: '用户', dataIndex: 'userId', width: 120 },
          { title: '动作', dataIndex: 'action', render: (v: string) => <Tag>{auditActionText[v] ?? v}</Tag> },
          { title: '对象', key: 'ent', render: (_, r) => <span className="mono">{r.entityType}:{r.entityId}</span> },
          { title: 'IP', dataIndex: 'ip', width: 140 },
        ]}
        scroll={{ x: 720 }}
      />
    </Card>
  );
}
