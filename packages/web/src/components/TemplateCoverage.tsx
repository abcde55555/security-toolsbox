import { useEffect, useState } from 'react';
import { Drawer, Spin, Typography, Progress, Table, Tag, Space, Empty, Select } from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { TemplatesApi, StandardsApi, type TemplateCoverage as Coverage } from '../api/endpoints';
import { reportError } from '../api/client';

interface Props {
  open: boolean;
  templateId: string;
  onClose: () => void;
}

export default function TemplateCoverage({ open, templateId, onClose }: Props) {
  const [standards, setStandards] = useState<Array<{ id: string; name: string; version: string }>>([]);
  const [standardId, setStandardId] = useState('EN18031:2019');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    StandardsApi.list().then((ss) => {
      setStandards(ss);
      if (ss.length && !ss.find((s) => s.id === standardId)) setStandardId(ss[0].id);
    }).catch(reportError);
  }, [open]);

  useEffect(() => {
    if (!open || !templateId) return;
    setLoading(true);
    TemplatesApi.coverage(templateId, standardId)
      .then(setCoverage)
      .catch(reportError)
      .finally(() => setLoading(false));
  }, [open, templateId, standardId]);

  const color = coverage ? (coverage.coverage >= 80 ? '#16a34a' : coverage.coverage >= 50 ? '#d97706' : '#dc2626') : undefined;

  return (
    <Drawer
      title="条款覆盖度"
      placement="right"
      width={680}
      open={open}
      onClose={onClose}
    >
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Select
          style={{ width: 280 }}
          value={standardId}
          onChange={setStandardId}
          options={standards.map((s) => ({ value: s.id, label: `${s.name} (${s.version})` }))}
        />
        {coverage && (
          <Progress
            type="circle"
            size={64}
            percent={coverage.coverage}
            strokeColor={color}
            format={(p) => `${p}%`}
          />
        )}
      </Space>

      {loading ? (
        <Spin tip="计算覆盖度…" />
      ) : !coverage || coverage.total === 0 ? (
        <Empty description="该标准下没有条款" />
      ) : (
        <>
          <Typography.Paragraph type="secondary">
            模板通过其工具覆盖了 <strong>{coverage.coveredCount}</strong> / {coverage.total} 个条款。
            覆盖来源：模组声明的条款、命令工具的判定规则。
          </Typography.Paragraph>

          <Typography.Title level={5}>
            <CheckCircleFilled style={{ color: '#16a34a' }} /> 已覆盖 ({coverage.covered.length})
          </Typography.Title>
          <Table
            rowKey="clauseId"
            size="small"
            pagination={false}
            dataSource={coverage.covered}
            style={{ marginBottom: 16 }}
            columns={[
              { title: '条款', dataIndex: 'clauseId', width: 110, render: (v: string) => <code className="mono">{v}</code> },
              { title: '来源工具', dataIndex: 'toolName' },
              { title: '方式', dataIndex: 'via', width: 90, render: (v: string) => <Tag>{v === 'module' ? '模组' : '规则'}</Tag> },
            ]}
          />

          {coverage.uncovered.length > 0 && (
            <>
              <Typography.Title level={5}>
                <CloseCircleFilled style={{ color: '#dc2626' }} /> 未覆盖 ({coverage.uncovered.length})
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                这些条款没有任何工具产出判定。可在模板中增加对应工具，或为命令工具添加判定规则。
              </Typography.Paragraph>
              <Table
                rowKey="clauseId"
                size="small"
                pagination={{ pageSize: 8 }}
                dataSource={coverage.uncovered}
                columns={[
                  { title: '条款', dataIndex: 'clauseId', width: 110, render: (v: string) => <code className="mono">{v}</code> },
                  { title: '标题', dataIndex: 'title' },
                  { title: '章节', dataIndex: 'chapter', width: 80 },
                  { title: '等级', dataIndex: 'level', width: 70, render: (v: string) => <Tag>{v}</Tag> },
                ]}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
