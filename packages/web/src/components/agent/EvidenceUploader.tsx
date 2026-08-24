import { useState } from 'react';
import { Upload, Button, Select, Space, Tag, Typography, message } from 'antd';
import { UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import { UploadApi } from '../../api/endpoints';
import { fileNameOf, fileRefUrl } from './utils';

const FUNCTION_MODULES = [
  'network',
  'crypto',
  'credential',
  'firmware',
  'authentication',
  'reconnaissance',
  'device-interaction',
  'other',
];

export interface UploadedEvidence {
  fileRef: string;
  name: string;
  mimeType?: string;
  functionModule?: string;
  url?: string;
}

export default function EvidenceUploader({
  value,
  onChange,
  functionModule,
  onFunctionModuleChange,
  disabled,
  multiple = true,
}: {
  value?: UploadedEvidence[];
  onChange?: (files: UploadedEvidence[]) => void;
  functionModule?: string;
  onFunctionModuleChange?: (m: string) => void;
  disabled?: boolean;
  multiple?: boolean;
}) {
  const files = value ?? [];
  const [uploading, setUploading] = useState(false);
  const [moduleTag, setModuleTag] = useState(functionModule ?? 'other');

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await UploadApi.upload(file);
      const next: UploadedEvidence = {
        fileRef: res.path,
        name: file.name,
        mimeType: file.type || undefined,
        functionModule: moduleTag,
        url: fileRefUrl(res.path),
      };
      onChange?.([...files, next]);
      message.success(`${file.name} 上传成功`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
    return false; // prevent antd's default XHR upload
  };

  const remove = (idx: number) => {
    onChange?.(files.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>功能模块：</Typography.Text>
          <Select
            size="small"
            style={{ width: 180 }}
            value={moduleTag}
            onChange={(v) => {
              setModuleTag(v);
              onFunctionModuleChange?.(v);
            }}
            options={FUNCTION_MODULES.map((m) => ({ value: m, label: m }))}
          />
          <Upload
            accept="image/*,.pcap,.log,.txt,.json,.bin,.pdf"
            multiple={multiple}
            showUploadList={false}
            beforeUpload={handleUpload}
            disabled={disabled}
          >
            <Button size="small" icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
              上传证据
            </Button>
          </Upload>
        </Space>
        {files.length > 0 && (
          <Space size={[4, 4]} wrap>
            {files.map((f, idx) => (
              <Tag
                key={`${f.fileRef}-${idx}`}
                closable
                closeIcon={<DeleteOutlined />}
                onClose={(e) => {
                  e.preventDefault();
                  remove(idx);
                }}
                color="blue"
              >
                {f.functionModule ? `[${f.functionModule}] ` : ''}
                {fileNameOf(f.name)}
              </Tag>
            ))}
          </Space>
        )}
      </Space>
    </div>
  );
}
