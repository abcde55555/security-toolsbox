import { useEffect, useState } from 'react';
import { Select, Input, Space, Tag, Radio, Typography } from 'antd';
import type { StepVerdictRule, Severity } from '@en18031/shared';
import { ToolsApi } from '../api/endpoints';

interface Props {
  value?: StepVerdictRule | null;
  toolId: string;
  onChange: (rule: StepVerdictRule | null) => void;
}

/**
 * Editor for how a single step's result maps to a clause verdict.
 * - Module tools: pick which of the module's returned verdicts applies
 * - Command tools: configure pass/fail conditions on exit code / output
 */
export default function VerdictRuleEditor({ value, toolId, onChange }: Props) {
  const [kind, setKind] = useState<'module' | 'command' | 'none'>(
    value?.kind ?? 'none',
  );
  const [moduleClauses, setModuleClauses] = useState<
    Array<{ clauseId: string; title: string; severity: string }>
  >([]);

  useEffect(() => {
    if (!toolId) return;
    ToolsApi.verdictCapabilities(toolId)
      .then((cap) => {
        if (cap.interactionMode === 'form') {
          setModuleClauses(cap.clauses);
          if (!value && cap.clauses.length > 0) {
            setKind('module');
            onChange({ kind: 'module', mapClauseId: cap.clauses[0].clauseId });
          }
        } else {
          if (!value) setKind('command');
        }
      })
      .catch(() => {
        /* tool may not be saved yet */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  if (kind === 'module') {
    const selected = (value && value.kind === 'module' && value.mapClauseId) ?? moduleClauses[0]?.clauseId;
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          模组直接返回判定，选择对应条款：
        </Typography.Text>
        <Select
          size="small"
          style={{ width: '100%' }}
          value={selected}
          options={moduleClauses.map((c) => ({
            value: c.clauseId,
            label: `${c.clauseId} ${c.title}`,
          }))}
          onChange={(v) => onChange({ kind: 'module', mapClauseId: String(v) })}
        />
        {moduleClauses.length === 0 && (
          <Tag color="orange">该模组未声明任何条款判定</Tag>
        )}
      </Space>
    );
  }

  if (kind === 'command') {
    type CommandRule = Extract<StepVerdictRule, { kind: 'command' }>;
    const emptyRule: CommandRule = { kind: 'command', passOnExitCode: 0 };
    const rule: CommandRule = value?.kind === 'command' ? value : emptyRule;
    const { kind: _k, ...ruleFields } = rule;
    const update = (patch: Partial<CommandRule>) =>
      onChange({ kind: 'command', ...ruleFields, ...patch });
    return (
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          命令输出/退出码满足条件即判定：
        </Typography.Text>
        <Space wrap size={6}>
          <Tag color="green">通过当</Tag>
          <Select
            size="small"
            style={{ width: 130 }}
            value={rule.passOnExitCode !== undefined ? 'exit' : rule.passOnOutputContains ? 'contains' : rule.passOnOutputRegex ? 'regex' : 'exit'}
            onChange={(v) => {
              if (v === 'exit') update({ passOnExitCode: 0, passOnOutputContains: undefined, passOnOutputRegex: undefined });
              if (v === 'contains') update({ passOnExitCode: undefined, passOnOutputContains: '', passOnOutputRegex: undefined });
              if (v === 'regex') update({ passOnExitCode: undefined, passOnOutputContains: undefined, passOnOutputRegex: '' });
            }}
            options={[
              { value: 'exit', label: '退出码 =' },
              { value: 'contains', label: '输出包含' },
              { value: 'regex', label: '输出匹配' },
            ]}
          />
          {rule.passOnExitCode !== undefined && (
            <InputNumber value={rule.passOnExitCode} onChange={(v) => update({ passOnExitCode: v ?? 0 })} style={{ width: 80 }} />
          )}
          {(rule.passOnOutputContains !== undefined || rule.passOnOutputRegex !== undefined) && (
            <Input
              size="small"
              style={{ width: 200 }}
              placeholder={rule.passOnOutputRegex !== undefined ? '正则表达式' : '包含的文本'}
              value={rule.passOnOutputContains ?? rule.passOnOutputRegex ?? ''}
              onChange={(e) =>
                rule.passOnOutputRegex !== undefined
                  ? update({ passOnOutputRegex: e.target.value })
                  : update({ passOnOutputContains: e.target.value })
              }
            />
          )}
        </Space>
        <Space wrap size={6}>
          <Tag color="red">失败当</Tag>
          <Select
            size="small"
            style={{ width: 130 }}
            value={rule.failOnExitCode !== undefined ? 'exit' : rule.failOnOutputContains ? 'contains' : rule.failOnOutputRegex ? 'regex' : 'none'}
            onChange={(v) => {
              if (v === 'none') update({ failOnExitCode: undefined, failOnOutputContains: undefined, failOnOutputRegex: undefined });
              if (v === 'exit') update({ failOnExitCode: 1, failOnOutputContains: undefined, failOnOutputRegex: undefined });
              if (v === 'contains') update({ failOnExitCode: undefined, failOnOutputContains: '', failOnOutputRegex: undefined });
              if (v === 'regex') update({ failOnExitCode: undefined, failOnOutputContains: undefined, failOnOutputRegex: '' });
            }}
            options={[
              { value: 'none', label: '不额外判定' },
              { value: 'exit', label: '退出码 =' },
              { value: 'contains', label: '输出包含' },
              { value: 'regex', label: '输出匹配' },
            ]}
          />
          {rule.failOnExitCode !== undefined && (
            <InputNumber value={rule.failOnExitCode} onChange={(v) => update({ failOnExitCode: v ?? 1 })} style={{ width: 80 }} />
          )}
          {(rule.failOnOutputContains !== undefined || rule.failOnOutputRegex !== undefined) && (
            <Input
              size="small"
              style={{ width: 200 }}
              placeholder={rule.failOnOutputRegex !== undefined ? '正则表达式' : '包含的文本'}
              value={rule.failOnOutputContains ?? rule.failOnOutputRegex ?? ''}
              onChange={(e) =>
                rule.failOnOutputRegex !== undefined
                  ? update({ failOnOutputRegex: e.target.value })
                  : update({ failOnOutputContains: e.target.value })
              }
            />
          )}
        </Space>
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>严重度：</Typography.Text>
          <Select
            size="small"
            style={{ width: 100 }}
            value={rule.severity ?? 'middle'}
            onChange={(v: Severity) => update({ severity: v })}
            options={[
              { value: 'high', label: '高' },
              { value: 'middle', label: '中' },
              { value: 'low', label: '低' },
            ]}
          />
        </Space>
      </Space>
    );
  }

  return (
    <Radio.Group size="small" value={kind} onChange={(e) => {
      const k = e.target.value;
      setKind(k);
      if (k === 'module' && moduleClauses[0]) onChange({ kind: 'module', mapClauseId: moduleClauses[0].clauseId });
      else if (k === 'command') onChange({ kind: 'command', passOnExitCode: 0 });
      else onChange(null);
    }}>
      <Radio.Button value="command">命令判定</Radio.Button>
      <Radio.Button value="module">模组判定</Radio.Button>
      <Radio.Button value="none">不判定</Radio.Button>
    </Radio.Group>
  );
}

// Minimal local InputNumber to avoid antd version import issues.
function InputNumber(props: { value?: number; onChange: (v: number) => void; style?: React.CSSProperties }) {
  return (
    <Input
      size="small"
      type="number"
      style={props.style}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  );
}
