import { useState } from 'react';
import { Card, Typography, Space, Button } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import EvidenceUploader, { type UploadedEvidence } from './EvidenceUploader';

/**
 * Standalone evidence-attach card used on the timeline when the agent asks for
 * supplementary evidence outside of a dedicated human step. Upload goes through
 * the existing /api/upload endpoint; persisting to the session is wired to
 * onAttach (TODO: backend attach endpoint when available).
 */
export default function EvidenceAttachCard({
  functionModule,
  onAttach,
}: {
  functionModule?: string;
  onAttach?: (files: UploadedEvidence[]) => void;
}) {
  const [files, setFiles] = useState<UploadedEvidence[]>([]);
  const [mod, setMod] = useState(functionModule ?? 'other');

  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      title={<Space><PaperClipOutlined /> 补充证据</Space>}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        采集到的截图、抓包、日志等可在此上传，会归入当前会话并可被判定引用。
      </Typography.Paragraph>
      <EvidenceUploader
        value={files}
        onChange={setFiles}
        functionModule={mod}
        onFunctionModuleChange={setMod}
      />
      <Button
        size="small"
        type="primary"
        style={{ marginTop: 8 }}
        disabled={files.length === 0}
        onClick={() => {
          onAttach?.(files);
          setFiles([]);
        }}
      >
        关联到会话
      </Button>
    </Card>
  );
}
