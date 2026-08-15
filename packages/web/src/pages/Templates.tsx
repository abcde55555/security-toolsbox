import { useEffect, useState } from 'react';
import {
  Layout, List, Card, Button, Tag, Space, Typography, Empty, Spin, Modal, Form, Input,
  Select, message, Drawer, Steps as AntSteps, Popconfirm,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, CopyOutlined, DeleteOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Template, Tool, TemplateStep } from '@en18031/shared';
import { TemplatesApi, ToolsApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { categoryLabel } from '../utils/ui';

const { Sider, Content } = Layout;
const { TextArea } = Input;

interface StepForm {
  key: string;
  stepId: string;
  title: string;
  toolId: string;
  onFailure: string;
  paramsJson: string;
}

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [stepForms, setStepForms] = useState<StepForm[]>([]);

  const selected = templates.find((t) => t.id === selectedId);

  const load = async () => {
    setLoading(true);
    try {
      const [tpls, toolRes] = await Promise.all([TemplatesApi.list(), ToolsApi.list({ pageSize: 200 })]);
      setTemplates(tpls);
      setTools(toolRes.items);
      if (!selectedId && tpls.length) setSelectedId(tpls[0].id);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    form.resetFields();
    setStepForms([
      { key: String(Date.now()), stepId: 'step-1', title: '步骤 1', toolId: '', onFailure: 'continue', paramsJson: '{}' },
    ]);
    setCreateOpen(true);
  };

  const addStep = () => {
    const n = stepForms.length + 1;
    setStepForms([...stepForms, {
      key: String(Date.now() + n),
      stepId: `step-${n}`,
      title: `步骤 ${n}`,
      toolId: '',
      onFailure: 'continue',
      paramsJson: '{}',
    }]);
  };

  const updateStep = (idx: number, patch: Partial<StepForm>) => {
    setStepForms(stepForms.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeStep = (idx: number) => setStepForms(stepForms.filter((_, i) => i !== idx));

  const submitCreate = async () => {
    const values = await form.validateFields();
    const steps: TemplateStep[] = [];
    for (let i = 0; i < stepForms.length; i++) {
      const s = stepForms[i];
      if (!s.toolId) { message.error(`步骤 ${i + 1} 未选择工具`); return; }
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(s.paramsJson || '{}'); }
      catch { message.error(`步骤 ${i + 1} 的参数 JSON 格式错误`); return; }
      steps.push({
        stepId: s.stepId || `step-${i + 1}`,
        title: s.title || `步骤 ${i + 1}`,
        toolId: s.toolId,
        toolVersion: tools.find((t) => t.id === s.toolId)?.version ?? '1.0.0',
        params,
        dependsOn: i > 0 ? [steps[i - 1].stepId] : [],
        onFailure: s.onFailure as TemplateStep['onFailure'],
        position: i,
      });
    }
    setCreating(true);
    try {
      const tpl = await TemplatesApi.create({
        name: values.name,
        description: values.description,
        variables: [],
        concurrencyLimit: values.concurrencyLimit ?? 1,
        steps,
        toolRefs: steps.map((st) => ({ toolId: st.toolId, toolVersionLock: 'follow' })),
      });
      message.success('模板已创建');
      setCreateOpen(false);
      await load();
      setSelectedId(tpl.id);
    } catch (e) {
      reportError(e);
    } finally {
      setCreating(false);
    }
  };

  const clone = async (t: Template) => {
    try {
      const c = await TemplatesApi.clone(t.id, `${t.name} (副本)`);
      message.success('已克隆');
      await load();
      setSelectedId(c.id);
    } catch (e) { reportError(e); }
  };

  const remove = async (t: Template) => {
    try {
      await TemplatesApi.remove(t.id);
      message.success('已删除');
      await load();
    } catch (e) { reportError(e); }
  };

  const toolName = (id: string) => tools.find((t) => t.id === id)?.name ?? id;

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      <Sider width={300} theme="light" style={{ borderRight: '1px solid #eef0f4', padding: 12, overflow: 'auto' }}>
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text strong>测试模板</Typography.Text>
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建</Button>
          </Space>
        </Space>
        {loading ? <Spin /> : templates.length === 0 ? <Empty description="暂无模板" /> : (
          <List
            dataSource={templates}
            renderItem={(t) => (
              <List.Item
                onClick={() => setSelectedId(t.id)}
                style={{
                  cursor: 'pointer', padding: 10, borderRadius: 6, marginBottom: 6,
                  background: selectedId === t.id ? '#eff6ff' : 'transparent',
                  border: selectedId === t.id ? '1px solid #bfdbfe' : '1px solid transparent',
                }}
              >
                <List.Item.Meta
                  title={<Typography.Text strong>{t.name}</Typography.Text>}
                  description={
                    <Space size={4} wrap>
                      <Tag>{t.steps.length} 步</Tag>
                      <Tag>v{t.revision}</Tag>
                      {t.toolRefs.map((r) => (
                        <Tag key={r.toolId} color="blue">{toolName(r.toolId)}</Tag>
                      ))}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Sider>
      <Content style={{ padding: 16, overflow: 'auto' }}>
        {!selected ? <Empty description="选择左侧模板查看详情" /> : (
          <>
            <Card
              title={<><Typography.Text strong>{selected.name}</Typography.Text> <Tag style={{ marginLeft: 8 }}>rev {selected.revision}</Tag></>}
              extra={
                <Space>
                  <Button icon={<CopyOutlined />} onClick={() => void clone(selected)}>克隆</Button>
                  <Popconfirm title="确认删除该模板？" onConfirm={() => void remove(selected)}>
                    <Button danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Typography.Paragraph type="secondary">{selected.description ?? '无描述'}</Typography.Paragraph>
              <Space wrap>
                <Tag color="geekblue">并发上限 {selected.concurrencyLimit}</Tag>
                <span>引用工具：</span>
                {selected.toolRefs.map((r) => (
                  <Tag key={r.toolId} color="blue">
                    {toolName(r.toolId)} <span style={{ color: '#94a3b8' }}>· {r.toolVersionLock}</span>
                  </Tag>
                ))}
              </Space>
            </Card>

            <Card
              title="编排流程"
              extra={<Button type="primary" icon={<PlayCircleOutlined />} onClick={() => navigate(`/projects?newFrom=${selected.id}`)}>基于此模板创建项目</Button>}
            >
              <AntSteps direction="vertical" current={selected.steps.length - 1}
                items={selected.steps.map((s) => ({
                  title: <Space><span>{s.title}</span><Tag>{s.stepId}</Tag><Tag color={s.onFailure === 'abort' ? 'red' : 'default'}>{s.onFailure}</Tag></Space>,
                  description: (
                    <div>
                      <Tag color="blue">{toolName(s.toolId)}</Tag>
                      {s.dependsOn.length > 0 && <span style={{ color: '#64748b', fontSize: 12 }}>依赖: {s.dependsOn.join(', ')}</span>}
                      <pre className="mono" style={{ background: '#f8fafc', padding: 8, borderRadius: 6, fontSize: 12, marginTop: 6 }}>
                        {JSON.stringify(s.params, null, 2)}
                      </pre>
                    </div>
                  ),
                }))}
              />
            </Card>
          </>
        )}
      </Content>

      <Modal
        title="新建测试模板"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={creating}
        width={720}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
            <Input placeholder="例如：IoT 网络扫描模板" />
          </Form.Item>
          <Form.Item name="description" label="描述"><TextArea rows={2} placeholder="模板用途说明" /></Form.Item>
          <Form.Item name="concurrencyLimit" label="并发上限" initialValue={1}>
            <Select options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} 个步骤并发` }))} style={{ width: 200 }} />
          </Form.Item>
        </Form>
        <Typography.Text strong>执行步骤</Typography.Text>
        <div style={{ marginTop: 8 }}>
          {stepForms.map((s, idx) => (
            <Card key={s.key} size="small" style={{ marginBottom: 8 }}
              title={`步骤 ${idx + 1}`}
              extra={<Button size="small" danger onClick={() => removeStep(idx)}>删除</Button>}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space style={{ width: '100%' }}>
                  <Input placeholder="步骤 ID" value={s.stepId} onChange={(e) => updateStep(idx, { stepId: e.target.value })} style={{ width: 140 }} />
                  <Input placeholder="步骤标题" value={s.title} onChange={(e) => updateStep(idx, { title: e.target.value })} style={{ width: 200 }} />
                </Space>
                <Select
                  placeholder="选择工具/模组"
                  style={{ width: '100%' }}
                  value={s.toolId || undefined}
                  onChange={(v) => updateStep(idx, { toolId: v })}
                  options={tools.map((t) => ({ value: t.id, label: `${t.name} (${categoryLabel(t.category)})` }))}
                />
                <Space>
                  <span>失败策略：</span>
                  <Select size="small" value={s.onFailure} onChange={(v) => updateStep(idx, { onFailure: v })} style={{ width: 140 }}
                    options={[{ value: 'continue', label: '继续' }, { value: 'abort', label: '中止流程' }, { value: 'retry', label: '重试' }]} />
                </Space>
                <TextArea rows={3} placeholder='参数 JSON, 例如 {"targetIp":"127.0.0.1","portRange":"22,80,443"}'
                  value={s.paramsJson} onChange={(e) => updateStep(idx, { paramsJson: e.target.value })} />
              </Space>
            </Card>
          ))}
          <Button block icon={<PlusOutlined />} onClick={addStep}>添加步骤</Button>
        </div>
      </Modal>
    </Layout>
  );
}
