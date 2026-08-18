import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layout, Button, Tag, Space, Typography, Spin, Empty, Tabs, Modal, Form,
  Input, message, Cascader, Tooltip, Alert, Skeleton,
} from 'antd';
import {
  ArrowLeftOutlined, PlayCircleOutlined, StopOutlined, ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  Project, ProjectRun, StepRun, Template, Tool, ToolCommand,
} from '@en18031/shared';
import {
  ProjectsApi, TemplatesApi, ReportsApi, ToolsApi,
} from '../api/endpoints';
import { reportError } from '../api/client';
import { useRunStream } from '../hooks/useRunStream';
import {
  runStatusColor, runStatusText, projectStatusColor, projectStatusText,
  isTerminalStatus,
} from '../utils/ui';
import RunCommandModal from '../components/RunCommandModal';
import FlowTab from '../components/project/FlowTab';
import VariablesTab from '../components/project/VariablesTab';
import TerminalTab, { type LogLine } from '../components/project/TerminalTab';
import CommandRunsTab from '../components/project/CommandRunsTab';
import AuditTab from '../components/project/AuditTab';
import ReportTab from '../components/project/ReportTab';
import StepDetailDrawer from '../components/project/StepDetailDrawer';
import PreflightModal from '../components/PreflightModal';
import type { StepRunDetail, ReportDetail } from '../api/endpoints';

const { Content } = Layout;
const { TextArea } = Input;

