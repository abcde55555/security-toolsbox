import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Spin, Empty, Card, Row, Col, Typography, Tag, Space, Button, Table, message,
} from 'antd';
import { FileExcelOutlined, FileTextOutlined, FilePdfOutlined, CodeOutlined, RobotOutlined } from '@ant-design/icons';
import type { Report, ClauseNode } from '@en18031/shared';
import type { ReportDetail } from '../../api/endpoints';
import { ReportsApi } from '../../api/endpoints';
import { useRunStream } from '../../hooks/useRunStream';
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
  hasRuns: boolean;
  onRegenerate: () => void;
  onExport: () => void;
}

export default function ReportTab({
  loading, report, detail, summary, projectId, standardName, hasRuns, onRegenerate, onExport,
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
      <Empty
        description={
          hasRuns ? '尚未生成报告，可手动重新生成' : '运行测试后会自动生成报告'
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, maxWidth: 420, margin: '0 auto 16px' }}>
          报告汇总的是测试运行产生的条款判定结果。到「执行流程」标签页点击「开始测试」，
          运行结束后报告会自动生成。
        </Typography.Paragraph>
        {hasRuns && (
          <Button type="primary" onClick={onRegenerate}>重新生成报告</Button>
        )}
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
              <Button
                icon={<CodeOutlined />}
                onClick={() => window.open(ReportsApi.jsonUrl(projectId, report.id), '_blank')}
              >
                导出 JSON
              </Button>
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

      {/* AI 叙述报告：narrativeModel 异步生成，经 report:narrative 事件或轮询到达 */}
      {report.projectRunId !== undefined || report.narrative ? (
        <NarrativeSection projectId={projectId} report={report} />
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

/**
 * AI 叙述报告区：narrativeModel 在服务端异步成文。
 * 到达路径优先级：report:narrative 实时事件（挂在报告所属 run 房间）
 * > 触发后轮询 latest 兜底 > 直接展示已落库的 narrative。
 */
function NarrativeSection({ projectId, report }: { projectId: string; report: Report }) {
  const [narrative, setNarrative] = useState<string | null>(report.narrative ?? null);
  const [generating, setGenerating] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollLeft = useRef(0);

  useEffect(() => {
    setNarrative(report.narrative ?? null);
  }, [report.id, report.narrative]);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  useRunStream(report.projectRunId, {
    onNarrative: (p) => {
      if (p.reportId !== report.id) return;
      pollLeft.current = 0;
      stopPolling();
      setGenerating(false);
      setNarrative(p.narrative);
      message.success('AI 叙述报告已生成');
    },
  });

  const generate = async () => {
    try {
      await ReportsApi.regenerateNarrative(projectId, report.id);
      setGenerating(true);
      // Polling fallback in case the socket room is not joined (e.g. report
      // viewed without an active run subscription).
      pollLeft.current = 15;
      stopPolling();
      pollTimer.current = setInterval(async () => {
        if (pollLeft.current-- <= 0) {
          stopPolling();
          setGenerating(false);
          message.warning('叙述生成尚未完成，可稍后刷新查看');
          return;
        }
        try {
          const r = await ReportsApi.latest(projectId);
          if (r?.id === report.id && r.narrative) {
            stopPolling();
            setGenerating(false);
            setNarrative(r.narrative);
            message.success('AI 叙述报告已生成');
          }
        } catch {
          // transient transport error: keep polling
        }
      }, 3000);
    } catch (e) {
      setGenerating(false);
      message.error((e as Error).message);
    }
  };

  return (
    <Card
      size="small"
      title={
        <span>
          <RobotOutlined style={{ marginRight: 6, color: '#7c3aed' }} />
          AI 叙述报告
          <Tag style={{ marginLeft: 8 }} color="purple">
            narrativeModel
          </Tag>
        </span>
      }
      extra={
        <Button size="small" loading={generating} onClick={() => void generate()}>
          {narrative ? '重新生成' : '生成 AI 叙述'}
        </Button>
      }
    >
      {narrative ? (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {narrative}
        </Typography.Paragraph>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            generating
              ? '正在用成文模型撰写结论/风险/整改建议…'
              : '尚未生成叙述。点击右上角按钮，由成文模型基于统计数据与失败清单撰写。'
          }
        />
      )}
    </Card>
  );
}
