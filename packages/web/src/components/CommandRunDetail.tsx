import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Space, Typography, Tag, Button, Spin, Alert, Divider, Select, Tooltip, message, Popconfirm,
} from 'antd';
import {
  ReloadOutlined, CopyOutlined, SaveOutlined, CheckCircleTwoTone, CloseCircleTwoTone,
} from '@ant-design/icons';
import type { Clause } from '@en18031/shared';
import { CommandRunsApi, ProjectsApi, ClausesApi, type CommandRunDetail as RunDetail } from '../api/endpoints';
import { reportError } from '../api/client';
import { useRunStream } from '../api/socket';
import Terminal, { useLogBuffer, type TerminalLine } from './Terminal';
import { commandRunStatusColor, commandRunStatusText, formatDuration } from '../utils/ui';

const TERMINAL = new Set(['success', 'fail', 'timeout', 'crash', 'cancelled']);

function toLines(text: string, stream: 'stdout' | 'stderr'): TerminalLine[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0).map((text) => ({ text, stream }));
}

export default function CommandRunDetail({
  runId, onRerun, onChanged,
}: {
  runId: string;
  onRerun?: (newRunId: string) => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [attachProject, setAttachProject] = useState<string>();
  const [attachClause, setAttachClause] = useState<string>();
  const reconciled = useRef(false);
  const buffer = useLogBuffer(3000);

  const running = !!detail && !TERMINAL.has(detail.status);

  async function poll() {
    try {
      const d = await CommandRunsApi.get(runId);
      setDetail(d);
      if (TERMINAL.has(d.status) && !reconciled.current) {
        reconciled.current = true;
        buffer.setLines([...toLines(d.stdout, 'stdout'), ...toLines(d.stderr, 'stderr')]);
      }
    } catch {
      // ignore transient errors
    }
  }

  useEffect(() => {
    setDetail(null);
    reconciled.current = false;
    buffer.reset();
    void poll();
    void ProjectsApi.list().then((ps) => setProjects(ps.map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    void ClausesApi.list().then(setClauses).catch(() => {});
  }, [runId]);

  useRunStream(running ? runId : undefined, {
    onLogLine: (p) => buffer.append(p.line, undefined, p.stream),
    onStatus: () => { void poll(); },
  });

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [running, runId]);

  const stdoutLines = useMemo<TerminalLine[]>(() => {
    if (!detail || !TERMINAL.has(detail.status)) return buffer.lines.filter((l) => l.stream !== 'stderr');
    return toLines(detail.stdout, 'stdout');
  }, [detail, buffer.lines]);

  const stderrLines = useMemo<TerminalLine[]>(() => {
    if (!detail || !TERMINAL.has(detail.status)) return buffer.lines.filter((l) => l.stream === 'stderr');
    return toLines(detail.stderr, 'stderr');
  }, [detail, buffer.lines]);

  async function rerun() {
    if (!detail) return;
    try {
      const { runId: rid } = await CommandRunsApi.start(detail.toolId, detail.commandId, {
        params: detail.params,
        projectId: detail.projectId ?? undefined,
        clauseId: detail.clauseId ?? undefined,
      });
      message.success('已重新执行');
      onRerun?.(rid);
    } catch (e) {
      reportError(e);
    }
  }

  async function attach() {
    if (!detail || !attachProject) {
      message.warning('请先选择项目');
      return;
    }
    try {
      await CommandRunsApi.attach(detail.id, {
        projectId: attachProject,
        clauseId: attachClause,
        note: '工具手册执行记录',
      });
      message.success('已保存到项目');
      setAttachProject(undefined);
      setAttachClause(undefined);
      onChanged?.();
      void poll();
    } catch (e) {
      reportError(e);
    }
  }

  if (!detail) return <Spin tip="加载执行记录…" />;

  const exitOk = detail.status === 'success';

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Tag color={commandRunStatusColor[detail.status]} style={{ fontSize: 13, padding: '2px 10px' }}>
          {commandRunStatusText[detail.status] ?? detail.status}
        </Tag>
        {detail.exitCode !== undefined && (
          <Tag color={exitOk ? 'green' : 'red'}>退出码 {detail.exitCode}</Tag>
        )}
        {detail.durationMs !== undefined && <Tag>耗时 {formatDuration(detail.durationMs)}</Tag>}
        {detail.startedAt && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(detail.startedAt).toLocaleString('zh-CN')}
          </Typography.Text>
        )}
      </Space>

      <div>
        <Typography.Text type="secondary">执行命令：</Typography.Text>
        <Typography.Text
          copyable={{ text: detail.resolvedCommand, icon: <CopyOutlined /> }}
          className="mono"
          style={{ fontSize: 12 }}
        >
          {detail.resolvedCommand}
        </Typography.Text>
      </div>

      {detail.toolName && (
        <Space size="large">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>工具: {detail.toolName}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>命令: {detail.commandName}</Typography.Text>
          {detail.projectId && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              项目: {projects.find((p) => p.id === detail.projectId)?.name ?? detail.projectId.slice(0, 8)}
            </Typography.Text>
          )}
        </Space>
      )}

      {running && (
        <Alert type="info" showIcon message="命令运行中，输出实时显示…" />
      )}
      {!running && exitOk && (
        <Alert type="success" showIcon icon={<CheckCircleTwoTone twoToneColor="#52c41a" />} message="执行成功" />
      )}
      {!running && !exitOk && (
        <Alert
          type="error" showIcon icon={<CloseCircleTwoTone twoToneColor="#ff4d4f" />}
          message={`执行未通过：${commandRunStatusText[detail.status] ?? detail.status}`}
          description={detail.error?.message}
        />
      )}

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>stdout</Typography.Text>
        <Terminal lines={stdoutLines} height={240} empty="无标准输出" />
      </div>

      {stderrLines.length > 0 && (
        <div>
          <Typography.Text strong style={{ fontSize: 13, color: '#dc2626' }}>stderr</Typography.Text>
          <Terminal lines={stderrLines} height={140} empty="无标准错误" />
        </div>
      )}

      {!running && (
        <>
          <Space>
            <Popconfirm title="使用相同参数重新执行？" onConfirm={() => void rerun()} okText="重新执行" cancelText="取消">
              <Button icon={<ReloadOutlined />}>重新执行</Button>
            </Popconfirm>
            <Button icon={<CopyOutlined />} onClick={() => {
              void navigator.clipboard?.writeText(detail.resolvedCommand);
              message.success('命令已复制');
            }}>复制命令</Button>
          </Space>

          {!detail.projectId && (
            <>
              <Divider style={{ margin: '8px 0' }}>保存为项目证据</Divider>
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
                  <Button type="primary" ghost icon={<SaveOutlined />} onClick={() => void attach()}>保存到项目</Button>
                </Tooltip>
              </Space>
            </>
          )}
        </>
      )}
    </Space>
  );
}