export default function ProjectDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project & { latestRun?: ProjectRun }>();
  const [template, setTemplate] = useState<Template>();
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string>();
  const [steps, setSteps] = useState<StepRun[]>([]);
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [tab, setTab] = useState('flow');
  const [busy, setBusy] = useState(false);
  const [headerLoading, setHeaderLoading] = useState(true);
  const [stepDetail, setStepDetail] = useState<StepRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [report, setReport] = useState<import('@en18031/shared').Report | null>(null);
  const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [singleRun, setSingleRun] = useState<{ tool: Tool; command: ToolCommand } | null>(null);
  const [cmdRunsVersion, setCmdRunsVersion] = useState(0);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const loadSeq = useRef(0);

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) ?? project?.latestRun,
    [runs, activeRunId, project],
  );
  const running = !!activeRun && !isTerminalStatus(activeRun.status);

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
    setHeaderLoading(true);
    setActiveRunId(undefined);
    setSteps([]);
    setLogs([]);
    setProgress(0);
    setEta(null);
    setReport(null);
    setReportDetail(null);
    loadProject().then(loadReport).catch(reportError).finally(() => {
      setBusy(false);
      setHeaderLoading(false);
    });
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
    onLogLine: (p) => appendLog(p.line, p.stream === 'stderr' ? 'err' : 'in'),
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
      // 后端可能在 batchProgress 中携带 eta
      const etaField = (p as unknown as { eta?: string }).eta;
      if (etaField !== undefined) setEta(etaField);
      if (p.status) {
        setRuns((prev) => prev.map((r) => (r.id === p.runId
          ? { ...r, status: p.status as ProjectRun['status'], progressPercent: p.percent ?? r.progressPercent, eta: etaField ?? r.eta }
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
      ProjectsApi.getRun(id, activeRunId).then((r) => {
        if (isTerminalStatus(r.status)) {
          setRuns((prev) => prev.map((x) => (x.id === r.id ? r : x)));
        }
      }).catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [activeRunId, running, refreshSteps, id]);

  useEffect(() => {
    if (activeRun && isTerminalStatus(activeRun.status)) {
      setProgress(activeRun.progressPercent ?? 100);
      if (activeRunId) void refreshSteps(activeRunId);
      setRuns((prev) => prev.map((r) => (r.id === activeRun.id ? activeRun : r)));
      void loadReport();
      setAuditRefreshKey((k) => k + 1);
    } else if (activeRun) {
      setProgress(activeRun.progressPercent ?? 0);
      setEta(activeRun.eta ?? null);
    }
  }, [activeRun, activeRunId, refreshSteps, loadReport]);

  const startRun = async () => {
    setLogs([]);
    setSteps([]);
    setProgress(0);
    setEta(null);
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

  const refreshProjectData = useCallback(async () => {
    try {
      await loadProject();
      setCmdRunsVersion((v) => v + 1);
      setAuditRefreshKey((k) => k + 1);
    } catch (e) { reportError(e); }
  }, [loadProject]);

  if (headerLoading && !project) {
    return (
      <Content style={{ padding: 24 }}>
        <Skeleton active avatar paragraph={{ rows: 4 }} />
      </Content>
    );
  }
  if (!project) {
    return <Content style={{ padding: 24 }}><Empty description="项目不存在" /></Content>;
  }

  const summary = report?.summary;

  return (
    <Content style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Space wrap style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between', rowGap: 8 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} aria-label="返回项目列表" onClick={() => navigate('/projects')}>返回</Button>
          <Typography.Title level={4} ellipsis style={{ margin: 0, maxWidth: 280 }}>{project.name}</Typography.Title>
          <Tag color={activeRun ? runStatusColor[activeRun.status] : projectStatusColor[project.status]}>
            {activeRun
              ? (runStatusText[activeRun.status] ?? activeRun.status)
              : (projectStatusText[project.status] ?? project.status)}
          </Tag>
          <Tag color="blue">{project.targetComplianceLevel}</Tag>
          <Tag>{template?.name ?? project.templateId}</Tag>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} aria-label="刷新项目" onClick={() => void loadProject()}>刷新</Button>
          <Button onClick={() => setTab('vars')}>变量配置</Button>
          <Cascader
            placeholder="单独执行工具…"
            style={{ width: 200 }}
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
              <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} disabled={!canStartOrchestration} onClick={() => setPreflightOpen(true)}>
                开始测试
              </Button>
            </Tooltip>
          )}
        </Space>
      </Space>

      {running && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#475569' }}>执行进度 {progress}%</span>
            {eta && <span style={{ fontSize: 13, color: '#2563eb' }}>预计还需 {eta}</span>}
          </div>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginTop: 4 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#2563eb,#60a5fa)', transition: 'width .3s' }} />
          </div>
        </div>
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
                tools={tools}
                running={running}
                onOpenStep={openStep}
                onRetry={(sid) => void retryStep(sid)}
                activeRunId={activeRunId}
                runs={runs}
                overallProgress={progress}
                eta={eta}
                onSelectRun={(rid) => {
                  if (rid !== activeRunId) {
                    setLogs([]);
                    setProgress(0);
                    setEta(null);
                  }
                  setActiveRunId(rid);
                  void refreshSteps(rid);
                }}
              />
            ),
          },
          { key: 'vars', label: '变量', children: <VariablesTab project={project} template={template} onSaved={(p) => setProject(p)} /> },
          { key: 'term', label: '终端', children: <TerminalTab logs={logs} /> },
          {
            key: 'cmdruns',
            label: '工具执行记录',
            children: <CommandRunsTab projectId={id} version={cmdRunsVersion} />,
          },
          {
            key: 'log',
            label: '审计日志',
            children: <AuditTab projectId={id} refreshKey={auditRefreshKey} />,
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
                projectId={id}
                standardName={project?.standardVersion}
                hasRuns={runs.length > 0}
                onRegenerate={() => void regenerateReport()}
                onExport={() => void exportExcel()}
              />
            ),
          },
        ]}
      />

      <StepDetailDrawer
        detail={stepDetail}
        loading={detailLoading}
        onClose={() => setStepDetail(null)}
        onRetry={(sid) => void retryStep(sid)}
        onVerdictOverride={() => activeRunId && void refreshSteps(activeRunId)}
      />

      {singleRun && (
        <RunCommandModal
          open
          tool={singleRun.tool}
          command={singleRun.command}
          defaultProjectId={id}
          onClose={() => { setSingleRun(null); void refreshProjectData(); }}
          onChanged={() => setCmdRunsVersion((v) => v + 1)}
        />
      )}

      <PreflightModal
        open={preflightOpen}
        projectId={id}
        onClose={() => setPreflightOpen(false)}
        onConfirm={() => { setPreflightOpen(false); void startRun(); }}
      />
    </Content>
  );
}
