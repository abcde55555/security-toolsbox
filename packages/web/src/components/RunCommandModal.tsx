import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Button, Space, Typography, Tag, Alert, Progress, Select, message, Divider, Tooltip,
} from 'antd';
import {
  PlayCircleOutlined, CopyOutlined, StopOutlined, CheckCircleTwoTone,
  CloseCircleTwoTone, SaveOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { Tool, ToolCommand } from '@en18031/shared';
import { renderCommandTemplate, validateFormValues } from '@en18031/shared';
import DynamicForm from './DynamicForm';
import Terminal, { useLogBuffer } from './Terminal';
import { CommandRunsApi, ProjectsApi, ClausesApi, type CommandRunDetail } from '../api/endpoints';
import { reportError } from '../api/client';
import { useRunStream } from '../api/socket';
import { commandRunStatusColor, commandRunStatusText, formatDuration } from '../utils/ui';

const TERMINAL = new Set(['success', 'fail', 'timeout', 'crash', 'cancelled']);

function defaultsFromCommand(cmd: ToolCommand): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of cmd.params) {
    if (f.value !== undefined) out[f.id] = f.value;
    else if (f.type === 'checkbox') out[f.id] = false;
    else if (f.type === 'multiselect') out[f.id] = [];
    else out[f.id] = '';
  }
  return out;
}

function toLines(text: string, stream: 'stdout' | 'stderr') {
  return text.split(/\r?\n/).filter((l) => l.length > 0).map((text) => ({ text, stream }));
}

