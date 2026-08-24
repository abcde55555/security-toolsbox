import { useMemo, useState } from 'react';
import { Tabs, Card, List, Tag, Typography, Image, Space, Empty, Button, Input } from 'antd';
import {
  FileOutlined,
  PictureOutlined,
  AppstoreOutlined,
  ExperimentOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import type { Artifact } from '@en18031/shared';
import type { AgentEvidence } from '../../api/endpoints';
import { fileRefUrl, fileNameOf, isImageRef } from './utils';
import EvidenceUploader, { type UploadedEvidence } from './EvidenceUploader';

const ARTIFACT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  device_profile: { label: '设备档案', icon: <AppstoreOutlined /> },
  network_topology: { label: '网络拓扑', icon: <ExperimentOutlined /> },
  onboarding_result: { label: '接入结果', icon: <FileOutlined /> },
  other: { label: '其他工件', icon: <FileOutlined /> },
};

function EvidenceImage({ refs }: { refs: string[] }) {
  const images = refs.filter(isImageRef);
  if (images.length === 0) {
    return (
      <Space size={4} wrap>
        {refs.map((r) => (
          <Button key={r} size="small" type="link" icon={<LinkOutlined />} href={fileRefUrl(r)} target="_blank">
            {fileNameOf(r)}
          </Button>
        ))}
      </Space>
    );
  }
  return (
    <Image.PreviewGroup>
      <Space size={6} wrap>
        {images.map((r) => (
          <Image
            key={r}
            src={fileRefUrl(r)}
            width={64}
            height={64}
            style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #e2e8f0' }}
          />
        ))}
        {refs.filter((r) => !isImageRef(r)).map((r) => (
          <Button key={r} size="small" type="link" icon={<FileOutlined />} href={fileRefUrl(r)} target="_blank">
            {fileNameOf(r)}
          </Button>
        ))}
      </Space>
    </Image.PreviewGroup>
  );
}

export default function ArtifactPanel({
  artifacts,
  evidences,
  onUploadEvidence,
}: {
  artifacts: Artifact[];
  evidences: AgentEvidence[];
  onUploadEvidence?: (files: UploadedEvidence[]) => void;
}) {
  const [manualFiles, setManualFiles] = useState<UploadedEvidence[]>([]);

  const images = useMemo(() => evidences.filter((e) => e.fileRef && isImageRef(e.fileRef)), [evidences]);
  const files = useMemo(() => evidences.filter((e) => e.fileRef && !isImageRef(e.fileRef)), [evidences]);

  return (
    <Tabs
      size="small"
      defaultActiveKey="artifacts"
      items={[
        {
          key: 'artifacts',
          label: `工件 (${artifacts.length})`,
          children: artifacts.length === 0 ? (
            <Empty description="暂无工件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              size="small"
              dataSource={artifacts}
              renderItem={(a) => {
                const meta = ARTIFACT_META[a.type] ?? ARTIFACT_META.other;
                return (
                  <Card size="small" style={{ marginBottom: 8 }}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space>
                        {meta.icon}
                        <Typography.Text strong>{a.title ?? meta.label}</Typography.Text>
                        <Tag>{a.functionModule ?? a.type}</Tag>
                      </Space>
                      {a.content && (
                        <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: '展开' }} style={{ fontSize: 12, marginBottom: 0 }}>
                          {a.content}
                        </Typography.Paragraph>
                      )}
                      {a.fileRefs.length > 0 && <EvidenceImage refs={a.fileRefs} />}
                    </Space>
                  </Card>
                );
              }}
            />
          ),
        },
        {
          key: 'evidence',
          label: (
            <span>
              <PictureOutlined /> 证据 ({evidences.length})
            </span>
          ),
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {images.length > 0 && (
                <Card size="small" title="截图/图片">
                  <Image.PreviewGroup>
                    <Space size={6} wrap>
                      {images.map((e) => (
                        <Image
                          key={e.id}
                          src={fileRefUrl(e.fileRef)}
                          width={72}
                          height={72}
                          style={{ objectFit: 'cover', borderRadius: 4 }}
                        />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                </Card>
              )}
              {files.length > 0 && (
                <Card size="small" title="文件">
                  <List
                    size="small"
                    dataSource={files}
                    renderItem={(e) => (
                      <List.Item>
                        <Space>
                          {e.functionModule && <Tag>{e.functionModule}</Tag>}
                          <Button size="small" type="link" icon={<FileOutlined />} href={fileRefUrl(e.fileRef)} target="_blank">
                            {fileNameOf(e.fileRef!)}
                          </Button>
                          {e.content && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{e.content}</Typography.Text>}
                        </Space>
                      </List.Item>
                    )}
                  />
                </Card>
              )}
              <Card size="small" title="上传证据">
                <EvidenceUploader value={manualFiles} onChange={setManualFiles} />
                <Button
                  size="small"
                  type="primary"
                  style={{ marginTop: 8 }}
                  disabled={manualFiles.length === 0}
                  onClick={() => {
                    onUploadEvidence?.(manualFiles);
                    setManualFiles([]);
                  }}
                >
                  关联到会话
                </Button>
              </Card>
              {evidences.length === 0 && <Empty description="暂无证据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Space>
          ),
        },
      ]}
    />
  );
}
