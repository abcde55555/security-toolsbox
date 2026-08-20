import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, Switch, Button, Space, Typography, Tag,
  Tooltip, Alert, Divider, Row, Col, message,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, WarningFilled, SafetyCertificateOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import type { ToolCommand, FormField, Clause } from '@en18031/shared';
import { extractPlaceholders, renderCommandTemplate, uuid } from '@en18031/shared';
import { ToolsApi } from '../api/endpoints';
import { reportError } from '../api/client';

const { TextArea } = Input;

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'textarea', label: '多行文本' },
  { value: 'select', label: '下拉单选' },
  { value: 'multiselect', label: '下拉多选' },
  { value: 'checkbox', label: '开关' },
  { value: 'file', label: '文件' },
  { value: 'stepper', label: '步进数字' },
];

const FORMAT_OPTIONS = [
  { value: 'plain', label: '无校验' },
  { value: 'ip', label: 'IPv4' },
  { value: 'cidr', label: 'CIDR' },
  { value: 'port-range', label: '端口范围' },
  { value: 'hostname', label: '主机名' },
  { value: 'path', label: '路径' },
];

const PLATFORM_OPTIONS = [
  { value: 'linux', label: 'Linux' },
  { value: 'darwin', label: 'macOS' },
  { value: 'win32', label: 'Windows' },
];

function emptyParam(id: string): FormField {
  return { id, label: id, type: 'text', required: false };
}

function newCommand(): ToolCommand {
  return {
    id: uuid(),
    name: '',
    commandTemplate: '',
    params: [],
    rawParams: [],
    platforms: ['linux', 'darwin'],
  };
}

function paramDefaultValue(f: FormField): unknown {
  if (f.value !== undefined) return f.value;
  if (f.type === 'checkbox') return false;
  if (f.type === 'multiselect') return [];
  return '';
}