export default function RunCommandModal({
  open, tool, command, onClose, onChanged, defaultProjectId,
}: {
  open: boolean;
  tool: Tool;
  command: ToolCommand | null;
  onClose: () => void;
  onChanged?: () => void;
  defaultProjectId?: string;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runId, setRunId] = useState<string>();
  const [detail, setDetail] = useState<CommandRunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachProject, setAttachProject] = useState<string>();
  const [attachClause, setAttachClause] = useState<string>();
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [clauses, setClauses] = useState<Array<{ clauseId: string; title: string }>>([]);
  const reconciled = useRef(false);
  const buffer = useLogBuffer(3000);

  useEffect(() => {
    if (command) {
      setValues(defaultsFromCommand(command));
      setErrors({});
      setRunId(undefined);
      setDetail(null);
      reconciled.current = false;
      buffer.reset();
    }
  }, [command?.id, open]);

  useEffect(() => {
    if (!open) return;
    void ProjectsApi.list().then((ps) => setProjects(ps.map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    void ClausesApi.list().then((cs) => setClauses(cs.map((c) => ({ clauseId: c.clauseId, title: c.title })))).catch(() => {});
  }, [open]);

  const preview = useMemo(() => {
    if (!command) return { command: '', missing: [] as string[], unused: [] as string[] };
    return renderCommandTemplate(command.commandTemplate, values, { rawKeys: command.rawParams });
  }, [command, values]);

  const running = !!runId && (!detail || !TERMINAL.has(detail.status));
  const finished = !!detail && TERMINAL.has(detail.status);

  useRunStream(runId, {
    onLogLine: (p) => buffer.append(p.line, undefined, p.stream),
    onStatus: (p) => {
      if (TERMINAL.has(p.status)) void pollOnce();
    },
  });

  useEffect(() => {
    if (!runId || finished) return;
    const t = setInterval(() => void pollOnce(), 1500);
    return () => clearInterval(t);
  }, [runId, finished]);

  useEffect(() => {
    if (finished && defaultProjectId) onChanged?.();
  }, [finished, defaultProjectId]);

  async function pollOnce() {
    if (!runId) return;
    try {
      const d = await CommandRunsApi.get(runId);
      setDetail(d);
      if (TERMINAL.has(d.status) && !reconciled.current) {
        reconciled.current = true;
        buffer.setLines([...toLines(d.stdout, 'stdout'), ...toLines(d.stderr, 'stderr')]);
      }
    } catch {
      // ignore transient poll errors
    }
  }

  function setField(id: string, v: unknown) {
    setValues((prev) => ({ ...prev, [id]: v }));
  }

  async function start() {
    if (!command) return;
    const errs = validateFormValues(command.params, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const requiredIds = new Set(command.params.filter((f) => f.required).map((f) => f.id));
    const missingRequired = preview.missing.filter((k) => requiredIds.has(k));
    if (missingRequired.length > 0) {
      message.error(`缺少必填参数: ${missingRequired.join(', ')}`);
      return;
    }
    setBusy(true);
    try {
      const { runId: rid } = await CommandRunsApi.start(tool.id, command.id, {
        params: values,
        projectId: defaultProjectId,
      });
      setRunId(rid);
      buffer.reset();
      reconciled.current = false;
      void pollOnce();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!runId) return;
    try {
      await CommandRunsApi.cancel(runId);
      await pollOnce();
    } catch (e) {
      reportError(e);
    }
  }

  async function attach() {
    if (!runId || !attachProject) {
      message.warning('请先选择要挂载的项目');
      return;
    }
    if (attaching) return;
    setAttaching(true);
    try {
      await CommandRunsApi.attach(runId, {
        projectId: attachProject,
        clauseId: attachClause,
        note: '工具手册执行记录',
      });
      await pollOnce();
      message.success('已保存到项目');
      onChanged?.();
      setAttachProject(undefined);
      setAttachClause(undefined);
    } catch (e) {
      reportError(e);
    } finally {
      setAttaching(false);
    }
  }

  function copyCommand() {
    void navigator.clipboard?.writeText(preview.command);
    message.success('命令已复制到剪贴板');
  }

  const status = detail?.status;
  const exitOk = status === 'success';

  return (
    <Modal
      title={command ? `${tool.name} / ${command.name}` : ''}
      width={780}
      open={open}
      onCancel={onClose}
      destroyOnClose
      footer={
        running ? (
          <Button danger icon={<StopOutlined />} onClick={() => void cancel()}>终止运行</Button>
        ) : (
          <Space>
            <Button onClick={onClose}>关闭</Button>
            {finished && (
              <Button icon={<ReloadOutlined />} onClick={() => { setRunId(undefined); setDetail(null); buffer.reset(); }}>
                重新执行
              </Button>
            )}
            {!runId && (
              <>
                <Button icon={<CopyOutlined />} onClick={copyCommand}>复制命令</Button>
                <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} onClick={() => void start()}>
                  开始执行
                </Button>
              </>
            )}
          </Space>
        )
      }
    >
      {command && (
        <>
          {!runId && (
            <>
              {command.description && (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                  {command.description}
                </Typography.Paragraph>
              )}
              <DynamicForm
                fields={command.params}
                values={values}
                onChange={setField}
                errors={errors}
              />
              <div style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary">渲染后命令：</Typography.Text>
                <div className="mono" style={{
                  marginTop: 4, padding: '8px 10px', background: '#0b1020', color: '#d6e2f5',
                  borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {preview.command || <span style={{ color: '#64748b' }}>（填写参数后生成）</span>}
                </div>
                {preview.missing.length > 0 && (() => {
                  const requiredIds = new Set(command.params.filter((f) => f.required).map((f) => f.id));
                  const req = preview.missing.filter((k) => requiredIds.has(k));
                  const opt = preview.missing.filter((k) => !requiredIds.has(k));
                  return (
                    <>
                      {req.length > 0 && <Tag color="red" style={{ marginTop: 6 }}>未填必填参数: {req.join(', ')}</Tag>}
                      {opt.length > 0 && <Tag color="orange" style={{ marginTop: 6 }}>未填可选参数（将留空）: {opt.join(', ')}</Tag>}
                    </>
                  );
                })()}
                {preview.unused.length > 0 && (
                  <Tag color="orange" style={{ marginTop: 6 }}>未使用参数: {preview.unused.join(', ')}</Tag>
                )}
              </div>
              {command.outputTips && (
                <Alert type="info" showIcon message="如何判读输出" description={command.outputTips} style={{ marginTop: 8 }} />
              )}
            </>
          )}

          {runId && (
            <>
              <Space style={{ marginBottom: 8 }} wrap>
                {status ? (
                  <Tag color={commandRunStatusColor[status]} style={{ fontSize: 13, padding: '2px 10px' }}>
                    {commandRunStatusText[status] ?? status}
                  </Tag>
                ) : <Tag color="processing">运行中</Tag>}
                {detail?.exitCode !== undefined && (
                  <Tag color={exitOk ? 'green' : 'red'}>退出码 {detail.exitCode}</Tag>
                )}
                {detail?.durationMs !== undefined && (
                  <Tag>耗时 {formatDuration(detail.durationMs)}</Tag>
                )}
                <Typography.Text copyable={{ text: detail?.resolvedCommand }} className="mono" style={{ fontSize: 12 }}>
                  {detail?.resolvedCommand}
                </Typography.Text>
              </Space>

              {running && <Progress percent={100} status="active" showInfo={false} style={{ marginBottom: 10 }} />}

              {finished && exitOk && (
                <Alert type="success" showIcon icon={<CheckCircleTwoTone twoToneColor="#52c41a" />}
                  message="执行成功" style={{ marginBottom: 10 }} />
              )}
              {finished && !exitOk && (
                <Alert type="error" showIcon icon={<CloseCircleTwoTone twoToneColor="#ff4d4f" />}
                  message={`执行未通过：${commandRunStatusText[status ?? 'fail'] ?? status}`}
                  description={detail?.error?.message} style={{ marginBottom: 10 }} />
              )}

              <Terminal lines={buffer.lines} height={300} empty="命令运行中，输出将实时显示…" />

              {finished && detail?.projectId ? (
                <Alert
                  style={{ marginTop: 12 }}
                  type="success" showIcon
                  message="本次运行已保存到项目，可在项目页「工具执行记录」中查看。"
                />
              ) : finished ? (
                <>
                  <Divider style={{ margin: '14px 0 10px' }}>保存为项目证据</Divider>
                  <Space wrap>
                    <Select
                      showSearch
                      placeholder="选择项目"
                      style={{ width: 260 }}
                      value={attachProject}
                      onChange={setAttachProject}
                      optionFilterProp="label"
                      options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    />
                    <Select
                      showSearch
                      allowClear
                      placeholder="关联条款（可选）"
                      style={{ width: 280 }}
                      value={attachClause}
                      onChange={setAttachClause}
                      optionFilterProp="label"
                      options={clauses.map((c) => ({ value: c.clauseId, label: `${c.clauseId} ${c.title}` }))}
                    />
                    <Tooltip title="将本次运行挂到所选项目下，作为执行证据留存">
                      <Button type="primary" ghost icon={<SaveOutlined />} loading={attaching} onClick={() => void attach()}>保存到项目</Button>
                    </Tooltip>
                  </Space>
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
