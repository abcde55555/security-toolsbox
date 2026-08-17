import { useMemo } from 'react';
import {
  Spin, Empty, Card, Row, Col, Typography, Tag, Space, Button, Table,
} from 'antd';
import { FileExcelOutlined, FileTextOutlined, FilePdfOutlined } from '@ant-design/icons';
import type { Report, ClauseNode } from '@en18031/shared';
import type { ReportDetail } from '../../api/endpoints';
import { ReportsApi } from '../../api/endpoints';
import {
  gradeColor, gradeText, severityColor, severityText,
} from '../../utils/ui';

interface ReportClauseRow {
  clauseId: string;
  chapter: string;
  title: string;
  level: string;
  defaultSeverity: string;
  verdict?: { pass: boolean; reason: string; severity: string } | null;
  parentId?: string;
  isParent?: boolean;
}

interface ReportTabProps {
  loading: boolean;
  report: Report | null;
  detail: ReportDetail | null;
  summary?: Report['summary'];
  projectId: string;
  standardName?: string;
  onRegenerate: () => void;
  onExport: () => void;
}

export default function ReportTab({
  loading, report, detail, summary, projectId, standardName, onRegenerate, onExport,
}: ReportTabProps) {
  const clauses = (detail?.clauses ?? []) as ReportClauseRow[];

  // Build the parent/child tree from the flat list. Parent chapters carry a
  // roll-up verdict (computed server-side); leaves carry their own verdict.
  const treeData = useMemo(() => {
    type Node = ReportClauseRow & { children?: Node[] };
    const byId = new Map<string, Node>();
    for (const c of clauses) byId.set(c.clauseId, { ...c });
    const roots: Node[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        const parent = byId.get(node.parentId)!;
        (parent.children ??= []).push(node);
      } else {
        roots.push(node);
      }
    }
    const sortRec = (nodes: Node[]) => {
      nodes.sort((a, b) => a.clauseId.localeCompare(b.clauseId, undefined, { numeric: true }));
      nodes.forEach((n) => n.children && sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }, [clauses]);

  // Leaf-only counts for the chapter summary chips (parents are rolled up and
  // must not be double-counted in the metrics).
  const chapterStats = useMemo(() => {
    const map = new Map<string, { pass: number; fail: number; notCovered: number }>();
    for (const c of clauses) {
      if (c.isParent) continue;
      const ch = c.chapter || '其他';
      if (!map.has(ch)) map.set(ch, { pass: 0, fail: 0, notCovered: 0 });
      const g = map.get(ch)!;
      if (!c.verdict) g.notCovered++;
      else if (c.verdict.pass) g.pass++;
      else g.fail++;
    }
    return map;
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
            <Typography.Text type="secondary">{standardName ? `${standardName} · ` : ''}综合评级</Typography.Text>
          </Col>
          <Col span={14}>
            <Row gutter={8}>
              <Col span={6}><div className="metric-card"><div className="n">{summary.applicable}</div><div className="l">适用子项</div></div></Col>
              <Col span={6}><div className="metric-card"><div className="n clause-pass">{summary.pass}</div><div className="l">通过</div></div></Col>
              <Col span={6}><div className="metric-card"><div className="n clause-fail">{summary.fail}</div><div className="l">不通过</div></div></Col>
              <Col span={6}><div className="metric-card"><div className="n" style={{ color: '#6b7280' }}>{summary.notCovered}</div><div className="l">未覆盖</div></div></Col>
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
        <Card size="small" title="不通过子项（按严重度）">
          <Space size="large">
            <Tag color="red">高风险：{summary.failBySeverity.high}</Tag>
            <Tag color="orange">中风险：{summary.failBySeverity.middle}</Tag>
            <Tag color="blue">低风险：{summary.failBySeverity.low}</Tag>
          </Space>
        </Card>
      ) : null}

      {/* 层级条款明细：章节父项汇总子项判定 */}
      <Card size="small" title="条款判定明细（按章节层级）">
        <Table
          rowKey="clauseId"
          size="small"
          dataSource={treeData}
          pagination={false}
          defaultExpandAllRows
          columns={[
            {
              title: '编号', dataIndex: 'clauseId', width: 130,
              render: (v: string, r) => (
                <Space>
                  <code className="mono">{v}</code>
                  {r.isParent && <Tag color="geekblue">章节</Tag>}
                </Space>
              ),
            },
            { title: '标题', dataIndex: 'title', render: (v: string, r) => (
              <Typography.Text strong={r.isParent}>{v}</Typography.Text>
            ) },
            { title: '等级', dataIndex: 'level', width: 70, render: (v: string) => <Tag>{v}</Tag> },
            {
              title: '判定', key: 'v', width: 120,
              render: (_, r) => {
                const v = r.verdict;
                if (!v) return <span className="clause-na">{r.isParent ? '部分覆盖' : '未覆盖'}</span>;
                return (
                  <Tag color={v.pass ? 'green' : 'red'} className={v.pass ? 'clause-pass' : 'clause-fail'}>
                    {v.pass ? '通过' : '不通过'}
                    {r.isParent ? '（汇总）' : ''}
                  </Tag>
                );
              },
            },
            { title: '严重度', key: 'sev', width: 90, render: (_, r) => (r.verdict ? <Tag color={severityColor(r.verdict.severity)}>{severityText[r.verdict.severity] ?? r.verdict.severity}</Tag> : '-') },
            { title: '依据', key: 'reason', render: (_, r) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.verdict?.reason ?? '—'}</Typography.Text> },
          ]}
          scroll={{ x: 760 }}
        />
        {chapterStats.size > 0 && (
          <Space wrap style={{ marginTop: 12 }}>
            {Array.from(chapterStats.entries()).map(([ch, s]) => (
              <Tag key={ch}>
                {ch}: <span style={{ color: '#16a34a' }}>{s.pass}过</span> /{' '}
                <span style={{ color: '#dc2626' }}>{s.fail}败</span> /{' '}
                {s.notCovered}未覆盖
              </Tag>
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}
