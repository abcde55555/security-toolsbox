import { useEffect, useMemo, useState } from 'react';
import {
  Layout, Card, Button, Tag, Space, Typography, Empty, Spin, Table, Modal, Form, Input,
  Select, message, Popconfirm, Tabs, Tooltip,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, CodeOutlined,
  SaveOutlined, ApiOutlined, ExpandAltOutlined, CompressOutlined,
} from '@ant-design/icons';
import type { Clause, ClauseNode, ClauseMappingRule, Tool, Standard } from '@en18031/shared';
import { ClausesApi, ToolsApi, StandardsApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { severityText } from '../utils/ui';

const { Content, Sider } = Layout;
const { TextArea } = Input;

const SEVERITY_OPTIONS = [
  { value: 'high', label: '高 (high)' },
  { value: 'middle', label: '中 (middle)' },
  { value: 'low', label: '低 (low)' },
];
const LEVEL_OPTIONS = [
  { value: 'L1', label: 'L1 - 基础' },
  { value: 'L2', label: 'L2 - 标准' },
  { value: 'L3', label: 'L3 - 增强' },
];

export default function Clauses() {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [activeStd, setActiveStd] = useState<string>('');
  const [tree, setTree] = useState<ClauseNode[]>([]);
  const [loading, setLoading] = useState(false);

  const [stdModal, setStdModal] = useState<{ mode: 'create' | 'edit'; std: Partial<Standard> | null }>({ mode: 'create', std: null });
  const [stdForm] = Form.useForm();

  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; clause: Partial<Clause> | null }>({ mode: 'create', clause: null });
  const [form] = Form.useForm();

  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);

  const loadStandards = async () => {
    try {
      const ss = await StandardsApi.list();
      setStandards(ss);
      if (!activeStd && ss.length) setActiveStd(ss[0].id);
    } catch (e) { reportError(e); }
  };

  const loadClauses = async (stdId: string) => {
    if (!stdId) { setTree([]); return; }
    setLoading(true);
    try {
      const nodes = await ClausesApi.tree(stdId);
      setTree(nodes);
      // 默认展开全部节点，深层编号也能直接看到
      setExpandedKeys(collectKeys(nodes));
    } catch (e) { reportError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadStandards(); }, []);
  useEffect(() => { if (activeStd) void loadClauses(activeStd); }, [activeStd]);
  useEffect(() => { setPage(1); }, [activeStd]);

  const roots = useMemo(() => tree.filter((n) => !n.parentId), [tree]);

  const collectKeys = (nodes: ClauseNode[]): string[] => {
    const out: string[] = [];
    for (const n of nodes) {
      out.push(n.clauseId);
      if (n.children?.length) out.push(...collectKeys(n.children));
    }
    return out;
  };

  const pagedRoots = useMemo(() => {
    const start = (page - 1) * pageSize;
    return roots.slice(start, start + pageSize);
  }, [roots, page, pageSize]);

  const allExpanded = useMemo(() => {
    const keys = new Set(expandedKeys);
    return roots.length > 0 && collectKeys(roots).every((k) => keys.has(k));
  }, [roots, expandedKeys]);

  const toggleAll = () => {
    setExpandedKeys(allExpanded ? [] : collectKeys(roots));
  };

  const flatClauses = useMemo(() => {
    const out: Clause[] = [];
    const walk = (nodes: ClauseNode[]) => { for (const n of nodes) { out.push(n); if (n.children) walk(n.children); } };
    walk(tree);
    return out;
  }, [tree]);

  const activeStandard = standards.find((s) => s.id === activeStd);

  // ---- standard CRUD ----
  const openCreateStd = () => {
    stdForm.resetFields();
    setStdModal({ mode: 'create', std: { code: '', version: '1.0' } });
  };
  const openEditStd = (s: Standard) => {
    stdForm.setFieldsValue(s);
    setStdModal({ mode: 'edit', std: s });
  };
  const saveStd = async () => {
    const v = await stdForm.validateFields();
    try {
      if (stdModal.mode === 'create') {
        const id = v.id || `${v.code}:${v.version}`.toUpperCase();
        await StandardsApi.create({ ...v, id });
        message.success('标准已创建');
        await loadStandards();
        setActiveStd(id);
      } else if (stdModal.std?.id) {
        await StandardsApi.update(stdModal.std.id, v);
        message.success('标准已更新');
        await loadStandards();
      }
      setStdModal({ mode: 'create', std: null });
    } catch (e) { reportError(e); }
  };
  const removeStd = async (s: Standard) => {
    try {
      await StandardsApi.remove(s.id);
      message.success('标准已删除');
      if (activeStd === s.id) setActiveStd('');
      await loadStandards();
    } catch (e) { reportError(e); }
  };

  // ---- clause CRUD ----
  const parentOptions = useMemo(() => {
    // Parent candidates: any clause in the tree, shown with indentation so
    // deeper levels (e.g. 5.1.1) can be created under a sub-clause.
    const out: { value: string; label: string }[] = [];
    const walk = (nodes: ClauseNode[], depth: number) => {
      for (const n of nodes) {
        out.push({
          value: n.clauseId,
          label: `${'└ '.repeat(depth)}${n.clauseId} ${n.title}`,
        });
        if (n.children?.length) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  const openCreateClause = (parentId?: string) => {
    form.resetFields();
    setEditor({ mode: 'create', clause: { level: 'L1', defaultSeverity: 'middle', parentId, chapter: parentId ?? '' } });
  };
  const openEditClause = (c: Clause) => {
    setEditor({ mode: 'edit', clause: c });
    form.setFieldsValue(c);
  };
  const saveClause = async () => {
    const v = await form.validateFields();
    try {
      if (editor.mode === 'create') {
        await ClausesApi.create({ ...v, standardVersion: activeStd }, activeStd);
        message.success('条款已创建');
      } else if (editor.clause?.clauseId) {
        await ClausesApi.update(editor.clause.clauseId, v, activeStd);
        message.success('条款已更新');
      }
      setEditor({ mode: 'create', clause: null });
      await loadClauses(activeStd);
    } catch (e) { reportError(e); }
  };
  const removeClause = async (c: Clause) => {
    try {
      await ClausesApi.remove(c.clauseId, activeStd);
      message.success('已删除');
      await loadClauses(activeStd);
    } catch (e) { reportError(e); }
  };

  const openJson = async () => {
    setJsonText(JSON.stringify(flatClauses.map((c) => { const { children: _drop, ...rest } = c as Clause & { children?: unknown }; return rest; }), null, 2));
    setJsonOpen(true);
  };
  const importJson = async () => {
    try {
      const arr = JSON.parse(jsonText);
      if (!Array.isArray(arr)) { message.error('需要条款数组 JSON'); return; }
      // Import into the currently viewed standard when clauses omit one.
      const res = await ClausesApi.batchImport(arr, activeStd);
      if (res.errors.length > 0) {
        message.warning(`导入 ${res.imported}/${res.total} 条，${res.errors.length} 条失败`);
        Modal.warning({
          title: '部分条款导入失败',
          width: 560,
          content: (
            <ul style={{ maxHeight: 300, overflow: 'auto', margin: 0, paddingLeft: 18 }}>
              {res.errors.map((e, i) => (
                <li key={i}>
                  第 {e.index + 1} 条{e.clauseId ? ` (${e.clauseId})` : ''}：{e.error}
                </li>
              ))}
            </ul>
          ),
        });
      } else {
        message.success(`已导入 ${res.imported} 条条款`);
      }
      setJsonOpen(false);
      await loadClauses(activeStd);
    } catch (e) {
      if (e instanceof SyntaxError) message.error('JSON 格式错误');
      else reportError(e);
    }
  };

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      <Sider width={260} theme="light" style={{ borderRight: '1px solid #eef0f4', padding: 12, overflow: 'auto' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>合规标准</Typography.Text>
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadStandards()} />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateStd} />
          </Space>
        </Space>
        {standards.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="尚无标准"
            style={{ marginTop: 24 }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateStd}>新建标准</Button>
          </Empty>
        ) : (
          standards.map((s) => (
            <Card
              key={s.id}
              size="small"
              hoverable
              onClick={() => setActiveStd(s.id)}
              style={{
                marginBottom: 8,
                borderColor: activeStd === s.id ? '#2563eb' : undefined,
                borderWidth: activeStd === s.id ? 2 : 1,
                cursor: 'pointer',
              }}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => e.key === 'Enter' && setActiveStd(s.id)}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Typography.Text strong>{s.code}</Typography.Text>
                  <Tag>{s.version}</Tag>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.name}</Typography.Text>
                {activeStd === s.id && (
                  <Space size={4} style={{ marginTop: 4 }}>
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEditStd(s); }} />
                    <Popconfirm title="该标准下的条款清空后才能删除；确认删除该标准？">
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>
                  </Space>
                )}
              </Space>
            </Card>
          ))
        )}
      </Sider>

      <Content style={{ padding: 16, overflow: 'auto' }}>
        {!activeStd ? (
          <Empty description="请选择或新建一个合规标准" />
        ) : (
          <>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {activeStandard?.name} <Tag color="blue">{activeStandard?.version}</Tag>
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {activeStandard?.description || activeStandard?.id} · 共 {flatClauses.length} 项
                </Typography.Text>
              </div>
              <Space>
                <Button
                  icon={allExpanded ? <CompressOutlined /> : <ExpandAltOutlined />}
                  onClick={toggleAll}
                  disabled={roots.length === 0}
                >
                  {allExpanded ? '折叠全部' : '展开全部'}
                </Button>
                <Button icon={<ApiOutlined />} onClick={() => setRulesOpen(true)}>判定规则</Button>
                <Button icon={<CodeOutlined />} onClick={() => void openJson()}>JSON 编辑</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateClause()}>新建顶级条款</Button>
              </Space>
            </Space>

            {loading ? <Spin tip="加载…" /> : flatClauses.length === 0 ? (
              <Empty description="该标准下暂无条款" />
            ) : (
              <Table
                rowKey="clauseId"
                size="small"
                dataSource={pagedRoots as unknown as ClauseNode[]}
                pagination={{
                  current: page,
                  pageSize,
                  total: roots.length,
                  showSizeChanger: true,
                  pageSizeOptions: [8, 20, 50],
                  showTotal: (total) => `共 ${total} 章 / ${flatClauses.length} 项`,
                  onChange: (p, ps) => { setPage(p); setPageSize(ps); },
                }}
                expandable={{
                  expandedRowKeys: expandedKeys,
                  onExpandedRowsChange: (keys) => setExpandedKeys(keys.map((k) => String(k))),
                  indentSize: 16,
                }}
                columns={[
                  { title: '编号', dataIndex: 'clauseId', width: 220, onCell: () => ({ style: { whiteSpace: 'nowrap' } }), render: (v: string, r) => (
                    <Space>
                      <code className="mono">{v}</code>
                      {r.parentId ? null : <Tag color="geekblue">章节</Tag>}
                    </Space>
                  ) },
                  {
                    title: '标题', dataIndex: 'title',
                    render: (v: string, r) => (
                      <Tooltip
                        title={
                          r.description ? (
                            <div style={{ maxWidth: 360 }}>
                              <div style={{ marginBottom: 4 }}>{r.description}</div>
                              {r.testingMethod && (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  测试方法：{r.testingMethod}
                                </Typography.Text>
                              )}
                            </div>
                          ) : (
                            '暂无描述'
                          )
                        }
                        placement="topLeft"
                        overlayStyle={{ maxWidth: 400 }}
                      >
                        <span style={{ cursor: 'help', borderBottom: '1px dashed transparent' }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = '#cbd5e1')}
                          onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = 'transparent')}
                        >{v}</span>
                      </Tooltip>
                    ),
                  },
                  { title: '等级', dataIndex: 'level', width: 70, render: (v: string) => <Tag color="blue">{v}</Tag> },
                  { title: '严重度', dataIndex: 'defaultSeverity', width: 90, render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'middle' ? 'orange' : 'default'}>{severityText[v as keyof typeof severityText] ?? v}</Tag> },
                  { title: '子项', key: 'children', width: 70, render: (_, r) => r.children?.length ? <Tag>{r.children.length}</Tag> : '-' },
                  {
                    title: '操作', key: 'op', width: 160,
                    render: (_, c) => (
                      <Space>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => openCreateClause(c.clauseId)}>子项</Button>
                        <Button size="small" icon={<EditOutlined />} aria-label="编辑" onClick={() => openEditClause(c)} />
                        <Popconfirm title={`删除 ${c.clauseId}?`} onConfirm={() => void removeClause(c)}>
                          <Button size="small" danger icon={<DeleteOutlined />} aria-label="删除" />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Content>

      {/* Standard editor modal */}
      <Modal
        title={stdModal.mode === 'create' ? '新建合规标准' : `编辑标准 ${stdModal.std?.id ?? ''}`}
        open={stdModal.std !== null}
        onCancel={() => setStdModal({ mode: 'create', std: null })}
        onOk={() => void saveStd()}
        okText="保存" cancelText="取消"
        destroyOnClose
      >
        <Form form={stdForm} layout="vertical">
          {stdModal.mode === 'create' && (
            <Form.Item name="code" label="标准代号" rules={[{ required: true, message: '如 EN18031' }]}
              tooltip="标准的短代号，如 EN18031、GB/T 41387">
              <Input placeholder="EN18031" className="mono" />
            </Form.Item>
          )}
          <Form.Item name="name" label="标准名称" rules={[{ required: true }]}>
            <Input placeholder="如 EN 18031 网络安全标准" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="version" label="版本" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="2019" />
            </Form.Item>
            <Form.Item name="id" label="ID（可选）" tooltip="留空则自动用 代号:版本" style={{ flex: 1 }}>
              <Input placeholder="EN18031:2019" className="mono" disabled={stdModal.mode === 'edit'} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Clause editor modal */}
      <Modal
        title={editor.mode === 'create' ? '新建条款' : `编辑条款 ${editor.clause?.clauseId ?? ''}`}
        open={editor.clause !== null}
        onCancel={() => setEditor({ mode: 'create', clause: null })}
        onOk={() => void saveClause()}
        okText="保存" cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="clauseId" label="条款编号" rules={[{ required: true, message: '如 5.5-1' }]}
            tooltip="章节用如 5.5；子项用如 5.5-1">
            <Input placeholder="如 5.5-1" className="mono" disabled={editor.mode === 'edit'} />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="chapter" label="所属章节" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="如 5.5" className="mono" />
            </Form.Item>
            <Form.Item name="parentId" label="父条款" style={{ flex: 1 }}>
              <Select
                allowClear
                placeholder="顶级条款留空"
                options={parentOptions}
                disabled={editor.mode === 'edit'}
              />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="level" label="合规等级" rules={[{ required: true }]}>
              <Select options={LEVEL_OPTIONS} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="defaultSeverity" label="默认严重度" rules={[{ required: true }]}>
              <Select options={SEVERITY_OPTIONS} style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input placeholder="条款标题" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="testingMethod" label="测试方法">
            <TextArea rows={2} placeholder="说明如何验证该条款" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="JSON 编辑 / 批量导入条款"
        open={jsonOpen}
        onCancel={() => setJsonOpen(false)}
        onOk={() => void importJson()}
        okText="导入（合并到现有条款）" cancelText="取消"
        width={760}
      >
        <Typography.Paragraph type="secondary">
          编辑条款数组 JSON，保存后批量 upsert（按 编号+标准 去重）。
          代码方式：编辑 <code className="mono">packages/server/src/db/clauseSeed.ts</code> 后重启服务重新 seed。
        </Typography.Paragraph>
        <TextArea rows={18} value={jsonText} onChange={(e) => setJsonText(e.target.value)} className="mono" />
      </Modal>

      <MappingRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} changed={() => activeStd && loadClauses(activeStd)} />
    </Layout>
  );
}