function coerceDefault(f: FormField, raw: string): unknown {
  if (f.type === 'checkbox') return raw === 'true';
  if (f.type === 'number' || f.type === 'stepper') {
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

// 为参数行生成稳定的唯一 key
function genRowId(): string {
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ParamRow {
  rowId: string;
  field: FormField;
}

function emptyParamRow(id: string): ParamRow {
  return { rowId: genRowId(), field: { id, label: id, type: 'text', required: false } };
}

function commandToRows(cmd: ToolCommand): ParamRow[] {
  return cmd.params.map((field) => ({ rowId: genRowId(), field: { ...field } }));
}

export default function CommandEditor({
  open, command, clauses, toolId, onSave, onCancel,
}: {
  open: boolean;
  command: ToolCommand | null;
  clauses: Clause[];
  toolId?: string;
  onSave: (cmd: ToolCommand) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ToolCommand>(newCommand());
  const [rows, setRows] = useState<ParamRow[]>([]);
  // 记录用户显式删除/关闭的参数 id，即使占位符仍存在也不自动重新添加
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof ToolsApi.testCommand>> | null>(null);
  // Live terminal output lines accumulated during a streamed test run.
  const [liveLines, setLiveLines] = useState<Array<{ stream: 'cmd' | 'stdout' | 'stderr'; text: string }>>([]);
  const abortRef = useRef<AbortController | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the live terminal to the bottom as lines arrive.
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLines]);
  // Sample values for {{placeholders}} when running a test, keyed by param id.
  const [testValues, setTestValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      const d = command ? structuredClone(command) : newCommand();
      setDraft(d);
      setRows(commandToRows(d));
      setDismissed(new Set());
      setTestResult(null);
      setTestValues({});
      setLiveLines([]);
    }
  }, [open, command]);

  // Abort any in-flight streamed test when the editor closes.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const runTest = async () => {
    if (!draft.commandTemplate.trim()) {
      message.warning('请先填写命令模板');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setLiveLines([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await ToolsApi.testCommandStream(
        {
          commandTemplate: draft.commandTemplate,
          params: testValues,
          timeoutMs: draft.timeoutMs,
          toolId,
        },
        (ev) => {
          if (ev.type === 'start') {
            setLiveLines((l) => [...l, { stream: 'cmd', text: ev.command }]);
          } else if (ev.type === 'stdout' || ev.type === 'stderr') {
            setLiveLines((l) => [...l, { stream: ev.type, text: ev.line }]);
          } else if (ev.type === 'done') {
            setTestResult({
              command: draft.commandTemplate,
              exitCode: ev.exitCode,
              status: ev.status,
              stdout: '',
              stderr: '',
              durationMs: ev.durationMs,
              matchedRules: ev.matchedRules.map((r) => ({ ...r, matcherType: '' })),
            });
          } else if (ev.type === 'error') {
            setLiveLines((l) => [...l, { stream: 'stderr', text: `错误: ${ev.message}` }]);
          }
        },
        ac.signal,
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') reportError(e);
    } finally {
      setTesting(false);
      abortRef.current = null;
    }
  };

  const cancelTest = () => abortRef.current?.abort();

  const placeholders = useMemo(
    () => extractPlaceholders(draft.commandTemplate),
    [draft.commandTemplate],
  );

  // 仅为新的、尚未被用户关闭的占位符自动创建参数行
  useEffect(() => {
    setRows((prev) => {
      const ids = new Set(prev.map((r) => r.field.id));
      const missing = placeholders.filter((ph) => !ids.has(ph) && !dismissed.has(ph));
      if (missing.length === 0) return prev;
      return [...prev, ...missing.map(emptyParamRow)];
    });
  }, [placeholders, dismissed]);

  // 同步 rows -> draft.params，以便保存和预览使用
  useEffect(() => {
    setDraft((prev) => ({ ...prev, params: rows.map((r) => r.field) }));
  }, [rows]);

  const params = rows.map((r) => r.field);
  const paramIds = params.map((p) => p.id);
  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const id of paramIds) { if (seen.has(id)) dups.add(id); seen.add(id); }
    return dups;
  }, [paramIds.join('|')]);

  const unusedParams = useMemo(
    () => params.filter((p) => !placeholders.includes(p.id)).map((p) => p.id),
    [params, placeholders],
  );

  // 被用户删除但占位符仍存在的参数
  const danglingPlaceholders = useMemo(
    () => placeholders.filter((ph) => dismissed.has(ph) || !params.some((p) => p.id === ph)),
    [placeholders, dismissed, params],
  );

  const defaults = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of params) out[f.id] = paramDefaultValue(f);
    return out;
  }, [params]);

  const preview = useMemo(
    () => renderCommandTemplate(draft.commandTemplate, defaults, { rawKeys: draft.rawParams }),
    [draft.commandTemplate, defaults, draft.rawParams],
  );

  const blockers = useMemo(() => {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push('命令名称不能为空');
    if (!draft.commandTemplate.trim()) errs.push('命令模板不能为空');
    for (const p of draft.params) {
      if (!p.id.trim()) errs.push('存在未填写参数 key 的行');
      if (duplicateIds.has(p.id)) errs.push(`参数 key 重复: ${p.id}`);
    }
    for (const ph of placeholders) {
      if (!draft.params.some((p) => p.id === ph)) errs.push(`占位符 {{${ph}}} 缺少参数定义`);
    }
    const raw = draft.rawParams ?? [];
    for (const r of raw) if (!draft.params.some((p) => p.id === r)) errs.push(`rawParams 含未定义参数: ${r}`);
    return errs;
  }, [draft, duplicateIds, placeholders]);

  function update(patch: Partial<ToolCommand>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function updateParam(index: number, patch: Partial<FormField>) {
    setDraft((prev) => {
      const params = prev.params.slice();
      params[index] = { ...params[index], ...patch };
      return { ...prev, params };
    });
  }

  function addParam() {
    const id = `arg${draft.params.length + 1}`;
    setDraft((prev) => ({ ...prev, params: [...prev.params, emptyParam(id)] }));
  }

  function removeParam(index: number) {
    setDraft((prev) => ({ ...prev, params: prev.params.filter((_, i) => i !== index) }));
  }

  function save() {
    if (blockers.length > 0) {
      message.error(blockers[0]);
      return;
    }
    onSave(draft);
  }

  const clauseOptions = clauses.map((c) => ({ value: c.clauseId, label: `${c.clauseId} ${c.title}` }));

  return (
    <Modal
      title={command ? `编辑命令：${command.name || '未命名'}` : '新增命令'}
      open={open}
      onCancel={onCancel}
      onOk={save}
      okText="保存命令"
      cancelText="取消"
      width={820}
      destroyOnClose
      maskClosable={false}
      styles={{ body: { maxHeight: '70vh', overflow: 'auto', paddingRight: 8 } }}
    >
      <Form layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={14}>
            <Form.Item label="命令名称" required>
              <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="如 Ping 连通性" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="超时(秒)">
              <InputNumber
                style={{ width: '100%' }} min={1} max={3600}
                value={draft.timeoutMs ? Math.round(draft.timeoutMs / 1000) : undefined}
                onChange={(v) => update({ timeoutMs: v ? Number(v) * 1000 : undefined })}
              />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item label="需 root">
              <Switch checked={!!draft.requiresRoot} onChange={(v) => update({ requiresRoot: v })} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="命令模板（使用 {{占位符}} 引用参数）" required>
          <TextArea
            className="mono"
            autoSize={{ minRows: 2, maxRows: 6 }}
            value={draft.commandTemplate}
            onChange={(e) => update({ commandTemplate: e.target.value })}
            placeholder="ping -c {{count}} {{target}}"
          />
        </Form.Item>

        <Form.Item label="命令说明 / 用途">
          <TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            value={draft.description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
          />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="适用平台">
              <Select
                mode="multiple"
                value={draft.platforms ?? []}
                onChange={(v) => update({ platforms: v })}
                options={PLATFORM_OPTIONS}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="关联条款">
              <Select
                mode="multiple"
                value={draft.relatedClauses ?? []}
                onChange={(v) => update({ relatedClauses: v })}
                options={clauseOptions}
                optionFilterProp="label"
                placeholder="选择关联的 EN18031 条款"
                allowClear
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" style={{ margin: '8px 0' }}>参数定义</Divider>

        {draft.params.length === 0 && (
          <Typography.Text type="secondary">
            在命令模板中写入 {'{{占位符}}'} 后会自动生成参数行；也可手动新增（用于固定开关等）。
          </Typography.Text>
        )}

        {draft.params.map((p, i) => {
          const isUnused = unusedParams.includes(p.id);
          return (
            <div
              key={i}
              className="cmd-param-row"
              style={{
                border: '1px solid #eef0f4', borderRadius: 8, padding: 10, marginBottom: 10,
                background: duplicateIds.has(p.id) ? '#fff2f0' : '#fafbfc',
              }}
            >
              <Row gutter={8} align="middle">
                <Col span={6}>
                  <Form.Item label="参数 key" style={{ marginBottom: 4 }}>
                    <Input
                      className="mono"
                      value={p.id}
                      onChange={(e) => updateParam(i, { id: e.target.value })}
                    />
                  </Form.Item>
                </Col>
                <Col span={7}>
                  <Form.Item label="显示名" style={{ marginBottom: 4 }}>
                    <Input value={p.label} onChange={(e) => updateParam(i, { label: e.target.value })} />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item label="类型" style={{ marginBottom: 4 }}>
                    <Select
                      value={p.type}
                      onChange={(v) => updateParam(i, { type: v })}
                      options={FIELD_TYPE_OPTIONS}
                    />
                  </Form.Item>
                </Col>
                <Col span={3}>
                  <Form.Item label="必填" style={{ marginBottom: 4 }}>
                    <Switch checked={!!p.required} onChange={(v) => updateParam(i, { required: v })} />
                  </Form.Item>
                </Col>
                <Col span={3} style={{ textAlign: 'right' }}>
                  <Button
                    size="small" danger type="text" icon={<DeleteOutlined />}
                    onClick={() => removeParam(i)}
                  >删除</Button>
                </Col>
              </Row>

              <Row gutter={8}>
                <Col span={6}>
                  <Form.Item label="默认值" style={{ marginBottom: 4 }}>
                    {p.type === 'checkbox' ? (
                      <Switch
                        checked={p.value === true || p.value === 'true'}
                        onChange={(v) => updateParam(i, { value: v })}
                      />
                    ) : (
                      <Input
                        placeholder="默认值"
                        value={p.value === undefined || p.value === null ? '' : String(p.value)}
                        onChange={(e) => updateParam(i, { value: coerceDefault(p, e.target.value) })}
                      />
                    )}
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="占位提示" style={{ marginBottom: 4 }}>
                    <Input value={p.placeholder ?? ''} onChange={(e) => updateParam(i, { placeholder: e.target.value })} />
                  </Form.Item>
                </Col>
                <Col span={4}>
                  <Form.Item label="格式校验" style={{ marginBottom: 4 }}>
                    <Select
                      value={p.format ?? 'plain'}
                      onChange={(v) => updateParam(i, { format: v === 'plain' ? undefined : v })}
                      options={FORMAT_OPTIONS}
                    />
                  </Form.Item>
                </Col>
                {(p.type === 'number' || p.type === 'stepper') && (
                  <>
                    <Col span={3}>
                      <Form.Item label="最小值" style={{ marginBottom: 4 }}>
                        <InputNumber
                          style={{ width: '100%' }}
                          value={p.min}
                          onChange={(v) => updateParam(i, { min: v ?? undefined })}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item label="最大值" style={{ marginBottom: 4 }}>
                        <InputNumber
                          style={{ width: '100%' }}
                          value={p.max}
                          onChange={(v) => updateParam(i, { max: v ?? undefined })}
                        />
                      </Form.Item>
                    </Col>
                  </>
                )}
              </Row>

              {(p.type === 'select' || p.type === 'multiselect') && (
                <Form.Item label="可选项（回车添加）" style={{ marginBottom: 4 }}>
                  <Select
                    mode="tags"
                    style={{ width: '100%' }}
                    value={Array.isArray(p.options) ? p.options.map((o) => (typeof o === 'string' ? o : o.value)) : []}
                    onChange={(vals: string[]) => updateParam(i, { options: vals })}
                    tokenSeparators={[',']}
                    placeholder="输入选项后回车"
                  />
                </Form.Item>
              )}

              <Form.Item label="字段说明" style={{ marginBottom: 0 }}>
                <Input
                  value={p.description ?? ''}
                  onChange={(e) => updateParam(i, { description: e.target.value })}
                  placeholder="给使用者看的参数说明"
                />
              </Form.Item>

              {duplicateIds.has(p.id) && (
                <Tag color="red" style={{ marginTop: 6 }} icon={<WarningFilled />}>参数 key 重复</Tag>
              )}
              {isUnused && (
                <Tag color="orange" style={{ marginTop: 6 }}>未在模板中使用（可作为固定开关或删除）</Tag>
              )}
            </div>
          );
        })}

        <Button size="small" icon={<PlusOutlined />} onClick={addParam} style={{ marginBottom: 10 }}>
          新增参数
        </Button>

        <Form.Item
          label={
            <Space size={4}>
              <SafetyCertificateOutlined />
              <span>原样注入参数（rawParams，不做 shell 转义）</span>
              <Tooltip title="选中的参数将原样拼入命令，不做单引号转义。仅用于完全可信的输入（例如预置开关），否则有命令注入风险。">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>(谨慎)</Typography.Text>
              </Tooltip>
            </Space>
          }
        >
          <Select
            mode="multiple"
            value={draft.rawParams ?? []}
            onChange={(v) => update({ rawParams: v })}
            options={draft.params.map((p) => ({ value: p.id, label: p.id }))}
            allowClear
          />
        </Form.Item>

        <Form.Item label="输出判读提示">
          <TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            value={draft.outputTips ?? ''}
            onChange={(e) => update({ outputTips: e.target.value })}
            placeholder="告诉使用者如何看这条命令的输出，怎样算通过"
          />
        </Form.Item>

        <Divider style={{ margin: '8px 0' }}>实时预览</Divider>
        <div className="mono" style={{
          padding: '8px 10px', background: '#0b1020', color: '#d6e2f5',
          borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {preview.command || <span style={{ color: '#64748b' }}>（填写模板和默认值后显示）</span>}
        </div>
        {preview.missing.length > 0 && (
          <Tag color="red" style={{ marginTop: 6 }}>未填参数: {preview.missing.join(', ')}</Tag>
        )}
        {unusedParams.length > 0 && (
          <Tag color="orange" style={{ marginTop: 6 }}>未使用参数: {unusedParams.join(', ')}</Tag>
        )}

        <Divider style={{ margin: '12px 0 8px' }}>命令测试</Divider>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          填入测试值后直接在服务器上执行这条命令，验证是否可用、输出是否符合预期。不会保存任何结果。
        </Typography.Paragraph>
        {params.length > 0 && (
          <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
            {params.map((p) => (
              <Col span={12} key={p.id}>
                <Input
                  size="small"
                  addonBefore={p.id}
                  placeholder={`测试值${p.value !== undefined && p.value !== '' ? ` (默认: ${String(p.value)})` : ''}`}
                  value={testValues[p.id] ?? ''}
                  onChange={(e) => setTestValues((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </Col>
            ))}
          </Row>
        )}
        <Space style={{ marginBottom: 8 }}>
          <Button
            type="default"
            icon={<PlayCircleOutlined />}
            loading={testing}
            onClick={runTest}
          >
            执行测试
          </Button>
          {testing && (
            <Button danger size="small" onClick={cancelTest}>
              终止
            </Button>
          )}
        </Space>
        {(liveLines.length > 0 || testing) && (
          <div className="mono" style={{
            padding: '10px 12px', background: '#0b1020', color: '#d6e2f5',
            borderRadius: 6, fontSize: 12, lineHeight: 1.5,
            maxHeight: 280, overflow: 'auto', marginBottom: 8,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }} ref={terminalRef}>
            {liveLines.map((l, i) => (
              <div
                key={i}
                style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: l.stream === 'cmd' ? '#60a5fa' : l.stream === 'stderr' ? '#fca5a5' : '#d6e2f5',
                }}
              >
                {l.stream === 'cmd' ? `$ ${l.text}` : l.text}
                {testing && i === liveLines.length - 1 && (
                  <span style={{ color: '#64748b', animation: 'terminal-blink 1s steps(2) infinite' }}> ▋</span>
                )}
              </div>
            ))}
          </div>
        )}
        {testResult && !testing && (
          <div>
            <Space style={{ marginBottom: 6 }} wrap>
              <Tag color={testResult.exitCode === 0 ? 'green' : 'red'}>
                退出码: {testResult.exitCode ?? '-'}
              </Tag>
              <Tag>{testResult.status}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {testResult.durationMs}ms
              </Typography.Text>
              {testResult.matchedRules.length > 0 ? (
                <Tag color="blue">命中 {testResult.matchedRules.length} 条判定规则</Tag>
              ) : (
                <Tag>无规则命中</Tag>
              )}
            </Space>
            {testResult.matchedRules.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {testResult.matchedRules.map((r) => (
                  <Tag key={r.clauseId + r.pattern} color={r.onMatch === 'verdict-pass' ? 'green' : r.onMatch === 'verdict-fail' ? 'red' : 'default'}>
                    {r.clauseId}: {r.pattern} → {r.onMatch === 'verdict-pass' ? 'PASS' : r.onMatch === 'verdict-fail' ? 'FAIL' : '证据'}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        )}

        {blockers.length > 0 && (
          <Alert
            style={{ marginTop: 10 }}
            type="error" showIcon
            message="保存前需修正以下问题"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            }
          />
        )}
      </Form>
    </Modal>
  );
}
