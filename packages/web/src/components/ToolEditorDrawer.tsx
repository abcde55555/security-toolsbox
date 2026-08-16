import { useEffect, useState } from 'react';
import {
  Drawer, Form, Input, InputNumber, Select, Switch, Button, Space, Typography, Tag,
  Card, Popconfirm, Alert, Divider, Row, Col, message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { Tool, ToolCommand, Clause, HealthCheckConfig } from '@en18031/shared';
import { uuid } from '@en18031/shared';
import { ToolsApi, ClausesApi } from '../api/endpoints';
import { reportError } from '../api/client';
import { categoryOptions, categoryLabel } from '../utils/ui';
import CommandEditor from './CommandEditor';

interface ToolDraft {
  name: string;
  category: string;
  version: string;
  description?: string;
  tags: string[];
  path?: string;
  healthCheck?: HealthCheckConfig;
  setupCommand?: string;
  commands: ToolCommand[];
}

function blankDraft(): ToolDraft {
  return {
    name: '',
    category: 'other',
    version: '1.0.0',
    description: '',
    tags: [],
    path: '',
    healthCheck: undefined,
    setupCommand: '',
    commands: [],
  };
}

function fromTool(t: Tool): ToolDraft {
  return {
    name: t.name,
    category: t.category,
    version: t.version,
    description: t.description ?? '',
    tags: t.tags ?? [],
    path: t.path ?? '',
    healthCheck: t.healthCheck,
    setupCommand: t.setupCommand ?? '',
    commands: (t.commands ?? []).map((c) => ({ ...c, params: c.params.map((p) => ({ ...p })) })),
  };
}

export default function ToolEditorDrawer({
  open, tool, onClose, onSaved,
}: {
  open: boolean;
  tool: Tool | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const readOnly = !!tool?.builtin;
  const [draft, setDraft] = useState<ToolDraft>(blankDraft());
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingCommand, setEditingCommand] = useState<ToolCommand | null>(null);
  const [commandEditorOpen, setCommandEditorOpen] = useState(false);
  const [healthEnabled, setHealthEnabled] = useState(false);
  const [envRows, setEnvRows] = useState<Array<{ id: string; key: string; value: string }>>([]);

  useEffect(() => {
    if (!open) return;
    setDraft(tool ? fromTool(tool) : blankDraft());
    setHealthEnabled(!!tool?.healthCheck?.command);
    const env = tool?.envVars ?? {};
    setEnvRows(Object.entries(env).map(([key, value]) => ({ id: uuid(), key, value })));
    void ClausesApi.list().then(setClauses).catch(() => {});
  }, [open, tool]);

  const isNew = !tool;

  function patch<K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function openNewCommand() {
    setEditingCommand(null);
    setCommandEditorOpen(true);
  }

  function openEditCommand(cmd: ToolCommand) {
    setEditingCommand(cmd);
    setCommandEditorOpen(true);
  }

  function saveCommand(cmd: ToolCommand) {
    setDraft((prev) => {
      const idx = prev.commands.findIndex((c) => c.id === cmd.id);
      const commands = idx >= 0
        ? prev.commands.map((c) => (c.id === cmd.id ? cmd : c))
        : [...prev.commands, cmd];
      return { ...prev, commands };
    });
    setCommandEditorOpen(false);
    setEditingCommand(null);
  }

  function deleteCommand(id: string) {
    setDraft((prev) => ({ ...prev, commands: prev.commands.filter((c) => c.id !== id) }));
  }

  function setEnvVar(id: string, patch: Partial<{ key: string; value: string }>) {
    setEnvRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addEnvVar() {
    setEnvRows((prev) => [...prev, { id: uuid(), key: '', value: '' }]);
  }
  function removeEnvVar(id: string) {
    setEnvRows((prev) => prev.filter((r) => r.id !== id));
  }

  const blockers: string[] = [];
  if (!draft.name.trim()) blockers.push('工具名称不能为空');
  if (!draft.version.trim()) blockers.push('版本不能为空');
  const hasPath = draft.path && draft.path.trim();
  if (!hasPath && draft.commands.length === 0) {
    blockers.push('命令手册至少需要一条命令，或填写可执行文件 path');
  }

  async function save() {
    if (blockers.length > 0) {
      message.error(blockers[0]);
      return;
    }
    setSaving(true);
    try {
      const envVars = Object.fromEntries(
        envRows.filter((r) => r.key.trim() !== '').map((r) => [r.key.trim(), r.value]),
      );
      const healthCheck = healthEnabled && draft.healthCheck?.command
        ? draft.healthCheck
        : undefined;
      const payload = {
        name: draft.name.trim(),
        category: draft.category,
        version: draft.version.trim(),
        description: draft.description?.trim() || undefined,
        tags: draft.tags,
        path: hasPath ? draft.path!.trim() : undefined,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
        setupCommand: draft.setupCommand?.trim() || undefined,
        healthCheck,
        commands: draft.commands,
      };
      if (isNew) {
        await ToolsApi.create({ ...payload, type: 'custom', interactionMode: 'cmd' });
        message.success('工具已创建');
      } else if (tool) {
        await ToolsApi.update(tool.id, {
          ...payload,
          envVars: Object.keys(envVars).length > 0 ? envVars : null,
          setupCommand: draft.setupCommand?.trim() || null,
          healthCheck: healthCheck ?? null,
          revision: tool.revision,
        });
        message.success('工具已更新');
      }
      onSaved();
    } catch (e) {
      reportError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Drawer
        title={readOnly ? `查看工具：${tool?.name}` : isNew ? '注册命令手册工具' : `编辑工具：${tool?.name}`}
        width={680}
        open={open}
        onClose={onClose}
        destroyOnClose
        maskClosable={false}
        extra={
          readOnly ? undefined : (
            <Space>
              <Button onClick={onClose}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
            </Space>
          )
        }
      >
        {readOnly && (
          <Alert
            type="info" showIcon style={{ marginBottom: 12 }}
            message="内置工具为只读"
            description="内置模组随应用发布，不能在界面上修改。可查看其命令和参数定义。"
          />
        )}

        <Form layout="vertical" disabled={readOnly}>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item label="工具名称" required>
                <Input value={draft.name} onChange={(e) => patch('name', e.target.value)} placeholder="如 蓝牙检测工具箱" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="版本">
                <Input value={draft.version} onChange={(e) => patch('version', e.target.value)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="分类">
                <Select
                  value={draft.category}
                  onChange={(v) => patch('category', v)}
                  options={categoryOptions}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="描述">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              value={draft.description}
              onChange={(e) => patch('description', e.target.value)}
            />
          </Form.Item>

          <Form.Item label="标签">
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={draft.tags}
              onChange={(v) => patch('tags', v)}
              tokenSeparators={[',']}
              placeholder="输入标签后回车"
            />
          </Form.Item>

          <Form.Item label="可执行文件路径（可选，命令手册可留空）">
            <Input
              className="mono"
              value={draft.path}
              onChange={(e) => patch('path', e.target.value)}
              placeholder="如 /usr/bin/hcitool（留空则为纯命令手册）"
            />
          </Form.Item>

          <Form.Item
            label="环境激活命令（可选）"
            tooltip="每条命令执行前，在同一个 shell 里先执行这段命令，用于进入运行环境，例如 source ~/venv/bin/activate 或 source ~/miniconda3/etc/profile.d/conda.sh && conda activate myenv。激活失败（退出码非 0）会中止后续命令。"
          >
            <Input.TextArea
              className="mono"
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="source ~/venv/bin/activate"
              value={draft.setupCommand}
              onChange={(e) => patch('setupCommand', e.target.value)}
            />
          </Form.Item>

          <Divider orientation="left" plain>健康检查</Divider>
          <Space align="start" style={{ width: '100%' }}>
            <Switch
              checked={healthEnabled}
              onChange={setHealthEnabled}
              disabled={readOnly}
            />
            {healthEnabled && (
              <Space direction="vertical" style={{ flex: 1 }}>
                <Input
                  className="mono"
                  placeholder="版本探测命令，如 hcitool -h"
                  value={draft.healthCheck?.command ?? ''}
                  onChange={(e) => patch('healthCheck', {
                    command: e.target.value,
                    timeoutMs: draft.healthCheck?.timeoutMs ?? 5000,
                  })}
                />
                <Space>
                  <Typography.Text type="secondary">超时(秒)</Typography.Text>
                  <InputNumber
                    min={1} max={60}
                    value={draft.healthCheck?.timeoutMs ? Math.round(draft.healthCheck.timeoutMs / 1000) : 5}
                    onChange={(v) => patch('healthCheck', {
                      command: draft.healthCheck?.command ?? '',
                      timeoutMs: (Number(v) || 5) * 1000,
                    })}
                  />
                </Space>
              </Space>
            )}
          </Space>

          <Divider orientation="left" plain>环境变量（可选）</Divider>
          {envRows.map((row) => (
            <Space key={row.id} style={{ display: 'flex', marginBottom: 8 }} align="center">
              <Input
                className="mono"
                style={{ width: 180 }}
                placeholder="KEY"
                value={row.key}
                onChange={(e) => setEnvVar(row.id, { key: e.target.value })}
              />
              <Input
                className="mono"
                style={{ width: 280 }}
                placeholder="value"
                value={row.value}
                onChange={(e) => setEnvVar(row.id, { value: e.target.value })}
              />
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => removeEnvVar(row.id)} />
            </Space>
          ))}
          <Button size="small" icon={<PlusOutlined />} onClick={addEnvVar} style={{ marginBottom: 12 }}>
            新增环境变量
          </Button>

          <Divider orientation="left" plain>
            命令列表 ({draft.commands.length})
          </Divider>

          {draft.commands.length === 0 && (
            <Typography.Text type="secondary">
              还没有命令。点击下方按钮新增，模板中用 {'{{占位符}}'} 定义参数。
            </Typography.Text>
          )}

          {draft.commands.map((c) => (
            <Card
              key={c.id}
              size="small"
              style={{ marginBottom: 10 }}
              styles={{ body: { padding: 12 } }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
                  <Space wrap>
                    <Typography.Text strong>{c.name}</Typography.Text>
                    {c.requiresRoot && <Tag color="red">需 root</Tag>}
                    {c.platforms?.map((p) => <Tag key={p}>{p}</Tag>)}
                    {c.timeoutMs && <Tag>超时 {Math.round(c.timeoutMs / 1000)}s</Tag>}
                    <Tag color="geekblue">{c.params.length} 参数</Tag>
                  </Space>
                  <Typography.Text className="mono" style={{ fontSize: 12, color: '#334155' }}>
                    {c.commandTemplate}
                  </Typography.Text>
                  {c.description && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{c.description}</Typography.Text>
                  )}
                </Space>
                {!readOnly && (
                  <Space direction="vertical" size={4}>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEditCommand(c)}>编辑</Button>
                    <Popconfirm
                      title="删除这条命令？"
                      onConfirm={() => deleteCommand(c.id)}
                      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                  </Space>
                )}
              </div>
            </Card>
          ))}

          {!readOnly && (
            <Button type="dashed" icon={<PlusOutlined />} onClick={openNewCommand} block>
              新增命令
            </Button>
          )}

          {blockers.length > 0 && (
            <Alert
              style={{ marginTop: 12 }}
              type="error" showIcon
              message="保存前需修正以下问题"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              }
            />
          )}
        </Form>
      </Drawer>

      <CommandEditor
        open={commandEditorOpen}
        command={editingCommand}
        clauses={clauses}
        onSave={saveCommand}
        onCancel={() => { setCommandEditorOpen(false); setEditingCommand(null); }}
      />
    </>
  );
}
