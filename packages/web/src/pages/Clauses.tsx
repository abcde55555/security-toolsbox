import { useEffect, useMemo, useState } from 'react';
import {
  Layout, Card, Button, Tag, Space, Typography, Empty, Spin, Table, Modal, Form, Input,
  Select, Collapse, message, Popconfirm, Tabs, Input as AntInput,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, CodeOutlined,
  SaveOutlined, ApiOutlined,
} from '@ant-design/icons';
import type { Clause, ClauseMappingRule, Tool } from '@en18031/shared';
import { ClausesApi, ToolsApi } from '../api/endpoints';
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
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeChapter, setActiveChapter] = useState<string>('');
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; clause: Partial<Clause> | null }>({ mode: 'create', clause: null });
  const [form] = Form.useForm();
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);

  const chapters = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of clauses) map.set(c.chapter, (map.get(c.chapter) ?? 0) + 1);
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [clauses]);

  const filtered = useMemo(
    () => clauses.filter((c) => !activeChapter || c.chapter === activeChapter),
    [clauses, activeChapter],
  );

  const load = async () => {
    setLoading(true);
    try {
      setClauses(await ClausesApi.list());
    } catch (e) { reportError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    form.resetFields();
    setEditor({
      mode: 'create',
      clause: { level: 'L1', defaultSeverity: 'middle', tags: [] },
    });
  };

  const openEdit = (c: Clause) => {
    setEditor({ mode: 'edit', clause: c });
    form.setFieldsValue(c);
  };

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editor.mode === 'create') {
        await ClausesApi.create({ ...editor.clause, ...v });
        message.success('条款已创建');
      } else if (editor.clause?.clauseId) {
        await ClausesApi.update(editor.clause.clauseId, v);
        message.success('条款已更新');
      }
      setEditor({ mode: 'create', clause: null });
      await load();
    } catch (e) { reportError(e); }
  };

  const remove = async (c: Clause) => {
    try {
      await ClausesApi.remove(c.clauseId);
      message.success('已删除');
      await load();
    } catch (e) { reportError(e); }
  };

  const openJson = () => {
    setJsonText(JSON.stringify(clauses, null, 2));
    setJsonOpen(true);
  };

  const importJson = async () => {
    try {
      const arr = JSON.parse(jsonText);
      if (!Array.isArray(arr)) { message.error('需要条款数组 JSON'); return; }
      const res = await ClausesApi.batchImport(arr);
      message.success(`已导入 ${res.imported} 条条款`);
      setJsonOpen(false);
      await load();
    } catch (e) {
      if (e instanceof SyntaxError) message.error('JSON 格式错误');
      else reportError(e);
    }
  };

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      <Sider width={220} theme="light" style={{ borderRight: '1px solid #eef0f4', padding: 12, overflow: 'auto' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>章节</Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
        </Space>
        <div
          role="button" tabIndex={0}
          onClick={() => setActiveChapter('')}
          onKeyDown={(e) => e.key === 'Enter' && setActiveChapter('')}
          style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6, background: !activeChapter ? '#eef2ff' : 'transparent', fontWeight: activeChapter ? 400 : 600 }}
        >
          全部 <Tag>{clauses.length}</Tag>
        </div>
        {chapters.map(([ch, n]) => (
          <div
            key={ch} role="button" tabIndex={0}
            onClick={() => setActiveChapter(ch)}
            onKeyDown={(e) => e.key === 'Enter' && setActiveChapter(ch)}
            style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 6, background: activeChapter === ch ? '#eef2ff' : 'transparent', fontWeight: activeChapter === ch ? 600 : 400, display: 'flex', justifyContent: 'space-between' }}
          >
            <span>{ch}</span><Tag>{n}</Tag>
          </div>
        ))}
      </Sider>

      <Content style={{ padding: 16, overflow: 'auto' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>合规测试项（EN18031 条款）</Typography.Title>
          <Space>
            <Button icon={<ApiOutlined />} onClick={() => setRulesOpen(true)}>判定规则</Button>
            <Button icon={<CodeOutlined />} onClick={openJson}>JSON 编辑</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建条款</Button>
          </Space>
        </Space>

        {loading ? <Spin /> : filtered.length === 0 ? <Empty description="无条款" /> : (
          <Table
            rowKey="clauseId"
            size="small"
            dataSource={filtered}
            pagination={{ pageSize: 50, showSizeChanger: true }}
            columns={[
              { title: '编号', dataIndex: 'clauseId', width: 110, render: (v: string) => <code className="mono">{v}</code> },
              { title: '章节', dataIndex: 'chapter', width: 90 },
              { title: '标题', dataIndex: 'title' },
              { title: '等级', dataIndex: 'level', width: 70, render: (v: string) => <Tag color="blue">{v}</Tag> },
              { title: '严重度', dataIndex: 'defaultSeverity', width: 90, render: (v: string) => <Tag color={v === 'high' ? 'red' : v === 'middle' ? 'orange' : 'default'}>{severityText[v as keyof typeof severityText] ?? v}</Tag> },
              {
                title: '操作', key: 'op', width: 130,
                render: (_, c) => (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} aria-label="编辑" onClick={() => openEdit(c)} />
                    <Popconfirm title={`删除条款 ${c.clauseId}?`} onConfirm={() => void remove(c)}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label="删除" />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (c) => (
                <div style={{ maxWidth: 900 }}>
                  <Typography.Paragraph><strong>描述：</strong>{c.description || '—'}</Typography.Paragraph>
                  <Typography.Paragraph type="secondary"><strong>测试方法：</strong>{c.testingMethod || '—'}</Typography.Paragraph>
                  {c.parentId && <Typography.Text type="secondary">父条款：{c.parentId} </Typography.Text>}
                </div>
              ),
            }}
          />
        )}
      </Content>

      <Modal
        title={editor.mode === 'create' ? '新建条款' : `编辑条款 ${editor.clause?.clauseId ?? ''}`}
        open={editor.clause !== null}
        onCancel={() => setEditor({ mode: 'create', clause: null })}
        onOk={() => void save()}
        okText="保存" cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="clauseId" label="条款编号" rules={[{ required: true, message: '如 5.5-1' }]}
            tooltip="编号是条款的唯一标识，创建后不可修改">
            <Input placeholder="如 5.5-1" disabled={editor.mode === 'edit'} className="mono" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item name="chapter" label="章节" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input placeholder="如 5.5" className="mono" />
            </Form.Item>
            <Form.Item name="level" label="合规等级" rules={[{ required: true }]}>
              <Select options={LEVEL_OPTIONS} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="defaultSeverity" label="默认严重度" rules={[{ required: true }]}>
              <Select options={SEVERITY_OPTIONS} style={{ width: 140 }} />
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
          <Form.Item name="parentId" label="父条款编号（可选）">
            <Input placeholder="如 5.5" className="mono" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="JSON 编辑 / 批量导入条款"
        open={jsonOpen}
        onCancel={() => setJsonOpen(false)}
        onOk={() => void importJson()}
        okText="导入/替换" cancelText="取消"
        width={760}
      >
        <Typography.Paragraph type="secondary">
          直接编辑条款数组 JSON，保存后批量 upsert（按 编号+标准版本 去重）。
          代码方式也可修改 <code className="mono">packages/server/src/db/clauseSeed.ts</code> 后重启服务重新 seed。
        </Typography.Paragraph>
        <TextArea rows={18} value={jsonText} onChange={(e) => setJsonText(e.target.value)} className="mono" />
      </Modal>

      <MappingRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} changed={() => void load()} />
    </Layout>
  );
}