function MappingRulesModal({ open, onClose, changed }: { open: boolean; onClose: () => void; changed: () => void }) {
  const [rules, setRules] = useState<ClauseMappingRule[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(false);
  const [testOutput, setTestOutput] = useState('');
  const [form] = Form.useForm();

  // Live-match the pasted output against all current rules.
  const testMatches = useMemo(() => {
    if (!testOutput.trim()) return [];
    return rules
      .map((r) => {
        let matched = false;
        try {
          matched = r.matcherType === 'regex'
            ? new RegExp(r.pattern, 'm').test(testOutput)
            : testOutput.includes(r.pattern);
        } catch {
          matched = false;
        }
        return { rule: r, matched };
      })
      .filter((x) => x.matched)
      .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0));
  }, [rules, testOutput]);

  const load = async () => {
    setLoading(true);
    try {
      const [r, t, c] = await Promise.all([
        ClausesApi.mappingRules(),
        ToolsApi.list({ pageSize: 200 }),
        ClausesApi.list(),
      ]);
      setRules(r);
      setTools(t.items);
      setClauses(c);
    } catch (e) { reportError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const add = async () => {
    const v = await form.validateFields();
    try {
      await ClausesApi.createMappingRule({ ...v, priority: v.priority ?? 0, onMatch: v.onMatch ?? 'evidence-only' });
      message.success('规则已添加');
      form.resetFields();
      await load();
      changed();
    } catch (e) { reportError(e); }
  };

  const del = async (id: string) => {
    await ClausesApi.deleteMappingRule(id);
    message.success('规则已删除');
    await load();
  };

  const rulesTab = (
    <>
      <Form form={form} layout="inline" style={{ marginBottom: 16, rowGap: 8 }}>
        <Form.Item name="toolId" rules={[{ required: true, message: '选择工具' }]}>
          <Select placeholder="工具" style={{ width: 180 }} showSearch optionFilterProp="label"
            options={tools.map((t) => ({ value: t.id, label: t.name }))} />
        </Form.Item>
        <Form.Item name="clauseId" rules={[{ required: true, message: '选择条款' }]}>
          <Select placeholder="条款" style={{ width: 180 }} showSearch optionFilterProp="label"
            options={clauses.map((c) => ({ value: c.clauseId, label: `${c.clauseId} ${c.title}` }))} />
        </Form.Item>
        <Form.Item name="matcherType" initialValue="contains">
          <Select style={{ width: 100 }} options={[
            { value: 'contains', label: '包含' },
            { value: 'regex', label: '正则' },
          ]} />
        </Form.Item>
        <Form.Item name="pattern" rules={[{ required: true }]}>
          <Input placeholder="匹配文本/正则" style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="onMatch" initialValue="evidence-only">
          <Select style={{ width: 120 }} options={[
            { value: 'verdict-pass', label: '判通过' },
            { value: 'verdict-fail', label: '判失败' },
            { value: 'evidence-only', label: '仅证据' },
          ]} />
        </Form.Item>
        <Button type="primary" icon={<SaveOutlined />} onClick={() => void add()}>添加</Button>
      </Form>

      <Spin spinning={loading}>
        {rules.length === 0 ? <Empty description="暂无规则" /> : (
          <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={rules}
            columns={[
              { title: '工具', dataIndex: 'toolId', render: (v: string) => tools.find((t) => t.id === v)?.name ?? v },
              { title: '条款', dataIndex: 'clauseId', render: (v: string) => <code className="mono">{v}</code> },
              { title: '匹配', key: 'm', render: (_, r) => <Tag>{r.matcherType}</Tag> },
              { title: '模式', dataIndex: 'pattern', render: (v: string) => <code className="mono">{v}</code> },
              { title: '命中', dataIndex: 'onMatch', render: (v: string) => <Tag color={v === 'verdict-pass' ? 'green' : v === 'verdict-fail' ? 'red' : 'default'}>{v}</Tag> },
              { title: '', key: 'op', render: (_, r) => <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void del(r.id)} /> },
            ]}
          />
        )}
      </Spin>
    </>
  );

  const testerTab = (
    <div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        粘贴一段真实的命令输出（stdout/stderr），下方会实时显示哪些规则命中、将判定为什么结果。
      </Typography.Paragraph>
      <Input.TextArea
        rows={6}
        className="mono"
        placeholder={'例如：\n22/tcp open  ssh OpenSSH 9.0\n80/tcp open  http\n23/tcp open  telnet'}
        value={testOutput}
        onChange={(e) => setTestOutput(e.target.value)}
      />
      <div style={{ marginTop: 12 }}>
        {!testOutput.trim() ? (
          <Empty description="粘贴输出后查看命中结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : testMatches.length === 0 ? (
          <Tag color="red">没有任何规则命中此输出</Tag>
        ) : (
          <Table
            rowKey={(r) => r.rule.id}
            size="small"
            pagination={false}
            dataSource={testMatches}
            columns={[
              { title: '条款', dataIndex: ['rule', 'clauseId'], render: (v: string) => <code className="mono">{v}</code> },
              { title: '工具', dataIndex: ['rule', 'toolId'], render: (v: string) => tools.find((t) => t.id === v)?.name ?? v },
              { title: '命中模式', key: 'pat', render: (_, r) => <code className="mono">{r.rule.pattern}</code> },
              {
                title: '判定结果', dataIndex: ['rule', 'onMatch'],
                render: (v: string) => (
                  <Tag color={v === 'verdict-pass' ? 'green' : v === 'verdict-fail' ? 'red' : 'default'}>
                    {v === 'verdict-pass' ? 'PASS' : v === 'verdict-fail' ? 'FAIL' : '仅证据'}
                  </Tag>
                ),
              },
            ]}
          />
        )}
      </div>
    </div>
  );

  return (
    <Modal title="判定规则（命令输出 → 条款判定）" open={open} onCancel={onClose} footer={null} width={860}>
      <Typography.Paragraph type="secondary">
        命令手册型工具用规则匹配 stdout/stderr：命中「判通过」判 PASS、命中「判失败」判 FAIL，或仅作为证据。
        模组型工具在代码 <code className="mono">execute()</code> 中直接返回 verdicts。
      </Typography.Paragraph>
      <Tabs
        items={[
          { key: 'rules', label: '规则管理', children: rulesTab },
          { key: 'test', label: '规则测试器', children: testerTab },
        ]}
      />
    </Modal>
  );
}
