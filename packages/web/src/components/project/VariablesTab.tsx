import { useEffect, useState } from 'react';
import { Card, Button, Empty, Table, Tag, Typography, Input, InputNumber, Space, message, Collapse } from 'antd';
import { SaveOutlined, EditOutlined } from '@ant-design/icons';
import type { Project, Template, TemplateVariable } from '@en18031/shared';
import { validateFieldFormat } from '@en18031/shared';
import { ProjectsApi } from '../../api/endpoints';
import { reportError } from '../../api/client';

interface VariablesTabProps {
  project: Project;
  template?: Template;
  onSaved?: (project: Project) => void;
}

const TYPE_HINT: Record<TemplateVariable['type'], string> = {
  text: '文本',
  number: '数字',
  ip: 'IPv4 地址，如 192.168.1.1',
  cidr: '网段，如 192.168.1.0/24',
  list: '列表，如 192.168.1.1,192.168.1.2',
};

export default function VariablesTab({ project, template, onSaved }: VariablesTabProps) {
  const declared = template?.variables ?? [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [rawJson, setRawJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(declared.length === 0);

  useEffect(() => {
    setValues({ ...(project.variables as Record<string, unknown>) });
    setRawJson(JSON.stringify(project.variables ?? {}, null, 2));
  }, [project]);

  const setVal = (name: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const validate = (): string | null => {
    for (const v of declared) {
      const val = values[v.name];
      const empty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
      if (v.required && empty) return `变量「${v.label}」(${v.name}) 必填`;
      if (!empty && (typeof val === 'string' || typeof val === 'number')) {
        const err = validateFieldFormat(v.format, val);
        if (err) return `${v.label}: ${err}`;
      }
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { message.error(err); return; }
    setSaving(true);
    try {
      let payload = values;
      if (editing && declared.length === 0) {
        try { payload = JSON.parse(rawJson); }
        catch { message.error('JSON 格式错误'); setSaving(false); return; }
      }
      await ProjectsApi.setVariables(project.id, payload);
      message.success('变量已保存');
      const p = await ProjectsApi.get(project.id);
      onSaved?.(p);
    } catch (e) { reportError(e); }
    finally { setSaving(false); }
  };

  if (declared.length === 0) {
    return (
      <Card
        title="项目变量"
        extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>}
      >
        <Empty
          description="模板未声明结构化变量"
          style={{ marginBottom: 12 }}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          直接编辑自由变量 JSON：
        </Typography.Text>
        <Input.TextArea
          className="mono"
          rows={10}
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
        />
      </Card>
    );
  }

  return (
    <Card
      title="项目变量"
      extra={
        <Space>
          <Button icon={<EditOutlined />} onClick={() => setEditing((v) => !v)}>
            {editing ? '表单模式' : 'JSON 模式'}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存变量</Button>
        </Space>
      }
    >
      {editing ? (
        <Input.TextArea
          className="mono"
          rows={10}
          value={JSON.stringify(values, null, 2)}
          onChange={(e) => {
            setRawJson(e.target.value);
            try { setValues(JSON.parse(e.target.value)); } catch { /* ignore partial */ }
          }}
        />
      ) : (
        <Table
          rowKey="name"
          pagination={false}
          dataSource={declared}
          columns={[
            {
              title: '变量',
              dataIndex: 'name',
              width: 200,
              render: (v: string, r) => (
                <Space direction="vertical" size={0}>
                  <code className="mono">{`{{project.${v}}}`}</code>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Typography.Text>
                </Space>
              ),
            },
            { title: '类型', dataIndex: 'type', width: 80, render: (v: string) => <Tag>{v}</Tag> },
            { title: '必填', dataIndex: 'required', width: 70, render: (v: boolean) => (v ? <Tag color="red">是</Tag> : '否') },
            {
              title: '当前值',
              key: 'val',
              render: (_, r) => (
                <VarInput variable={r} value={values[r.name]} onChange={(v) => setVal(r.name, v)} />
              ),
            },
          ]}
        />
      )}
      <Collapse ghost size="small" style={{ marginTop: 8 }}
        items={[{ key: '1', label: '说明', children: (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {declared.map((v) => (
              <li key={v.name}><code className="mono">{v.name}</code> — {TYPE_HINT[v.type]}</li>
            ))}
          </ul>
        )}]}
      />
    </Card>
  );
}

function VarInput({
  variable,
  value,
  onChange,
}: {
  variable: TemplateVariable;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (variable.type === 'number') {
    return (
      <InputNumber
        style={{ width: '100%' }}
        value={value === '' || value === undefined ? undefined : Number(value)}
        onChange={(v) => onChange(v ?? '')}
      />
    );
  }
  if (variable.type === 'list') {
    return (
      <Input
        placeholder="多个值用逗号分隔"
        value={Array.isArray(value) ? value.join(',') : String(value ?? '')}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
      />
    );
  }
  return (
    <Input
      placeholder={variable.format ? TYPE_HINT[variable.type] : `请输入${variable.label}`}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
