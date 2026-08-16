import { useEffect, useMemo, useState } from 'react';
import {
  Layout, Input, Select, Button, Card, Badge, Tag, Drawer, Descriptions, Space, Statistic,
  Empty, Spin, Typography, Tooltip, message, Popconfirm,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, SafetyCertificateOutlined, ThunderboltOutlined,
  CopyOutlined, AppstoreOutlined, CodeOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import type { Tool, ToolCommand } from '@en18031/shared';
import { ToolsApi } from '../api/endpoints';
import { reportError } from '../api/client';
import {
  categoryLabel, categoryLabels, healthColor, healthText, healthLegend, severityColor, severityText,
} from '../utils/ui';
import RunCommandModal from '../components/RunCommandModal';
import ToolEditorDrawer from '../components/ToolEditorDrawer';

const { Sider, Content } = Layout;

function isCommandManual(t: Tool): boolean {
  return t.type === 'custom' && !!t.commands && t.commands.length > 0;
}

export default function ToolLibrary() {
  const [allTools, setAllTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string>();
  const [category, setCategory] = useState<string>();
  const [selected, setSelected] = useState<Tool | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [runCmd, setRunCmd] = useState<{ tool: Tool; command: ToolCommand } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await ToolsApi.list({ pageSize: 200 });
      setAllTools(res.items);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const tools = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return allTools.filter((t) => {
      if (type === 'module' && t.type !== 'module') return false;
      if (type === 'custom' && t.type !== 'custom') return false;
      if (category && t.category !== category) return false;
      if (kw && !(`${t.name} ${t.description ?? ''} ${t.id}`.toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [allTools, keyword, type, category]);

  const stats = useMemo(() => ({
    total: allTools.length,
    modules: allTools.filter((t) => t.type === 'module').length,
    manuals: allTools.filter(isCommandManual).length,
    referenced: allTools.filter((t) => t.referenceCount > 0).length,
  }), [allTools]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of allTools) map.set(t.category, (map.get(t.category) ?? 0) + 1);
    return map;
  }, [allTools]);

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

  const openEditor = (t: Tool | null) => {
    setEditingTool(t);
    setEditorOpen(true);
  };

  const deleteTool = async (t: Tool) => {
    try {
      await ToolsApi.remove(t.id);
      message.success('工具已删除');
      setDrawerOpen(false);
      setSelected(null);
      void load();
    } catch (e) {
      reportError(e);
    }
  };

  const deleteCommand = async (t: Tool, commandId: string) => {
    try {
      await ToolsApi.update(t.id, { commands: (t.commands ?? []).filter((c) => c.id !== commandId) });
      message.success('命令已删除');
      const fresh = await ToolsApi.get(t.id);
      setSelected(fresh);
      void load();
    } catch (e) {
      reportError(e);
    }
  };

  const copyCommand = (cmd: ToolCommand) => {
    const defaults: Record<string, unknown> = {};
    for (const f of cmd.params) if (f.value !== undefined) defaults[f.id] = f.value;
    void navigator.clipboard?.writeText(cmd.commandTemplate.replace(
      /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g,
      (_m, key: string) => (defaults[key] !== undefined ? String(defaults[key]) : `{{${key}}}`),
    ));
    message.success('命令模板已复制（含默认值）');
  };

  const refreshSelected = async () => {
    if (runCmd) {
      try {
        const fresh = await ToolsApi.get(runCmd.tool.id);
        setSelected(fresh);
        setRunCmd((prev) => (prev ? { tool: fresh, command: prev.command } : prev));
      } catch {
        // ignore
      }
    }
    void load();
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
            全部工具 <Tag>{stats.total}</Tag>
          </Card>
          {categoryLabels.map((c) => (
            <Card
              key={c.key}
              size="small"
              hoverable
              onClick={() => setCategory(category === c.key ? undefined : c.key)}
              style={{ marginBottom: 6, borderColor: category === c.key ? '#2563eb' : undefined }}
            >
              {c.label} <Tag>{categoryCounts.get(c.key) ?? 0}</Tag>
            </Card>
          ))}
        </div>
      </Sider>
      <Content style={{ padding: 16, overflow: 'auto' }}>
        <Space size={16} style={{ marginBottom: 8, width: '100%' }}>
          <Statistic title="工具总数" value={stats.total} />
          <Statistic title="内置模组" value={stats.modules} />
          <Statistic title="命令手册" value={stats.manuals} />
          <Statistic title="被模板引用" value={stats.referenced} />
        </Space>
        <Space size={16} style={{ marginBottom: 16, width: '100%', color: '#64748b', fontSize: 12 }}>
          <span>健康状态：</span>
          {healthLegend.map((h) => (
            <span key={h.status}><Badge color={h.color} text={h.text} /></span>
          ))}
        </Space>
        <Space style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索工具名称 / 描述"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => { /* client-side filter */ }}
          />
          <Select
            placeholder="类型"
            allowClear
            style={{ width: 150 }}
            value={type}
            onChange={setType}
            options={[
              { value: 'module', label: '内置模组' },
              { value: 'custom', label: '命令手册/自定义' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>注册工具</Button>
        </Space>

        {loading ? (
          <Spin />
        ) : tools.length === 0 ? (
          <Empty description="暂无工具" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
            {tools.map((t) => {
              const manual = isCommandManual(t);
              return (
                <Card key={t.id} className="tool-card" size="small" onClick={() => openDetail(t)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                    <Typography.Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>{t.name}</Typography.Text>
                    <Tooltip title={healthText[t.healthStatus]}>
                      <Badge color={healthColor[t.healthStatus]} />
                    </Tooltip>
                  </div>
                  <div style={{ margin: '6px 0' }}>
                    {t.type === 'module' ? (
                      <Tag color="blue" icon={<AppstoreOutlined />}>内置模组</Tag>
                    ) : manual ? (
                      <Tag color="purple" icon={<CodeOutlined />}>命令手册</Tag>
                    ) : (
                      <Tag>自定义</Tag>
                    )}
                    {manual && <Tag color="geekblue">{(t.commands ?? []).length} 条命令</Tag>}
                    <Tag>{categoryLabel(t.category)}</Tag>
                    <Tag>v{t.version}</Tag>
                  </div>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 4, fontSize: 12 }}>
                    {t.description ?? t.path ?? ''}
                  </Typography.Paragraph>
                  {manual && (
                    <Space size={4} onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="small" type="link" icon={<ThunderboltOutlined />}
                        onClick={() => setRunCmd({ tool: t, command: t.commands![0] })}
                      >运行</Button>
                    </Space>
                  )}
                  {t.referenceCount > 0 && <Tag color="green" style={{ marginTop: 4 }}>被 {t.referenceCount} 个模板引用</Tag>}
                </Card>
              );
            })}
          </div>
        )}
      </Content>

      <Drawer
        title={selected?.name}
        width={640}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          <Space>
            <Button icon={<SafetyCertificateOutlined />} loading={rechecking} onClick={() => void recheck()}>
              执行健康检查
            </Button>
            {selected && !selected.builtin && (
              <Button icon={<EditOutlined />} onClick={() => openEditor(selected)}>编辑</Button>
            )}
            {selected && !selected.builtin && (
              <Popconfirm
                title="删除该工具？"
                description="工具下的命令会一并删除，运行历史记录保留。"
                okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                onConfirm={() => void deleteTool(selected)}
              >
                <Button danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        {selected && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="ID" span={2}>{selected.id}</Descriptions.Item>
              <Descriptions.Item label="版本">{selected.version}</Descriptions.Item>
              <Descriptions.Item label="类型">
                {selected.type === 'module' ? '内置模组' : isCommandManual(selected) ? '命令手册' : '自定义命令'}
              </Descriptions.Item>
              <Descriptions.Item label="分类">{categoryLabel(selected.category)}</Descriptions.Item>
              <Descriptions.Item label="健康状态">
                <Badge color={healthColor[selected.healthStatus]} text={healthText[selected.healthStatus]} />
              </Descriptions.Item>
              <Descriptions.Item label="引用数">{selected.referenceCount}</Descriptions.Item>
              <Descriptions.Item label="SDK 版本">{selected.sdkVersion ?? '-'}</Descriptions.Item>
              {selected.path && <Descriptions.Item label="路径" span={2}>{selected.path}</Descriptions.Item>}
              {selected.setupCommand && (
                <Descriptions.Item label="环境激活命令" span={2}>
                  <Typography.Text className="mono" style={{ fontSize: 12 }}>{selected.setupCommand}</Typography.Text>
                </Descriptions.Item>
              )}
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

            {(selected.commands ?? []).length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>
                  命令 ({selected.commands!.length})
                </Typography.Title>
                {selected.commands!.map((c) => (
                  <Card key={c.id} size="small" style={{ marginBottom: 10 }} bodyStyle={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
                        <Space>
                          <Typography.Text strong>{c.name}</Typography.Text>
                          {c.requiresRoot && <Tag color="red">需 root</Tag>}
                          {c.platforms?.map((p) => <Tag key={p}>{p}</Tag>)}
                          {c.timeoutMs && <Tag>超时 {Math.round(c.timeoutMs / 1000)}s</Tag>}
                        </Space>
                        <Typography.Text className="mono" style={{ fontSize: 12, color: '#334155' }}>
                          {c.commandTemplate}
                        </Typography.Text>
                        {c.description && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{c.description}</Typography.Text>
                        )}
                      </Space>
                      <Space direction="vertical" size={4}>
                        <Button
                          size="small" type="primary" icon={<ThunderboltOutlined />}
                          onClick={() => setRunCmd({ tool: selected, command: c })}
                        >运行</Button>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyCommand(c)}>复制</Button>
                        {!selected.builtin && (
                          <>
                            <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(selected)}>编辑</Button>
                            <Popconfirm
                              title="删除这条命令？"
                              onConfirm={() => void deleteCommand(selected, c.id)}
                              okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>
                          </>
                        )}
                      </Space>
                    </div>
                    {c.outputTips && (
                      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                        {c.outputTips}
                      </Typography.Paragraph>
                    )}
                  </Card>
                ))}
                {!selected.builtin && (
                  <Button type="dashed" icon={<PlusOutlined />} block onClick={() => openEditor(selected)}>
                    新增命令
                  </Button>
                )}
              </>
            )}

            {selected.clauses.length > 0 && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>判定条款 ({selected.clauses.length})</Typography.Title>
                {selected.clauses.map((c) => (
                  <Card key={c.clauseId} size="small" style={{ marginBottom: 8 }}>
                    <Space>
                      <Tag>{c.clauseId}</Tag>
                      <Tag color={severityColor(c.severity)}>{severityText[c.severity] ?? c.severity}</Tag>
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
                    </Space>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </Drawer>

      {runCmd && (
        <RunCommandModal
          open
          tool={runCmd.tool}
          command={runCmd.command}
          onClose={() => { setRunCmd(null); void refreshSelected(); }}
          onChanged={() => void load()}
        />
      )}

      <ToolEditorDrawer
        open={editorOpen}
        tool={editingTool}
        onClose={() => { setEditorOpen(false); setEditingTool(null); }}
        onSaved={() => {
          setEditorOpen(false);
          setEditingTool(null);
          void load().then(async () => {
            if (editingTool) {
              try {
                const fresh = await ToolsApi.get(editingTool.id);
                setSelected(fresh);
              } catch { /* ignore */ }
            }
          });
        }}
      />
    </Layout>
  );
}
