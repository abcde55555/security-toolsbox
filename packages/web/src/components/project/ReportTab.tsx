import { useMemo } from 'react';
import {
  Spin, Empty, Card, Row, Col, Typography, Tag, Space, Button, Table, Collapse,
} from 'antd';
import { FileExcelOutlined, FileTextOutlined, FilePdfOutlined } from '@ant-design/icons';
import type { Report } from '@en18031/shared';
import type { ReportDetail } from '../../api/endpoints';
import { ReportsApi } from '../../api/endpoints';
import {
  gradeColor, gradeText, severityColor, severityText,
} from '../../utils/ui';

interface ReportTabProps {
  loading: boolean;
  report: Report | null;
  detail: ReportDetail | null;
  summary?: Report['summary'];
  projectId: string;
  onRegenerate: () => void;
  onExport: () => void;
}

export default function ReportTab({
  loading, report, detail, summary, projectId, onRegenerate, onExport,
}: ReportTabProps) {
  const clauses = detail?.clauses ?? [];

  // 按章节分组
  const chapters = useMemo(() => {
    const map = new Map<string, {
      chapter: string;
      pass: number;
      fail: number;
      notCovered: number;
      clauses: typeof clauses;
    }>();
    for (const c of clauses) {
      const ch = c.chapter || '其他';
      if (!map.has(ch)) {
        map.set(ch, { chapter: ch, pass: 0, fail: 0, notCovered: 0, clauses: [] });
      }
      const group = map.get(ch)!;
      group.clauses.push(c);
      if (!c.verdict) group.notCovered++;
      else if (c.verdict.pass) group.pass++;
      else group.fail++;
    }
    return Array.from(map.values()).sort((a, b) => a.chapter.localeCompare(b.chapter));
  }, [clauses]);

  if (loading) return <Spin tip="加载报告…" />;
  if (!report || !summary) {
    return (
      <Empty description="尚未生成合规报告">
        <Button type="primary" onClick={onRegenerate}>生成报告</Button>
      </Empty>
    );
  }

  const exportHtml = () => {
    const url = ReportsApi.html(projectId, report.id);
    window.open(url, '_blank');
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card>
        <Row gutter={16} align="middle">
          <Col span={4} style={{ textAlign: 'center' }}>
            <div className="grade-tag" style={{ color: gradeColor[report.grade] }}>{gradeText[report.grade] ?? report.grade}</div>
            <Typography.Text type="secondary">综合评级</Typography.Text>
          </Col>
          <Col span={14}>
            <Row gutter={8}>
              <Col span={5}><div className="metric-card"><div className="n">{summary.applicable}</div><div className="l">适用条款</div></div></Col>
              <Col span={5}><div className="metric-card"><div className="n clause-pass">{summary.pass}</div><div className="l">通过</div></div></Col>
              <Col span={5}><div className="metric-card"><div className="n clause-fail">{summary.fail}</div><div className="l">不通过</div></div></Col>
              <Col span={5}><div className="metric-card"><div className="n" style={{ color: '#6b7280' }}>{summary.notCovered}</div><div className="l">未覆盖</div></div></Col>
              <Col span={4}><div className="metric-card"><div className="n" style={{ color: '#ea580c' }}>{summary.conditional}</div><div className="l">有条件</div></div></Col>
            </Row>
          </Col>
          <Col span={6} style={{ textAlign: 'right' }}>
            <Space direction="vertical">
              <Button type="primary" icon={<FileTextOutlined />} onClick={onRegenerate}>重新生成</Button>
              <Button icon={<FileExcelOutlined />} onClick={onExport}>导出 Excel</Button>
              <Button icon={<FilePdfOutlined />} onClick={exportHtml}>导出 PDF</Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}
              </Typography.Text>
            </Space>
          </Col>
        </Row>
      </Card>

      {summary.failBySeverity && (summary.failBySeverity.high || summary.failBySeverity.middle || summary.failBySeverity.low) ? (
        <Card size="small" title="不通过条款（按严重度）">
          <Space size="large">
            <Tag color="red">高风险：{summary.failBySeverity.high}</Tag>
            <Tag color="orange">中风险：{summary.failBySeverity.middle}</Tag>
            <Tag color="blue">低风险：{summary.failBySeverity.low}</Tag>
          </Space>
        </Card>
      ) : null}

      {/* 按章节分组的条款明细 */}
      <Card size="small" title={`条款判定明细 (${clauses.length})`}>
        <Collapse
          defaultActiveKey={chapters.slice(0, 3).map((c) => c.chapter)}
          items={chapters.map((ch) => ({
            key: ch.chapter,
            label: (
              <Space>
                <Typography.Text strong>{ch.chapter}</Typography.Text>
                <Tag color="green">{ch.pass} 通过</Tag>
                <Tag color="red">{ch.fail} 不通过</Tag>
                <Tag>{ch.notCovered} 未覆盖</Tag>
              </Space>
            ),
            children: (
              <Table
                rowKey="clauseId"
                size="small"
                dataSource={ch.clauses}
                pagination={false}
                columns={[
                  { title: '条款', dataIndex: 'clauseId', width: 120, render: (v: string) => <code className="mono">{v}</code> },
                  { title: '标题', dataIndex: 'title' },
                  { title: '等级', dataIndex: 'level', width: 80, render: (v: string) => <Tag>{v}</Tag> },
                  {
                    title: '判定', key: 'v', width: 120,
                    render: (_, r) => {
                      const v = r.verdict;
                      if (!v) return <span className="clause-na">未覆盖</span>;
                      return (
                        <Tag color={v.pass ? 'green' : 'red'} className={v.pass ? 'clause-pass' : 'clause-fail'}>
                          {v.pass ? '通过' : '不通过'}
                        </Tag>
                      );
                    },
                  },
                  { title: '严重度', key: 'sev', width: 90, render: (_, r) => (r.verdict ? <Tag color={severityColor(r.verdict.severity)}>{severityText[r.verdict.severity] ?? r.verdict.severity}</Tag> : '-') },
                  { title: '依据', key: 'reason', render: (_, r) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.verdict?.reason ?? '—'}</Typography.Text> },
                ]}
                scroll={{ x: 760 }}
              />
            ),
          }))}
        />
      </Card>
    </Space>
  );
}
