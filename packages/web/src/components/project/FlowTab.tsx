import { useMemo } from 'react';
import { Card, Row, Col, Empty, Tag, Typography, Timeline, Button, Space, Progress, Statistic, Tooltip } from 'antd';
import { RedoOutlined } from '@ant-design/icons';
import type { Template, ProjectRun, StepRun, Tool } from '@en18031/shared';
import {
  runStatusColor, runStatusText, stepStatusColor, stepStatusText, formatEta,
} from '../../utils/ui';

interface FlowTabProps {
  template?: Template;
  steps: StepRun[];
  tools: Tool[];
  running: boolean;
  activeRunId?: string;
  runs: ProjectRun[];
  overallProgress: number;
  eta?: string | null;
  onOpenStep: (s: StepRun) => void;
  onRetry: (stepRunId: string) => void;
  onSelectRun: (runId: string) => void;
  templateMissing?: boolean;
}

function handleKeyboard(e: React.KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

export default function FlowTab(props: FlowTabProps) {
  const {
    template, steps, tools, running, onOpenStep, onRetry, runs, activeRunId, onSelectRun,
    overallProgress, eta, templateMissing,
  } = props;

  const byStepId = useMemo(() => {
    const m = new Map<string, StepRun>();
    for (const s of steps) m.set(s.stepId, s);
    return m;
  }, [steps]);

  const toolById = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);

  // 聚合统计
  const stats = useMemo(() => {
    let completed = 0, runningCount = 0, failed = 0, pending = 0;
    for (const snap of template?.steps ?? []) {
      const sr = byStepId.get(snap.stepId);
      const st = sr?.status ?? 'pending';
      if (st === 'success') completed++;
      else if (st === 'running' || st === 'scheduled') runningCount++;
      else if (st === 'fail' || st === 'timeout') failed++;
      else pending++;
    }
    return { completed, runningCount, failed, pending, total: template?.steps.length ?? 0 };
  }, [template, byStepId]);

  const percent = overallProgress || (stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0);

  if (!template) {
    return (
      <Empty
        description={
          templateMissing ? '该项目由 Agent 引导创建，不使用编排模板——步骤由会话动态推进' : '无法加载模板（可能已被删除）'
        }
      >
        {templateMissing ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            请前往「Agent 测试」页查看该项目的测试会话进度。
          </Typography.Text>
        ) : undefined}
      </Empty>
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 汇总卡片 */}
      <Card size="small">
        <Row gutter={16} align="middle">
          <Col span={6}>
            <Statistic title="总体进度" value={percent} suffix="%" valueStyle={{ color: percent === 100 ? '#16a34a' : '#2563eb' }} />
          </Col>
          <Col span={4}><Statistic title="已完成" value={stats.completed} valueStyle={{ color: '#16a34a' }} /></Col>
          <Col span={4}><Statistic title="执行中" value={stats.runningCount} valueStyle={{ color: '#2563eb' }} /></Col>
          <Col span={4}><Statistic title="失败" value={stats.failed} valueStyle={{ color: '#dc2626' }} /></Col>
          <Col span={6}>
            {running && eta ? (
              <Typography.Text type="secondary">{formatEta(eta)}</Typography.Text>
            ) : running ? (
              <Typography.Text type="secondary">正在执行…</Typography.Text>
            ) : (
              <Typography.Text type="secondary">{stats.pending} 个等待中</Typography.Text>
            )}
          </Col>
        </Row>
        <Progress
          percent={percent}
          status={running ? 'active' : stats.failed > 0 ? 'exception' : 'success'}
          style={{ marginTop: 8, marginBottom: 0 }}
        />
      </Card>

      <Row gutter={16}>
        <Col span={6}>
          <Card size="small" title="历史运行">
            {runs.length === 0 ? <Empty description="暂无运行" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
              <Timeline
                items={runs.map((r) => ({
                  color: runStatusColor[r.status] as string,
                  children: (
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`查看运行 ${r.id}`}
                      onClick={() => onSelectRun(r.id)}
                      onKeyDown={(e) => handleKeyboard(e, () => onSelectRun(r.id))}
                      style={{ cursor: 'pointer',
                        background: r.id === activeRunId ? '#eff6ff' : 'transparent', padding: 4, borderRadius: 4 }}
                    >
                      <div><Tag color={runStatusColor[r.status]}>{runStatusText[r.status] ?? r.status}</Tag>
                        <span style={{ fontSize: 12 }}>{r.progressPercent}%</span></div>
                      <div className="mono" style={{ fontSize: 11, color: '#64748b' }}>{r.id}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {r.startedAt ? new Date(r.startedAt).toLocaleString('zh-CN') : '-'}
                      </div>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
        <Col span={18}>
          <Card size="small" title={`编排流程 · ${template.name} (${template.steps.length} 步)`}>
            {template.steps.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该模板还没有编排步骤"
                style={{ padding: '24px 0' }}
              >
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  请到「模板」页编辑添加步骤，或使用页头「单独执行工具」直接运行命令。
                </Typography.Text>
              </Empty>
            ) : template.steps.map((snap) => {
              const sr = byStepId.get(snap.stepId);
              const status = sr?.status ?? 'pending';
              const tool = toolById.get(snap.toolId);
              return (
                <div
                  key={snap.stepId}
                  className="step-row"
                  role={sr ? 'button' : undefined}
                  tabIndex={sr ? 0 : undefined}
                  aria-label={sr ? `查看步骤 ${snap.title}` : undefined}
                  onClick={() => sr && onOpenStep(sr)}
                  onKeyDown={(e) => { if (sr) handleKeyboard(e, () => onOpenStep(sr)); }}
                  style={{ cursor: sr ? 'pointer' : 'default' }}
                >
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space>
                      <Tag color={stepStatusColor[status]}>{stepStatusText[status] ?? status}</Tag>
                      <Typography.Text strong>{snap.title}</Typography.Text>
                      <Tag>{snap.stepId}</Tag>
                      <Tooltip
                        title={
                          tool ? (
                            <div>
                              <div><strong>{tool.name}</strong></div>
                              {tool.description && <div style={{ marginTop: 4 }}>{tool.description}</div>}
                              <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 11 }}>{tool.id} · v{tool.version}</div>
                            </div>
                          ) : (
                            <span>工具 {snap.toolId} 未找到</span>
                          )
                        }
                      >
                        <Tag color="blue" style={{ cursor: 'help' }}>
                          {tool?.name ?? snap.toolId}
                        </Tag>
                      </Tooltip>
                      {snap.onFailure === 'abort' && <Tag color="red">失败中止</Tag>}
                    </Space>
                    <Space>
                      {sr?.verdictCount ? <Tag color="green">{sr.verdictCount} 判定</Tag> : null}
                      {sr?.evidenceCount ? <Tag>{sr.evidenceCount} 证据</Tag> : null}
                      {sr && !running && (status === 'fail' || status === 'timeout') && (
                        <Button
                          size="small"
                          icon={<RedoOutlined />}
                          aria-label="重试此步骤"
                          onClick={(e) => { e.stopPropagation(); onRetry(sr.id); }}
                        >
                          重试
                        </Button>
                      )}
                    </Space>
                  </Space>
                  {sr && typeof sr.percent === 'number' && sr.percent > 0 && status === 'running' && (
                    <Progress percent={sr.percent} size="small" style={{ marginTop: 6, marginBottom: 0 }} />
                  )}
                  {sr?.error && (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>{sr.error.message}</Typography.Text>
                  )}
                </div>
              );
            })}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
