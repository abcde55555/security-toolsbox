import { Form, Input, InputNumber, Select, Switch, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import type { FormField, SelectOption } from '@en18031/shared';

const { TextArea } = Input;

function normalizeOptions(opts?: Array<string | SelectOption>): { label: string; value: string }[] {
  return (opts ?? []).map((o) =>
    typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value },
  );
}

export default function DynamicForm({
  fields,
  values,
  onChange,
  errors,
  layout = 'vertical',
}: {
  fields: FormField[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  errors?: Record<string, string>;
  layout?: 'vertical' | 'horizontal';
}) {
  if (fields.length === 0) {
    return <div style={{ color: '#94a3b8' }}>此命令没有可配置参数，可直接运行。</div>;
  }
  return (
    <Form layout={layout} size="middle">
      {fields.map((f) => {
        const err = errors?.[f.id];
        const label = (
          <span>
            {f.label}
            {f.description && (
              <Tooltip title={f.description}>
                <InfoCircleOutlined style={{ marginLeft: 6, color: '#94a3b8' }} />
              </Tooltip>
            )}
          </span>
        );
        return (
          <Form.Item
            key={f.id}
            label={label}
            required={f.required}
            validateStatus={err ? 'error' : undefined}
            help={err ?? (f.format && f.format !== 'plain' ? `格式: ${f.format}` : undefined)}
            style={{ marginBottom: 12 }}
          >
            {renderControl(f, values[f.id], (v) => onChange(f.id, v))}
          </Form.Item>
        );
      })}
    </Form>
  );
}

function renderControl(f: FormField, value: unknown, setValue: (v: unknown) => void) {
  const placeholder = f.placeholder ?? `请输入${f.label}`;
  switch (f.type) {
    case 'number':
    case 'stepper':
      return (
        <InputNumber
          style={{ width: '100%' }}
          placeholder={placeholder}
          min={f.min}
          max={f.max}
          value={value === '' || value === undefined ? undefined : Number(value)}
          onChange={(v) => setValue(v ?? undefined)}
        />
      );
    case 'textarea':
      return (
        <TextArea rows={3} placeholder={placeholder} value={String(value ?? '')} onChange={(e) => setValue(e.target.value)} />
      );
    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          placeholder={placeholder}
          options={normalizeOptions(f.options)}
          value={value === '' ? undefined : (value as string | undefined)}
          onChange={(v) => setValue(v)}
          allowClear
        />
      );
    case 'multiselect':
      return (
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder={placeholder}
          options={normalizeOptions(f.options)}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => setValue(v)}
        />
      );
    case 'checkbox':
      return <Switch checked={Boolean(value)} onChange={(v) => setValue(v)} />;
    case 'file':
      return (
        <Input placeholder="文件参数请在终端本地填写" disabled value={String(value ?? '')} />
      );
    case 'text':
    default:
      return (
        <Input
          placeholder={placeholder}
          value={String(value ?? '')}
          onChange={(e) => setValue(e.target.value)}
        />
      );
  }
}
