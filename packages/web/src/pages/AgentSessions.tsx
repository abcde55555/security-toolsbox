import { useCallback, useEffect, useState } from 'react';
import { Layout, Typography, Button, Table, Tag, Space, Card } from 'antd';
import { PlusOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { AgentSession } from '@en18031/shared';
import { AgentApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { SESSION_STATUS_META, phaseMeta } from '../components/agent/utils';

const { Content } = Layout;

export default function AgentSessions() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await AgentApi.list({ pageSize: 100 });
      setItems(res.items);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Content style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <RobotOutlined /> Agent 测试会话
        </Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/agent/new')}>
            新建会话
          </Button>
        </Space>
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<AgentSession>
          rowKey="id"
          loading={loading}
          dataSource={items}
          size="middle"
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(r) => ({ onClick: () => navigate(`/agent/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: '会话',
              dataIndex: 'id',
              render: (id: string) => <Typography.Text copyable={{ text: id }}>{id.slice(0, 8)}</Typography.Text>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 130,
              render: (s: AgentSession['status']) => {
                const meta = SESSION_STATUS_META[s];
                return <Tag color={meta?.color}>{meta?.label ?? s}</Tag>;
              },
            },
            {
              title: '阶段',
              dataIndex: 'phase',
              width: 150,
              render: (p: AgentSession['phase']) => {
                const m = phaseMeta(p);
                return <Tag color={m.color}>{m.label}</Tag>;
              },
            },
            {
              title: '设备',
              key: 'device',
              render: (_, r) => {
                const brand = (r.deviceProfile?.brand as string) ?? '';
                const model = (r.deviceProfile?.model as string) ?? '';
                return brand || model ? `${brand} ${model}`.trim() : <Typography.Text type="secondary">未填写</Typography.Text>;
              },
            },
            {
              title: '条款数',
              dataIndex: 'selectedClauses',
              width: 90,
              render: (c: string[]) => c?.length ?? 0,
            },
            {
              title: '回退',
              dataIndex: 'rollbackCount',
              width: 80,
              render: (n: number) => (n > 0 ? <Tag color="orange">{n}</Tag> : 0),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 170,
              render: (t: string) => new Date(t).toLocaleString(),
            },
          ]}
        />
      </Card>
    </Content>
  );
}
