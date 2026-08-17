import { useState } from 'react';
import { Segmented, Select, Input, Space, Typography, Button, InputNumber, Switch, Tag, Tooltip } from 'antd';
import { PlusOutlined, LinkOutlined, EditOutlined } from '@ant-design/icons';
import type { FormField, TemplateVariable } from '@en18031/shared';

/**
 * In a TEMPLATE, tool parameters must NOT carry real per-target values.
 * Each field is either:
 *   - bound to a project variable  -> stored as "{{project.varName}}"
 *   - a fixed literal value        -> stored as-is (e.g. a scan depth flag)
 *
 * The fixed-value editor mirrors DynamicForm's controls but stays inside the
 * template editor. Bound variables are collected into the template's
 * `variables` array so the project "变量" tab knows what to ask for.
 */

const BIND_RE = /^\{\{\s*project\.([A-Za-z0-9_-]+)\s*\}\}$/;

export function isBoundValue(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(BIND_RE);
  return m ? m[1] : null;
}

export function bindingPlaceholder(varName: string): string {
  return `{{project.${varName}}}`;
}

interface Props {
  fields: FormField[];
  params: Record<string, unknown>;
  variables: TemplateVariable[];
  onChange: (id: string, value: unknown) => void;
  onAddVariable: (v: TemplateVariable) => void;
}

export default function StepParamBinder({ fields, params, variables, onChange, onAddVariable }: Props) {
  return (
    <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px solid #eef0f4' }}>
      <div style={{ marginBottom: 8 }}>
        <Tag icon={<LinkOutlined />} color="blue">模板参数绑定</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          模板中不要填真实目标值。选择「绑定项目变量」，真实值在项目变量中填写。
        </Typography.Text>
      </div>
      {fields.map((f) => (
        <FieldRow
          key={f.id}
          field={f}
          value={params[f.id]}
          variables={variables}
          onChange={(v) => onChange(f.id, v)}
          onAddVariable={onAddVariable}
        />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  variables,
  onChange,
  onAddVariable,
}: {
  field: FormField;
  value: unknown;
  variables: TemplateVariable[];
  onChange: (v: unknown) => void;
  onAddVariable: (v: TemplateVariable) => void;
}) {
  const boundVar = isBoundValue(value);
  const [mode, setMode] = useState<'var' | 'fixed'>(boundVar ? 'var' : 'fixed');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const selectVar = (varName: string) => {
    if (!varName) return;
    onChange(bindingPlaceholder(varName));
  };

  const createVar = () => {
    const name = newName.trim().replace(/[^A-Za-z0-9_]/g, '_');
    if (!name) return;
    if (variables.some((v) => v.name === name)) {
      onChange(bindingPlaceholder(name));
      setCreating(false);
      setNewName('');
      setNewLabel('');
      return;
    }
    const type = inferType(field);
    onAddVariable({ name, label: newLabel.trim() || field.label, type, required: true });
    onChange(bindingPlaceholder(name));
    setCreating(false);
    setNewName('');
    setNewLabel('');
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Typography.Text strong style={{ fontSize: 13 }}>
          {field.label}
          {field.required && <span style={{ color: '#dc2626' }}> *</span>}
          <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{field.id}</Typography.Text>
        </Typography.Text>
        <Segmented
          size="small"
          value={mode}
          onChange={(m) => {
            setMode(m as 'var' | 'fixed');
            if (m === 'fixed' && boundVar) onChange('');
          }}
          options={[
            { label: '绑定项目变量', value: 'var' },
            { label: '固定值', value: 'fixed' },
          ]}
        />
      </Space>

      <div style={{ marginTop: 6 }}>
        {mode === 'var' ? (
          creating ? (
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="变量名 (英文，如 targetIp)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              <Input
                placeholder="显示名（可选）"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                style={{ width: 180 }}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={createVar}>创建并绑定</Button>
              <Button onClick={() => setCreating(false)}>取消</Button>
            </Space.Compact>
          ) : (
            <Space style={{ width: '100%' }} align="center">
              <Select
                style={{ flex: 1 }}
                placeholder="选择项目变量"
                value={boundVar ?? undefined}
                onChange={selectVar}
                options={variables.map((v) => ({
                  value: v.name,
                  label: `${v.label} ({{${v.name}}})`,
                }))}
              />
              <Tooltip title="新建一个项目变量并绑定">
                <Button icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建变量</Button>
              </Tooltip>
              {boundVar && (
                <Tag color="blue" icon={<LinkOutlined />}>{`{{project.${boundVar}}}`}</Tag>
              )}
            </Space>
          )
        ) : (
          <FixedControl field={field} value={value} onChange={onChange} />
        )}
      </div>
      {field.description && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{field.description}</Typography.Text>
      )}
    </div>
  );
}

function inferType(f: FormField): TemplateVariable['type'] {
  if (f.format === 'ip') return 'ip';
  if (f.format === 'cidr') return 'cidr';
  if (f.type === 'number' || f.format === 'port-range') return 'text';
  return 'text';
}

function FixedControl({ field, value, onChange }: { field: FormField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'number':
    case 'stepper':
      return (
        <InputNumber
          style={{ width: '100%' }}
          min={field.min}
          max={field.max}
          value={value === '' || value === undefined ? undefined : Number(value)}
          onChange={(v) => onChange(v ?? '')}
        />
      );
    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          options={(field.options ?? []).map((o) => (typeof o === 'string' ? { label: o, value: o } : o))}
          value={value === '' ? undefined : (value as string)}
          onChange={onChange}
          allowClear
        />
      );
    case 'checkbox':
      return <Switch checked={Boolean(value)} onChange={onChange} />;
    case 'textarea':
      return (
        <Input.TextArea rows={2} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    case 'file':
      return (
        <Input
          prefix={<EditOutlined />}
          placeholder="文件类型字段通常应绑定项目变量（运行时上传路径）"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          placeholder={`固定值（仅用于不随项目变化的参数）`}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
