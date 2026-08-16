import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout, Button, Tag, Space, Typography, Spin, Empty, Card, Tabs, Table, Modal, Form,
  Input, message, Progress, Descriptions, Statistic, Row, Col, Drawer, Popconfirm, Timeline, Cascader,
  Tooltip, Alert,
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, StopOutlined, ReloadOutlined,
  FileExcelOutlined, FileTextOutlined, RedoOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Project, ProjectRun, StepRun, Template, AuditLog, Report, Tool, ToolCommand,
} from '@en18031/shared';
import { ProjectsApi, TemplatesApi, ReportsApi, ToolsApi, type StepRunDetail, type ReportDetail } from '../api/endpoints';
import { reportError } from '../api/client';
import { useRunStream } from '../api/socket';
import {
  runStatusColor, runStatusText, stepStatusColor, stepStatusText,
  projectStatusColor, projectStatusText,
  gradeColor, gradeText, severityColor,
} from '../utils/ui';
import CommandRunList from '../components/CommandRunList';
import RunCommandModal from '../components/RunCommandModal';

const { Content } = Layout;
const { TextArea } = Input;

const TERMINAL = ['success', 'fail', 'partial', 'cancelled', 'timeout'];
function isTerminal(s?: string): boolean {
  return !!s && TERMINAL.includes(s);
}

interface LogLine { ts: string; text: string; kind: 'in' | 'ok' | 'err' | 'warn' }

