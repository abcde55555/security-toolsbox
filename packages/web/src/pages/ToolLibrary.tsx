import { useEffect, useMemo, useState } from 'react';
import {
  Layout, Input, Select, Button, Card, Badge, Tag, Drawer, Descriptions, Space, Statistic,
  Empty, Spin, Typography, Tooltip, message,
} from 'antd';
import { ReloadOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { Tool } from '@en18031/shared';
import { ToolsApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { categoryLabel, healthColor, healthText, severityColor } from '../utils/ui';

const { Sider, Content } = Layout;

export default function ToolLibrary() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string>();
  const [category, setCategory] = useState<string>();
  const [selected, setSelected] = useState<Tool | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await ToolsApi.list({ keyword, type, category, pageSize: 200 });
      setTools(res.items);
      setTotal(res.total);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [type, category]);

  const stats = useMemo(() => ({
    total,
    modules: tools.filter((t) => t.type === 'module').length,
    custom: tools.filter((t) => t.type === 'custom').length,
    referenced: tools.filter((t) => t.referenceCount > 0).length,
  }), [tools, total]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tools) map.set(t.category, (map.get(t.category) ?? 0) + 1);
    return [...map.entries()].map(([key, count]) => ({ key, label: categoryLabel(key), count }));
  }, [tools]);

  const openDetail = (t: Tool) => {
    setSelected(t);
    setDrawerOpen(true);
  };

  const recheck = async () => {
    if (!selected) return;
    setRechecking(true);
    try {
      const r = await ToolsApi.healthCheck(selected.id);
      message.success(`健康检查完成：${healthText[r.healthStatus as keyof typeof healthText] ?? r.healthStatus}`);
      const fresh = await ToolsApi.get(selected.id);
      setSelected(fresh);
      void load();
    } catch (e) {
      reportError(e);
    } finally {
      setRechecking(false);
    }
  };

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      <Sider width={230} theme="light" style={{ borderRight: '1px solid #eef0f4', padding: 12, overflow: 'auto' }}>
        <Typography.Text strong>工具分类</Typography.Text>
        <div style={{ marginTop: 10 }}>
          <Card
            size="small"
            hoverable
            onClick={() => setCategory(undefined)}
            style={{ marginBottom: 6, borderColor: !category ? '#2563eb' : undefined }}
          >
            全部工具 <Tag>{total}</Tag>
          </Card>
          {categories.map((c) => (
            <Card
              key={c.key}
              size="small"
              hoverable
              onClick={() => setCategory(category === c.key ? undefined : c.key)}
              style={{ marginBottom: 6, borderColor: category === c.key ? '#2563eb' : undefined }}
            >
              {c.label} <Tag>{c.count}</Tag>
            </Card>
          ))}
        </div>
      </Sider>
      <Content style={{ padding: 16, overflow: 'auto' }}>
        <Space size={16} style={{ marginBottom: 16, width: '100%' }}>
          <Statistic title="工具总数" value={stats.total} />
          <Statistic title="内置模组" value={stats.modules} />
          <Statistic title="自定义工具" value={stats.custom} />
          <Statistic title="被模板引用" value={stats.referenced} />
        </Space>
        <Space style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索工具名称 / 描述"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => void load()}
          />
          <Select
            placeholder="类型"
            allowClear
            style={{ width: 140 }}
            value={type}
            onChange={setType}
            options={[
              { value: 'module', label: '内置模组' },
              { value: 'custom', label: '自定义命令' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} disabled>注册工具</Button>
        </Space>

        {loading ? (
          <Spin />
        ) : tools.length === 0 ? (
          <Empty description="暂无工具" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {tools.map((t) => (
              <Card key={t.id} className="tool-card" size="small" onClick={() => openDetail(t)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <Typography.Text strong ellipsis style={{ maxWidth: 180 }}>{t.name}</Typography.Text>
                  <Tooltip title={healthText[t.healthStatus]}>
                    <Badge color={healthColor[t.healthStatus]} />
                  </Tooltip>
                </div>
                <div style={{ margin: '6px 0' }}>
                  <Tag color={t.type === 'module' ? 'blue' : 'default'}>
                    {t.type === 'module' ? '内置模组' : '自定义命令'}
                  </Tag>
                  <Tag>{categoryLabel(t.category)}</Tag>
                  <Tag>v{t.version}</Tag>
                </div>
                <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 4, fontSize: 12 }}>
                  {t.description ?? t.path ?? ''}
                </Typography.Paragraph>
                {t.referenceCount > 0 && <Tag color="green">被 {t.referenceCount} 个模板引用</Tag>}
              </Card>
            ))}
          </div>
        )}
      </Content>

      <Drawer
        title={selected?.name}
        width={620}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Button icon={<SafetyCertificateOutlined />} loading={rechecking} onClick={() => void recheck()}>
            执行健康检查
          </Button>
        }
      >
        {selected && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="ID" span={2}>{selected.id}</Descriptions.Item>
              <Descriptions.Item label="版本">{selected.version}</Descriptions.Item>
              <Descriptions.Item label="类型">{selected.type === 'module' ? '内置模组' : '自定义命令'}</Descriptions.Item>
              <Descriptions.Item label="分类">{categoryLabel(selected.category)}</Descriptions.Item>
              <Descriptions.Item label="健康状态">
                <Badge color={healthColor[selected.healthStatus]} text={healthText[selected.healthStatus]} />
              </Descriptions.Item>
              <Descriptions.Item label="引用数">{selected.referenceCount}</Descriptions.Item>
              <Descriptions.Item label="SDK 版本">{selected.sdkVersion ?? '-'}</Descriptions.Item>
              {selected.path && <Descriptions.Item label="路径" span={2}>{selected.path}</Descriptions.Item>}
              {selected.healthCheck?.command && (
                <Descriptions.Item label="健康检查命令" span={2} className="mono">
                  {selected.healthCheck.command}
                </Descriptions.Item>
              )}
              {selected.healthMessage && (
                <Descriptions.Item label="健康检查输出" span={2}>{selected.healthMessage}</Descriptions.Item>
              )}
              <Descriptions.Item label="描述" span={2}>{selected.description ?? '-'}</Descriptions.Item>
            </Descriptions>

            {selected.clauses.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>判定条款 ({selected.clauses.length})</Typography.Title>
                {selected.clauses.map((c) => (
                  <Card key={c.clauseId} size="small" style={{ marginBottom: 8 }}>
                    <Space>
                      <Tag>{c.clauseId}</Tag>
                      <Tag color={severityColor(c.severity)}>{c.severity}</Tag>
                      <span>{c.title}</span>
                    </Space>
                  </Card>
                ))}
              </>
            )}

            {selected.formFields.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>参数表单 ({selected.formFields.length})</Typography.Title>
                {selected.formFields.map((f) => (
                  <Card key={f.id} size="small" style={{ marginBottom: 8 }}>
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Typography.Text strong>{f.label}</Typography.Text>
                        <Tag>{f.type}</Tag>
                        {f.required && <Tag color="red">必填</Tag>}
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        字段: {f.id}{f.placeholder ? ` · 占位: ${f.placeholder}` : ''}
                      </Typography.Text>
                      {f.description && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{f.description}</Typography.Text>}
                    </Space>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Drawer>
    </Layout>
  );
}