function MappingRulesModal({ open, onClose, changed }: { open: boolean; onClose: () => void; changed: () => void }) {
  const [rules, setRules] = useState<ClauseMappingRule[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

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

  return (
    <Modal title="判定规则（命令输出 → 条款判定）" open={open} onCancel={onClose} footer={null} width={860}>
      <Typography.Paragraph type="secondary">
        当工具是命令手册型时，用规则匹配命令的 stdout/stderr：匹配到「通过模式」判 PASS，匹配到「失败模式」判 FAIL，
        或仅作为证据。模组型工具在代码中直接返回 verdicts。
      </Typography.Paragraph>

      <Form form={form} layout="inline" style={{ marginBottom: 16, rowGap: 8 }}>
        <Form.Item name="toolId" rules={[{ required: true, message: '选择工具' }]}>
          <Select placeholder="工具" style={{ width: 180 }} showSearch optionFilterProp="label"
            options={tools.map((t) => ({ value: t.id, label: t.name }))} />
        </Form.Item>
        <Form.Item name="clauseId" rules={[{ required: true, message: '选择条款' }]}>
          <Select placeholder="条款" style={{ width: 160 }} showSearch optionFilterProp="label"
            options={clauses.map((c) => ({ value: c.clauseId, label: `${c.clauseId} ${c.title}` }))} />
        </Form.Item>
        <Form.Item name="matcherType" initialValue="contains">
          <Select style={{ width: 110 }} options={[
            { value: 'contains', label: '包含' },
            { value: 'regex', label: '正则' },
          ]} />
        </Form.Item>
        <Form.Item name="pattern" rules={[{ required: true }]}>
          <AntInput placeholder="匹配文本/正则" style={{ width: 180 }} />
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
    </Modal>
  );
}