export default function ProjectDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project & { latestRun?: ProjectRun }>();
  const [template, setTemplate] = useState<Template>();
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const [steps, setSteps] = useState<StepRun[]>([]);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [tab, setTab] = useState('flow');
  const [busy, setBusy] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);
  const [varJson, setVarJson] = useState('{}');
  const [stepDetail, setStepDetail] = useState<StepRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [singleRun, setSingleRun] = useState<{ tool: Tool; command: ToolCommand } | null>(null);
  const [cmdRunsVersion, setCmdRunsVersion] = useState(0);
  const termRef = useRef<HTMLDivElement>(null);
  const loadSeq = useRef(0);

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) ?? project?.latestRun,
    [runs, activeRunId, project],
  );
  const running = !!activeRun && !isTerminal(activeRun.status);

  const appendLog = useCallback((text: string, kind: LogLine['kind'] = 'in') => {
    setLogs((prev) => {
      const next = [...prev, { ts: new Date().toLocaleTimeString('zh-CN'), text, kind }];
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
  }, []);

  const loadProject = useCallback(async () => {
    const seq = ++loadSeq.current;
    const p = await ProjectsApi.get(id);
    if (loadSeq.current !== seq) return;
    setProject(p);
    if (p.templateId) {
      const tid = p.templateId;
      TemplatesApi.get(tid).then((t) => {
        if (loadSeq.current === seq) setTemplate(t);
      }).catch(() => undefined);
    }
    const rs = await ProjectsApi.listRuns(id);
    if (loadSeq.current !== seq) return;
    setRuns(rs);
    const current = p.latestRun?.id ?? rs[0]?.id;
    setActiveRunId((prev) => prev ?? current);
    if (current) {
      const ss = await ProjectsApi.listSteps(id, current);
      if (loadSeq.current === seq) setSteps(ss);
    }
  }, [id]);

  const loadReport = useCallback(async () => {
    const seq = loadSeq.current;
    setReportLoading(true);
    try {
      const latest = await ReportsApi.latest(id);
      if (loadSeq.current !== seq) return;
      setReport(latest);
      if (latest) {
        const d = await ReportsApi.detail(id, latest.id);
        if (loadSeq.current === seq) setReportDetail(d);
      } else {
        setReportDetail(null);
      }
    } catch (e) {
      reportError(e);
    } finally {
      if (loadSeq.current === seq) setReportLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setBusy(true);
    setActiveRunId(undefined);
    setSteps([]);
    setLogs([]);
    setProgress(0);
    setReport(null);
    setReportDetail(null);
    loadProject().then(loadReport).catch(reportError).finally(() => setBusy(false));
    ToolsApi.list({ pageSize: 200 })
      .then((res) => setTools(res.items))
      .catch(reportError);
  }, [loadProject, loadReport]);

  const toolById = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);
  const runnableTools = useMemo(() => tools.filter((t) => (t.commands ?? []).length > 0), [tools]);
  const templateSteps = template?.steps ?? [];
  const commandManualSteps = useMemo(
    () => templateSteps.filter((s) => {
      const t = toolById.get(s.toolId);
      return !!t && t.type === 'custom' && (t.commands?.length ?? 0) > 0;
    }).map((s) => s.title),
    [templateSteps, toolById],
  );
  const moduleStepCount = useMemo(
    () => templateSteps.filter((s) => toolById.get(s.toolId)?.type === 'module').length,
    [templateSteps, toolById],
  );
  const canStartOrchestration = !running && moduleStepCount > 0;

  const refreshSteps = useCallback(async (runId: string) => {
    try {
      const ss = await ProjectsApi.listSteps(id, runId);
      setSteps(ss);
    } catch { /* ignore */ }
  }, [id]);

  useRunStream(activeRunId, {
    onLogLine: (p) => appendLog(p.line, /err|fail|error/i.test(p.line) ? 'err' : 'in'),
    onProgress: (p) => {
      if (typeof p.percent === 'number') setProgress(Math.max(0, Math.min(100, p.percent)));
      if (p.message) appendLog(p.message, 'in');
    },
    onStatus: (p) => {
      if (p.stepRunId && p.stepId) {
        setSteps((prev) => {
          const idx = prev.findIndex((s) => s.id === p.stepRunId || s.stepId === p.stepId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], status: p.status as StepRun['status'], percent: p.percent ?? next[idx].percent };
            return next;
          }
          if (template) {
            const snap = template.steps.find((s) => s.stepId === p.stepId);
            if (snap) {
              return [...prev, {
                id: p.stepRunId, projectRunId: activeRunId!, stepId: p.stepId, stepSnapshot: snap,
                status: p.status as StepRun['status'], evidenceCount: 0, verdictCount: 0, percent: p.percent ?? 0,
              } as StepRun];
            }
          }
          return prev;
        });
      }
      // run-level status (command runs) has no stepRunId; per-step events shouldn't log "运行结束"
      if (!p.stepRunId) {
        if (p.status === 'success' || p.status === 'fail' || p.status === 'partial') {
          appendLog(`运行结束：${runStatusText[p.status] ?? p.status}`, p.status === 'success' ? 'ok' : 'err');
        } else {
          appendLog(`状态：${runStatusText[p.status] ?? p.status}`, 'in');
        }
      }
    },
    onBatchProgress: (p) => {
      if (typeof p.percent === 'number') setProgress(Math.max(0, Math.min(100, p.percent)));
      if (p.status) {
        setRuns((prev) => prev.map((r) => (r.id === p.runId
          ? { ...r, status: p.status as ProjectRun['status'], progressPercent: p.percent ?? r.progressPercent }
          : r)));
        if (p.status === 'success' || p.status === 'fail' || p.status === 'partial') {
          appendLog(`运行结束：${runStatusText[p.status] ?? p.status}`, p.status === 'success' ? 'ok' : 'err');
        }
      }
    },
  });

  useEffect(() => {
    if (!activeRunId || !running) return;
    const t = setInterval(() => {
      void refreshSteps(activeRunId);
      // reconcile run status in case the terminal socket event was missed (fast runs / reconnect)
      ProjectsApi.getRun(id, activeRunId).then((r) => {
        if (isTerminal(r.status)) {
          setRuns((prev) => prev.map((x) => (x.id === r.id ? r : x)));
        }
      }).catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [activeRunId, running, refreshSteps, id]);

  useEffect(() => {
    if (activeRun && isTerminal(activeRun.status)) {
      setProgress(activeRun.progressPercent ?? 100);
      if (activeRunId) void refreshSteps(activeRunId);
      setRuns((prev) => prev.map((r) => (r.id === activeRun.id ? activeRun : r)));
      void loadReport();
    } else if (activeRun) {
      setProgress(activeRun.progressPercent ?? 0);
    }
  }, [activeRun, activeRunId, refreshSteps, loadReport]);

  useEffect(() => {
    if (tab !== 'log') return;
    ProjectsApi.logs(id, { page: String(auditPage), pageSize: '20' })
      .then((res) => { setAudit(res.items); setAuditTotal(res.total); })
      .catch(reportError);
  }, [tab, auditPage, id, runs.length]);

  useEffect(() => {
    if (tab === 'term' && termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs, tab]);

  const startRun = async () => {
    setLogs([]);
    setSteps([]);
    setProgress(0);
    setBusy(true);
    try {
      const run = await ProjectsApi.startRun(id, {});
      appendLog(`已启动运行 ${run.id}`, 'ok');
      setActiveRunId(run.id);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      setTab('flow');
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    if (!activeRunId) return;
    try {
      await ProjectsApi.cancelRun(id, activeRunId);
      appendLog('已请求取消运行…', 'warn');
    } catch (e) { reportError(e); }
  };

  const retryStep = async (stepRunId: string) => {
    if (!activeRunId) return;
    try {
      await ProjectsApi.retryStep(id, activeRunId, stepRunId);
      message.success('已重试该步骤');
      await refreshSteps(activeRunId);
    } catch (e) { reportError(e); }
  };

  const openStep = async (s: StepRun) => {
    if (!activeRunId) return;
    setDetailLoading(true);
    setStepDetail(null);
    try {
      const d = await ProjectsApi.getStep(id, activeRunId, s.id);
      setStepDetail(d);
    } catch (e) { reportError(e); }
    finally { setDetailLoading(false); }
  };

  const openVars = () => {
    setVarJson(JSON.stringify(project?.variables ?? {}, null, 2));
    setVarsOpen(true);
  };

  const saveVars = async () => {
    let vars: Record<string, unknown>;
    try { vars = JSON.parse(varJson); }
    catch { message.error('JSON 格式错误'); return; }
    try {
      await ProjectsApi.setVariables(id, vars);
      message.success('变量已保存');
      setVarsOpen(false);
      const p = await ProjectsApi.get(id);
      setProject(p);
    } catch (e) { reportError(e); }
  };

  const regenerateReport = async () => {
    setReportLoading(true);
    try {
      const r = await ReportsApi.generate(id, activeRunId);
      message.success('报告已生成');
      setReport(r);
      const d = await ReportsApi.detail(id, r.id);
      setReportDetail(d);
    } catch (e) { reportError(e); }
    finally { setReportLoading(false); }
  };

  const exportExcel = async () => {
    if (!report) return;
    try {
      const r = await ReportsApi.exportExcel(id, report.id);
      window.open(`/api/projects/${id}/reports/${report.id}/download?file=${encodeURIComponent(r.fileName)}`, '_blank');
    } catch (e) { reportError(e); }
  };

  if (busy && !project) {
    return <Content style={{ padding: 24 }}><Spin tip="加载项目中…" /></Content>;
  }
  if (!project) {
    return <Content style={{ padding: 24 }}><Empty description="项目不存在" /></Content>;
  }

  const summary = report?.summary;

  return (
    <Content style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>返回</Button>
          <Typography.Title level={4} style={{ margin: 0 }}>{project.name}</Typography.Title>
          <Tag color={activeRun ? runStatusColor[activeRun.status] : projectStatusColor[project.status]}>
            {activeRun
              ? (runStatusText[activeRun.status] ?? activeRun.status)
              : (projectStatusText[project.status] ?? project.status)}
          </Tag>
          <Tag color="blue">{project.targetComplianceLevel}</Tag>
          <Tag>{template?.name ?? project.templateId}</Tag>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadProject()}>刷新</Button>
          <Button onClick={openVars}>变量配置</Button>
          <Cascader
            placeholder="单独执行工具（跳过编排）…"
            style={{ width: 260 }}
            value={undefined}
            onChange={(v: (string | number)[] | undefined) => {
              if (!v || v.length < 2) return;
              const tool = runnableTools.find((t) => t.id === v[0]);
              const cmd = tool?.commands?.find((c) => c.id === v[1]);
              if (tool && cmd) setSingleRun({ tool, command: cmd });
            }}
            options={runnableTools.map((t) => ({
              value: t.id,
              label: t.name,
              children: (t.commands ?? []).map((c) => ({ value: c.id, label: c.name })),
            }))}
            changeOnSelect={false}
            allowClear={false}
            suffixIcon={<ThunderboltOutlined />}
          />
          {running ? (
            <Button danger icon={<StopOutlined />} onClick={() => void cancelRun()}>取消运行</Button>
          ) : (
            <Tooltip title={moduleStepCount === 0 ? '该模板没有可编排执行的模组步骤，请在模板中添加模组，或用「单独执行工具」直接运行命令' : undefined}>
              <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} disabled={!canStartOrchestration} onClick={() => void startRun()}>
                开始测试
              </Button>
            </Tooltip>
          )}
        </Space>
      </Space>

      {running && (
        <Progress percent={progress} status="active" style={{ marginBottom: 12 }} />
      )}

      {!running && commandManualSteps.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="以下步骤是命令手册工具，编排引擎暂不执行"
          description={
            <span>
              编排运行只会执行表单式模组，命令手册步骤（{commandManualSteps.join('、')}）会被跳过。
              如需运行这些命令，请用右上角「单独执行工具」逐条执行，其结果会自动保存到本项目。
            </span>
          }
        />
      )}
      {!running && moduleStepCount === 0 && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="该模板没有可编排执行的步骤"
          description="你可以在「模板」页编辑添加表单式模组，或直接用右上角「单独执行工具」运行单条命令。"
        />
      )}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'flow',
            label: '执行流程',
            children: (
              <FlowTab
                template={template}
                steps={steps}
                running={running}
                onOpenStep={openStep}
                onRetry={(sid) => void retryStep(sid)}
                activeRunId={activeRunId}
                runs={runs}
                onSelectRun={(rid) => { setActiveRunId(rid); void refreshSteps(rid); }}
              />
            ),
          },
          { key: 'vars', label: '变量', children: <VariablesTab project={project} template={template} onEdit={openVars} /> },
          {
            key: 'term',
            label: '终端',
            children: (
              <div ref={termRef} className="terminal" style={{ height: 'calc(100vh - 220px)' }}>
                {logs.length === 0 ? <span style={{ color: '#64748b' }}>暂无日志输出，点击「开始测试」启动运行。</span>
                  : logs.map((l, i) => (
                    <div key={i} className={`log-${l.kind}`}>[{l.ts}] {l.text}</div>
                  ))}
              </div>
            ),
          },
          {
            key: 'cmdruns',
            label: '工具执行记录',
            children: <CommandRunList key={`cmdruns-${cmdRunsVersion}`} projectId={id} />,
          },
          {
            key: 'log',
            label: '审计日志',
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={audit}
                pagination={{ current: auditPage, pageSize: 20, total: auditTotal, onChange: setAuditPage }}
                columns={[
                  { title: '时间', dataIndex: 'createdAt', width: 180, render: (v: string) => new Date(v).toLocaleString('zh-CN') },
                  { title: '用户', dataIndex: 'userId', width: 120 },
                  { title: '动作', dataIndex: 'action', render: (v: string) => <Tag>{v}</Tag> },
                  { title: '对象', key: 'ent', render: (_, r) => <span className="mono">{r.entityType}:{r.entityId}</span> },
                  { title: 'IP', dataIndex: 'ip', width: 140 },
                ]}
              />
            ),
          },
          {
            key: 'report',
            label: '合规报告',
            children: (
              <ReportTab
                loading={reportLoading}
                report={report}
                detail={reportDetail}
                summary={summary}
                onRegenerate={() => void regenerateReport()}
                onExport={() => void exportExcel()}
              />
            ),
          },
        ]}
      />

      <Modal title="编辑项目变量" open={varsOpen} onCancel={() => setVarsOpen(false)} onOk={() => void saveVars()}
        okText="保存" cancelText="取消" width={640}>
        <Typography.Paragraph type="secondary">
          变量将在执行时通过 Mustache 语法 <code>{'{{var}}'}</code> 替换到步骤参数中。
        </Typography.Paragraph>
        <TextArea rows={12} value={varJson} onChange={(e) => setVarJson(e.target.value)} className="mono" />
      </Modal>

      <Drawer
        title={stepDetail ? `${stepDetail.stepSnapshot.title} (${stepDetail.stepId})` : '步骤详情'}
        width={680}
        open={!!stepDetail || detailLoading}
        onClose={() => setStepDetail(null)}
        extra={stepDetail && (stepDetail.status === 'fail' || stepDetail.status === 'timeout') ? (
          <Button icon={<RedoOutlined />} onClick={() => void retryStep(stepDetail.id)}>重试此步骤</Button>
        ) : null}
      >
        {detailLoading ? <Spin /> : stepDetail && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="状态">
                <Tag color={stepStatusColor[stepDetail.status]}>{stepStatusText[stepDetail.status] ?? stepDetail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="退出码">{stepDetail.exitCode ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="耗时">{stepDetail.durationMs ? `${stepDetail.durationMs} ms` : '-'}</Descriptions.Item>
              <Descriptions.Item label="工具">{stepDetail.stepSnapshot.toolId}</Descriptions.Item>
              {stepDetail.startedAt && <Descriptions.Item label="开始" span={2}>{new Date(stepDetail.startedAt).toLocaleString('zh-CN')}</Descriptions.Item>}
              {stepDetail.error && (
                <Descriptions.Item label="错误" span={2}>
                  <Typography.Text type="danger">{stepDetail.error.message}</Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {stepDetail.verdicts.length > 0 && (
              <>
                <Typography.Text strong>条款判定 ({stepDetail.verdicts.length})</Typography.Text>
                {stepDetail.verdicts.map((v) => (
                  <Card key={v.id} size="small">
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Tag className={v.pass ? 'clause-pass' : 'clause-fail'} color={v.pass ? 'green' : 'red'}>
                          {v.pass ? 'PASS' : 'FAIL'}
                        </Tag>
                        <span className="mono">{v.clauseId}</span>
                        <Tag color={severityColor(v.severity)}>{v.severity}</Tag>
                        {v.overridden && <Tag color="orange">已人工覆盖</Tag>}
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v.reason}</Typography.Text>
                    </Space>
                  </Card>
                ))}
              </>
            )}

            {stepDetail.evidences.length > 0 && (
              <>
                <Typography.Text strong>证据 ({stepDetail.evidences.length})</Typography.Text>
                {stepDetail.evidences.map((ev) => (
                  <Card key={ev.id} size="small" style={{ background: '#f8fafc' }}>
                    <Space style={{ marginBottom: 4 }}>
                      <Tag>{ev.type}</Tag>
                      <Tag color={severityColor(ev.severity)}>{ev.severity}</Tag>
                    </Space>
                    <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{ev.content}</pre>
                  </Card>
                ))}
              </>
            )}

            {stepDetail.stdout && (
              <>
                <Typography.Text strong>stdout</Typography.Text>
                <pre className="terminal" style={{ height: 180, margin: 0 }}>{stepDetail.stdout}</pre>
              </>
            )}
            {stepDetail.stderr && (
              <>
                <Typography.Text strong>stderr</Typography.Text>
                <pre className="terminal" style={{ height: 120, margin: 0 }}>{stepDetail.stderr}</pre>
              </>
            )}
          </Space>
        )}
      </Drawer>

      {singleRun && (
        <RunCommandModal
          open
          tool={singleRun.tool}
          command={singleRun.command}
          defaultProjectId={id}
          onClose={() => setSingleRun(null)}
          onChanged={() => setCmdRunsVersion((v) => v + 1)}
        />
      )}
    </Content>
  );
}

