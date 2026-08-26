import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout, List, Card, Button, Tag, Space, Typography, Empty, Spin, Modal, Form, Input,
  Select, message, Steps as AntSteps, Popconfirm, Alert, Tooltip, Dropdown,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, CopyOutlined, DeleteOutlined, PlayCircleOutlined,
  EditOutlined, ArrowUpOutlined, ArrowDownOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { Template, Tool, TemplateStep, FormField } from '@en18031/shared';
import { TemplatesApi, ToolsApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { failureStrategyText, versionLockText } from '../utils/ui';
import { useCategories } from '../hooks/useCategories';
import StepParamBinder, { isBoundValue } from '../components/StepParamBinder';
import TemplateCoverage from '../components/TemplateCoverage';
import ComplianceTemplateEditor, { type ComplianceSavePayload } from '../components/ComplianceTemplateEditor';
import type { TemplateVariable } from '@en18031/shared';

const { Sider, Content } = Layout;
const { TextArea } = Input;

interface StepForm {
  key: string;
  stepId: string;
  title: string;
  toolId: string;
  onFailure: string;
  params: Record<string, unknown>;
  paramsJson: string;
}

function blankStep(n: number): StepForm {
  return {
    key: String(Date.now() + n),
    stepId: `step-${n}`,
    title: `步骤 ${n}`,
    toolId: '',
    onFailure: 'continue',
    params: {},
    paramsJson: '{}',
  };
}

function stepFromTemplate(s: TemplateStep, key: string): StepForm {
  return {
    key,
    stepId: s.stepId,
    title: s.title,
    toolId: s.toolId,
    onFailure: s.onFailure,
    params: { ...s.params },
    paramsJson: JSON.stringify(s.params, null, 2),
  };
}

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const { labelOf } = useCategories();
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [stepForms, setStepForms] = useState<StepForm[]>([]);
  const [varForms, setVarForms] = useState<TemplateVariable[]>([]);
  const [coverageId, setCoverageId] = useState<string>();
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [complianceEditing, setComplianceEditing] = useState<Template | null>(null);
  const stepSeq = useRef(1);

  const selected = templates.find((t) => t.id === selectedId);

  const toolById = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);

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

  const seedSeq = (ids: string[]) => {
    let max = 0;
    for (const id of ids) {
      const m = /^step-(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    stepSeq.current = max + 1;
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ concurrencyLimit: 1 });
    stepSeq.current = 1;
    setStepForms([blankStep(stepSeq.current++)]);
    setVarForms([]);
    setEditorOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    form.setFieldsValue({
      name: t.name,
      description: t.description,
      concurrencyLimit: t.concurrencyLimit,
    });
    seedSeq(t.steps.map((s) => s.stepId));
    setStepForms(t.steps.map((s, i) => stepFromTemplate(s, `${t.id}-${i}`)));
    setVarForms((t.variables ?? []).map((v) => ({ ...v })));
    setEditorOpen(true);
  };

  const addStep = () => {
    const n = stepSeq.current++;
    setStepForms((prev) => [...prev, blankStep(n)]);
  };

  const updateStep = (idx: number, patch: Partial<StepForm>) => {
    setStepForms((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeStep = (idx: number) => setStepForms((prev) => prev.filter((_, i) => i !== idx));

  const moveStep = (idx: number, dir: -1 | 1) => {
    setStepForms((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const selectTool = (idx: number, toolId: string) => {
    const tool = toolById.get(toolId);
    const fields = tool?.formFields ?? [];
    // Fields without a default value are almost always per-target inputs (IP,
    // port range, firmware path...); leave them empty so the binder defaults
    // to "bind to a project variable" rather than pre-filling a fake value.
    const params: Record<string, unknown> = {};
    for (const f of fields) {
      params[f.id] = f.value !== undefined ? f.value : f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : '';
    }
    updateStep(idx, { toolId, params, paramsJson: '{}' });
  };

  const addVariable = (v: TemplateVariable) => {
    setVarForms((prev) => (prev.some((x) => x.name === v.name) ? prev : [...prev, v]));
  };
  const removeVariable = (name: string) => {
    setVarForms((prev) => prev.filter((v) => v.name !== name));
    // unbind any step param pointing at this variable
    setStepForms((prev) =>
      prev.map((s) => {
        let changed = false;
        const params = { ...s.params };
        for (const [k, val] of Object.entries(params)) {
          if (val === `{{project.${name}}}`) { params[k] = ''; changed = true; }
        }
        return changed ? { ...s, params } : s;
      }),
    );
  };

  const setParam = (idx: number, id: string, value: unknown) => {
    setStepForms((prev) => prev.map((s, i) => (
      i === idx ? { ...s, params: { ...s.params, [id]: value } } : s
    )));
  };

  const submit = async () => {
    const values = await form.validateFields();
    const seenIds = new Set<string>();
    const steps: TemplateStep[] = [];
    for (let i = 0; i < stepForms.length; i++) {
      const s = stepForms[i];
      if (!s.toolId) { message.error(`步骤 ${i + 1} 未选择工具`); return; }
      const stepId = (s.stepId || `step-${i + 1}`).trim();
      if (seenIds.has(stepId)) { message.error(`步骤 ID 重复：${stepId}`); return; }
      seenIds.add(stepId);
      const tool = toolById.get(s.toolId);
      let params: Record<string, unknown> = {};
      if (tool && tool.formFields.length > 0) {
        params = s.params;
        // Warn (but do not block) when a required target field carries a
        // real value instead of a project-variable binding.
        for (const f of tool.formFields) {
          if (!f.required) continue;
          const v = params[f.id];
          if (isBoundValue(v)) continue;
          if (v === '' || v === undefined || v === null) continue;
          if (f.format === 'ip' || f.format === 'cidr' || f.type === 'file' || /ip|host|target|目标/i.test(f.id + f.label)) {
            message.warning(`步骤 ${i + 1} 的「${f.label}」填了具体值，通常应绑定项目变量`);
          }
        }
      } else {
        try { params = JSON.parse(s.paramsJson || '{}'); }
        catch { message.error(`步骤 ${i + 1} 的参数 JSON 格式错误`); return; }
      }
      steps.push({
        stepId,
        title: s.title || `步骤 ${i + 1}`,
        toolId: s.toolId,
        toolVersion: tool?.version ?? '1.0.0',
        params,
        dependsOn: i > 0 ? [steps[i - 1].stepId] : [],
        onFailure: s.onFailure as TemplateStep['onFailure'],
        position: i,
      });
    }
    const payload = {
      name: values.name,
      description: values.description,
      variables: varForms,
      concurrencyLimit: values.concurrencyLimit ?? 1,
      steps,
      toolRefs: Array.from(new Set(steps.map((st) => st.toolId))).map((toolId) => ({
        toolId,
        toolVersionLock: 'follow' as const,
      })),
    };
    setSaving(true);
    try {
      let tpl: Template;
      if (editing) {
        tpl = await TemplatesApi.update(editing.id, { ...payload, revision: editing.revision });
        message.success('模板已更新');
      } else {
        tpl = await TemplatesApi.create(payload);
        message.success('模板已创建');
      }
      setEditorOpen(false);
      await load();
      setSelectedId(tpl.id);
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  };

  const saveCompliance = async (payload: ComplianceSavePayload) => {
    try {
      let tpl: Template;
      if (complianceEditing) {
        tpl = await TemplatesApi.update(complianceEditing.id, {
          ...payload,
          revision: complianceEditing.revision,
        });
        message.success('合规模板已更新');
      } else {
        tpl = await TemplatesApi.create(payload);
        message.success('合规模板已创建');
      }
      setComplianceOpen(false);
      setComplianceEditing(null);
      await load();
      setSelectedId(tpl.id);
    } catch (e) {
      reportError(e);
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

  const confirmUpgrade = async (t: Template, toolId: string) => {
    try {
      await TemplatesApi.confirmUpgrade(t.id, toolId, true);
      message.success('已锁定到当前工具版本');
      await load();
    } catch (e) { reportError(e); }
  };

  const remove = async (t: Template) => {
    try {
      await TemplatesApi.remove(t.id);
      message.success('已删除');
      if (selectedId === t.id) setSelectedId(undefined);
      await load();
    } catch (e) { reportError(e); }
  };

  const toolName = (id: string) => toolById.get(id)?.name ?? id;

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      <Sider width={300} theme="light" style={{ borderRight: '1px solid #eef0f4', padding: 12, overflow: 'auto' }}>
        <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
          <Typography.Text strong>测试模板</Typography.Text>
          <Space>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
            <Dropdown
              menu={{
                items: [
                  { key: 'adhoc', label: '自由编排模板' },
                  { key: 'compliance', label: '合规测试模板（条款驱动）' },
                ],
                onClick: ({ key }) => {
                  if (key === 'compliance') {
                    setComplianceEditing(null);
                    setComplianceOpen(true);
                  } else {
                    openCreate();
                  }
                },
              }}
            >
              <Button size="small" type="primary" icon={<PlusOutlined />}>新建</Button>
            </Dropdown>
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
                  title={
                    <Space>
                      <Typography.Text strong>{t.name}</Typography.Text>
                      {t.mode === 'compliance' && <Tag color="purple" style={{ marginInlineStart: 0 }}>合规</Tag>}
                    </Space>
                  }
                  description={
                    <Space size={4} wrap>
                      <Tag>{t.mode === 'compliance' ? `${(t.clauseBindings ?? []).length} 条款` : `${t.steps.length} 步`}</Tag>
                      <Tag>v{t.revision}</Tag>
                      {t.mode !== 'compliance' && t.toolRefs.map((r) => (
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
        {!selected ? <Empty description="暂无模板——点击左上角「新建模板」创建第一个模板" /> : (
          <>
            <Card
              title={<><Typography.Text strong>{selected.name}</Typography.Text> <Tag style={{ marginLeft: 8 }}>rev {selected.revision}</Tag></>}
              extra={
                <Space>
                  <Button icon={<SafetyCertificateOutlined />} onClick={() => setCoverageId(selected.id)}>覆盖度</Button>
                  <Button icon={<EditOutlined />} onClick={() => {
                    if (selected.mode === 'compliance') {
                      setComplianceEditing(selected);
                      setComplianceOpen(true);
                    } else {
                      openEdit(selected);
                    }
                  }}>编辑</Button>
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
                  <Tag
                    key={r.toolId}
                    color={r.upgradePending ? 'red' : 'blue'}
                    style={r.upgradePending ? { borderStyle: 'dashed' } : undefined}
                  >
                    {toolName(r.toolId)}
                    <span style={{ color: '#94a3b8', marginLeft: 4 }}>
                      · {versionLockText[r.toolVersionLock] ?? r.toolVersionLock}
                    </span>
                    {r.upgradePending && (
                      <Tooltip title="工具已升级，点击确认兼容性">
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: '0 4px', color: '#dc2626', fontWeight: 600 }}
                          onClick={() => void confirmUpgrade(selected, r.toolId)}
                        >
                          升级确认
                        </Button>
                      </Tooltip>
                    )}
                  </Tag>
                ))}
              </Space>
            </Card>

            <Card
              title="编排流程"
              extra={<Button type="primary" icon={<PlayCircleOutlined />} onClick={() => navigate(`/projects?newFrom=${selected.id}`)}>基于此模板创建项目</Button>}
            >
              {selected.steps.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该模板还没有步骤" style={{ padding: '16px 0' }}>
                  <Typography.Text type="secondary">点击右上角「编辑」添加步骤，或直接在项目页用「单独执行工具」运行命令。</Typography.Text>
                </Empty>
              ) : (
              <AntSteps direction="vertical" current={-1}
                items={selected.steps.map((s) => ({
                  title: <Space><span>{s.title}</span><Tag>{s.stepId}</Tag><Tag color={s.onFailure === 'abort' ? 'red' : 'default'}>{failureStrategyText[s.onFailure] ?? s.onFailure}</Tag></Space>,
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
              )}
            </Card>
          </>
        )}
      </Content>

      <Modal
        title={editing ? `编辑模板：${editing.name}` : '新建测试模板'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        width={760}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
            <Input placeholder="例如：IoT 网络扫描模板" />
          </Form.Item>
          <Form.Item name="description" label="描述"><TextArea rows={2} placeholder="模板用途说明" /></Form.Item>
          <Form.Item name="concurrencyLimit" label="并发上限">
            <Select options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n} 个步骤并发` }))} style={{ width: 200 }} />
          </Form.Item>
        </Form>

        <Card size="small" style={{ marginBottom: 12 }} title="项目变量">
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            项目创建后由审计员填写真实值（目标 IP、网段等）。步骤参数通过 <code>{'{{project.变量名}}'}</code> 引用。
          </Typography.Text>
          {varForms.length === 0 ? (
            <Typography.Text type="secondary">尚未定义变量，可在下方步骤参数处点「新建变量」自动创建。</Typography.Text>
          ) : (
            varForms.map((v) => (
              <Space key={v.name} style={{ display: 'flex', marginBottom: 6 }} align="center">
                <Tag color="blue" className="mono">{`{{project.${v.name}}}`}</Tag>
                <span>{v.label}</span>
                <Tag>{v.type}</Tag>
                {v.required && <Tag color="red">必填</Tag>}
                {v.default !== undefined && <Typography.Text type="secondary">默认: {String(v.default)}</Typography.Text>}
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeVariable(v.name)} />
              </Space>
            ))
          )}
        </Card>

        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Typography.Text strong>执行步骤（顺序执行）</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>上移/下移调整顺序，依赖按顺序自动生成</Typography.Text>
        </Space>
        <div>
          {stepForms.map((s, idx) => {
            const tool = toolById.get(s.toolId);
            const hasForm = !!tool && tool.formFields.length > 0;
            const isCommandManual = !!tool && tool.type === 'custom' && (tool.commands?.length ?? 0) > 0;
            return (
              <Card key={s.key} size="small" style={{ marginBottom: 8 }}
                title={`步骤 ${idx + 1}`}
                extra={
                  <Space>
                    <Tooltip title="上移"><Button size="small" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => moveStep(idx, -1)} /></Tooltip>
                    <Tooltip title="下移"><Button size="small" icon={<ArrowDownOutlined />} disabled={idx === stepForms.length - 1} onClick={() => moveStep(idx, 1)} /></Tooltip>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeStep(idx)} />
                  </Space>
                }
              >
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <Space style={{ width: '100%' }}>
                    <Input placeholder="步骤 ID" value={s.stepId} onChange={(e) => updateStep(idx, { stepId: e.target.value })} style={{ width: 140 }} />
                    <Input placeholder="步骤标题" value={s.title} onChange={(e) => updateStep(idx, { title: e.target.value })} style={{ width: 220 }} />
                    <Select size="small" value={s.onFailure} onChange={(v) => updateStep(idx, { onFailure: v })} style={{ width: 140 }}
                      options={[{ value: 'continue', label: '失败继续' }, { value: 'abort', label: '失败中止' }, { value: 'retry', label: '失败重试' }]} />
                  </Space>
                  <Select
                    placeholder="选择工具/模组"
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                    value={s.toolId || undefined}
                    onChange={(v) => selectTool(idx, v)}
                    options={tools.map((t) => ({
                      value: t.id,
                      label: `${t.name} (${labelOf(t.category)})${t.formFields.length === 0 ? ' · 无表单参数' : ''}`,
                      desc: t.description,
                    }))}
                    optionRender={(option) => (
                      <Space direction="vertical" size={0}>
                        <span>{option.data.label}</span>
                        {option.data.desc && (
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            {option.data.desc}
                          </Typography.Text>
                        )}
                      </Space>
                    )}
                  />
                  {hasForm ? (
                    <StepParamBinder
                      fields={tool!.formFields}
                      params={s.params}
                      variables={varForms}
                      onChange={(id, v) => setParam(idx, id, v)}
                      onAddVariable={addVariable}
                    />
                  ) : tool ? (
                    <>
                      {isCommandManual && (
                        <Alert type="warning" showIcon style={{ marginTop: 4 }}
                          message="命令手册工具暂不支持编排执行"
                          description="该工具是命令手册（仅含命令行），编排引擎当前只执行表单式模组。如需在编排中使用，请选择带表单参数的模组；单条命令可在项目页「单独执行工具」直接运行。" />
                      )}
                      <TextArea rows={3} className="mono" placeholder='参数 JSON, 例如 {"targetIp":"127.0.0.1","portRange":"22,80,443"}'
                        value={s.paramsJson} onChange={(e) => updateStep(idx, { paramsJson: e.target.value })} />
                    </>
                  ) : null}
                </Space>
              </Card>
            );
          })}
          <Button block icon={<PlusOutlined />} onClick={addStep}>添加步骤</Button>
        </div>
      </Modal>

      <TemplateCoverage
        open={!!coverageId}
        templateId={coverageId ?? ''}
        onClose={() => setCoverageId(undefined)}
      />

      <ComplianceTemplateEditor
        open={complianceOpen}
        template={complianceEditing}
        onClose={() => { setComplianceOpen(false); setComplianceEditing(null); }}
        onSave={saveCompliance}
      />
    </Layout>
  );
}
