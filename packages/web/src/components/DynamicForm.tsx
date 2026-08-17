import { useState } from 'react';
import { Form, Input, InputNumber, Select, Switch, Tooltip, Upload, Button, message } from 'antd';
import { InfoCircleOutlined, UploadOutlined, FileOutlined } from '@ant-design/icons';
import type { FormField, SelectOption } from '@en18031/shared';
import { UploadApi } from '../api/endpoints';

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
      return <FileUploadField value={value} setValue={setValue} accept={f.accept} maxSizeMb={f.maxSizeMb} />;
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

function FileUploadField({
  value,
  setValue,
  accept,
  maxSizeMb,
}: {
  value: unknown;
  setValue: (v: unknown) => void;
  accept?: string;
  maxSizeMb?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const path = typeof value === 'string' ? value : '';

  const handleUpload = async (file: File) => {
    const maxBytes = (maxSizeMb ?? 200) * 1024 * 1024;
    if (file.size > maxBytes) {
      message.error(`文件超过大小限制 ${maxSizeMb ?? 200}MB`);
      return false;
    }
    setUploading(true);
    try {
      const result = await UploadApi.upload(file);
      setValue(result.path);
      message.success('文件上传成功');
    } catch {
      message.error('文件上传失败');
    } finally {
      setUploading(false);
    }
    return false; // prevent antd default upload
  };

  if (path) {
    return (
      <Input
        readOnly
        value={path}
        prefix={<FileOutlined />}
        addonAfter={
          <Button size="small" type="link" onClick={() => setValue('')}>
            重新上传
          </Button>
        }
      />
    );
  }

  return (
    <Upload.Dragger
      accept={accept}
      showUploadList={false}
      beforeUpload={handleUpload}
      disabled={uploading}
    >
      <p className="ant-upload-drag-icon">
        <UploadOutlined />
      </p>
      <p className="ant-upload-text" style={{ marginBottom: 4 }}>
        {uploading ? '上传中…' : '点击或拖拽文件到此区域上传'}
      </p>
      {maxSizeMb && (
        <p className="ant-upload-hint" style={{ fontSize: 12, color: '#94a3b8' }}>
          单文件上限 {maxSizeMb}MB
        </p>
      )}
    </Upload.Dragger>
  );
}