function FlowTab(props: {
  template?: Template;
  steps: StepRun[];
  running: boolean;
  activeRunId?: string;
  runs: ProjectRun[];
  onOpenStep: (s: StepRun) => void;
  onRetry: (stepRunId: string) => void;
  onSelectRun: (runId: string) => void;
}) {
  const { template, steps, running, onOpenStep, onRetry, runs, activeRunId, onSelectRun } = props;
  if (!template) return <Empty description="无法加载模板" />;

  const byStepId = new Map<string, StepRun>();
  for (const s of steps) byStepId.set(s.stepId, s);

  return (
    <Row gutter={16}>
      <Col span={6}>
        <Card size="small" title="历史运行">
          {runs.length === 0 ? <Empty description="暂无运行" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
            <Timeline
              items={runs.map((r) => ({
                color: runStatusColor[r.status] as string,
                children: (
                  <div onClick={() => onSelectRun(r.id)} style={{ cursor: 'pointer',
                    background: r.id === activeRunId ? '#eff6ff' : 'transparent', padding: 4, borderRadius: 4 }}>
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
            return (
              <div key={snap.stepId} className="step-row" onClick={() => sr && onOpenStep(sr)}
                style={{ cursor: sr ? 'pointer' : 'default' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    <Tag color={stepStatusColor[status]}>{stepStatusText[status] ?? status}</Tag>
                    <Typography.Text strong>{snap.title}</Typography.Text>
                    <Tag>{snap.stepId}</Tag>
                    <Tag color="blue">{snap.toolId}</Tag>
                    {snap.onFailure === 'abort' && <Tag color="red">失败中止</Tag>}
                  </Space>
                  <Space>
                    {sr?.verdictCount ? <Tag color="green">{sr.verdictCount} 判定</Tag> : null}
                    {sr?.evidenceCount ? <Tag>{sr.evidenceCount} 证据</Tag> : null}
                    {sr && !running && (status === 'fail' || status === 'timeout') && (
                      <Button size="small" icon={<RedoOutlined />} onClick={(e) => { e.stopPropagation(); onRetry(sr.id); }}>
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
  );
}

function VariablesTab(props: { project: Project; template?: Template; onEdit: () => void }) {
  const { project, template, onEdit } = props;
  const vars = template?.variables ?? [];
  return (
    <Card
      title="项目变量"
      extra={<Button type="primary" onClick={onEdit}>编辑 JSON</Button>}
    >
      {vars.length === 0 ? (
        <Empty description="模板未声明变量；可直接编辑自由变量 JSON" />
      ) : (
        <Table
          rowKey="name"
          pagination={false}
          dataSource={vars}
          columns={[
            { title: '变量名', dataIndex: 'name', render: (v: string) => <code className="mono">{`{{${v}}}`}</code> },
            { title: '标签', dataIndex: 'label' },
            { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>{v}</Tag> },
            { title: '必填', dataIndex: 'required', render: (v: boolean) => (v ? <Tag color="red">是</Tag> : '否') },
            { title: '默认值', dataIndex: 'default', render: (v: unknown) => (v === undefined ? '-' : String(v)) },
            {
              title: '当前值',
              key: 'cur',
              render: (_, r) => {
                const cur = (project.variables as Record<string, unknown>)[r.name];
                return cur === undefined ? <Typography.Text type="secondary">未设置</Typography.Text> : String(cur);
              },
            },
          ]}
        />
      )}
      <Typography.Title level={5} style={{ marginTop: 16 }}>原始变量 JSON</Typography.Title>
      <pre className="terminal" style={{ height: 200 }}>{JSON.stringify(project.variables, null, 2)}</pre>
    </Card>
  );
}

function ReportTab(props: {
  loading: boolean;
  report: Report | null;
  detail: ReportDetail | null;
  summary?: Report['summary'];
  onRegenerate: () => void;
  onExport: () => void;
}) {
  const { loading, report, detail, summary, onRegenerate, onExport } = props;
  if (loading) return <Spin tip="加载报告…" />;
  if (!report || !summary) {
    return (
      <Empty description="尚未生成合规报告">
        <Button type="primary" onClick={onRegenerate}>生成报告</Button>
      </Empty>
    );
  }
  const clauses = detail?.clauses ?? [];
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

      <Card size="small" title={`条款判定明细 (${clauses.length})`}>
        <Table
          rowKey="clauseId"
          size="small"
          dataSource={clauses}
          pagination={{ pageSize: 50 }}
          columns={[
            { title: '条款', dataIndex: 'clauseId', width: 120, render: (v: string) => <code className="mono">{v}</code> },
            { title: '章节', dataIndex: 'chapter', width: 100 },
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
            { title: '严重度', key: 'sev', width: 90, render: (_, r) => (r.verdict ? <Tag color={severityColor(r.verdict.severity)}>{r.verdict.severity}</Tag> : '-') },
            { title: '依据', key: 'reason', render: (_, r) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.verdict?.reason ?? '—'}</Typography.Text> },
          ]}
        />
      </Card>
    </Space>
  );
}
