import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Modal, Tree, Card, Button, Space, Select, InputNumber, Input, Tag, Typography,
  Empty, Divider, Radio, Tooltip, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ApiOutlined, BranchesOutlined,
} from '@ant-design/icons';
import type {
  Template, TemplateStep, Tool, ClauseNode, ClauseAggregation,
  StepVerdictRule, TemplateClauseBinding, TemplateVariable, FormField,
} from '@en18031/shared';
import { ClausesApi, ToolsApi, StandardsApi } from '../api/endpoints';
import { useCategories } from '../hooks/useCategories';
import VerdictRuleEditor from './VerdictRuleEditor';
import StepParamBinder from './StepParamBinder';

interface Props {
  open: boolean;
  template: Template | null; // null = create new
  onClose: () => void;
  onSave: (payload: ComplianceSavePayload) => Promise<void>;
}

export interface ComplianceSavePayload {
  name: string;
  description?: string;
  concurrencyLimit: number;
  mode: 'compliance';
  variables: Template['variables'];
  clauseBindings: TemplateClauseBinding[];
  steps: TemplateStep[];
  toolRefs: Array<{ toolId: string; toolVersionLock: 'follow' }>;
  revision?: number;
}

interface ClauseStepForm {
  localId: string;
  title: string;
  toolId: string;
  params: Record<string, unknown>;
  verdictRule: StepVerdictRule | null;
  groupKey?: string;
  timeoutMs?: number;
}

export default function ComplianceTemplateEditor({ open, template, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [concurrency, setConcurrency] = useState(1);
  const [standards, setStandards] = useState<Array<{ id: string; name: string }>>([]);
  const [standardId, setStandardId] = useState('EN18031:2019');
  const [clauseTree, setClauseTree] = useState<ClauseNode[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selectedClauses, setSelectedClauses] = useState<Set<string>>(new Set());
  const [stepsByClause, setStepsByClause] = useState<Map<string, ClauseStepForm[]>>(new Map());
  const [aggregation, setAggregation] = useState<Map<string, ClauseAggregation>>(new Map());
  const [saving, setSaving] = useState(false);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const { labelOf } = useCategories();

  // Load standards, clauses, tools
  useEffect(() => {
    if (!open) return;
    StandardsApi.list().then((ss) => {
      setStandards(ss);
      if (ss[0]) setStandardId(ss[0].id);
    }).catch(() => {});
    ToolsApi.list({ pageSize: 500 }).then((r) => setTools(r.items));
  }, [open]);

  useEffect(() => {
    if (!open || !standardId) return;
    ClausesApi.tree(standardId).then(setClauseTree).catch(() => {});
  }, [open, standardId]);

  // Load existing template data
  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setDescription(template.description ?? '');
      setConcurrency(template.concurrencyLimit);
      const sel = new Set<string>((template.clauseBindings ?? []).map((b) => b.clauseId));
      setSelectedClauses(sel);
      const aggMap = new Map<string, ClauseAggregation>();
      for (const b of template.clauseBindings ?? []) {
        aggMap.set(b.clauseId, b.aggregation);
      }
      setAggregation(aggMap);
      setVariables(template.variables ?? []);
      const stepMap = new Map<string, ClauseStepForm[]>();
      for (const s of template.steps) {
        if (!s.clauseId) continue;
        const arr = stepMap.get(s.clauseId) ?? [];
        arr.push({
          localId: s.stepId,
          title: s.title,
          toolId: s.toolId,
          params: s.params,
          verdictRule: s.verdictRule ?? null,
          groupKey: s.groupKey ?? undefined,
          timeoutMs: s.timeoutMs,
        });
        stepMap.set(s.clauseId, arr);
      }
      setStepsByClause(stepMap);
    } else {
      setName('');
      setDescription('');
      setConcurrency(1);
      setSelectedClauses(new Set());
      setStepsByClause(new Map());
      setAggregation(new Map());
    }
  }, [open, template]);

  const toolById = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools]);

  const leafClauses = useMemo(() => {
    const out: ClauseNode[] = [];
    const walk = (nodes: ClauseNode[]) => {
      for (const n of nodes) {
        if (!n.children || n.children.length === 0) out.push(n);
        else walk(n.children);
      }
    };
    walk(clauseTree);
    return out;
  }, [clauseTree]);

  const toggleClause = (clauseId: string) => {
    setSelectedClauses((prev) => {
      const next = new Set(prev);
      if (next.has(clauseId)) {
        next.delete(clauseId);
        setStepsByClause((m) => { const c = new Map(m); c.delete(clauseId); return c; });
      } else {
        next.add(clauseId);
        if (!stepsByClause.has(clauseId)) {
          setStepsByClause((m) => new Map(m).set(clauseId, []));
        }
        if (!aggregation.has(clauseId)) {
          setAggregation((m) => new Map(m).set(clauseId, { mode: 'cross_check', strategy: 'all_pass' }));
        }
      }
      return next;
    });
  };

  const addStep = (clauseId: string) => {
    const form: ClauseStepForm = {
      localId: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: '新步骤',
      toolId: '',
      params: {},
      verdictRule: null,
    };
    setStepsByClause((m) => {
      const arr = [...(m.get(clauseId) ?? []), form];
      return new Map(m).set(clauseId, arr);
    });
  };

  const updateStep = (clauseId: string, localId: string, patch: Partial<ClauseStepForm>) => {
    setStepsByClause((m) => {
      const arr = (m.get(clauseId) ?? []).map((s) => (s.localId === localId ? { ...s, ...patch } : s));
      return new Map(m).set(clauseId, arr);
    });
  };

  const removeStep = (clauseId: string, localId: string) => {
    setStepsByClause((m) => {
      const arr = (m.get(clauseId) ?? []).filter((s) => s.localId !== localId);
      return new Map(m).set(clauseId, arr);
    });
  };

  const setAgg = (clauseId: string, agg: ClauseAggregation) => {
    setAggregation((m) => new Map(m).set(clauseId, agg));
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const steps: TemplateStep[] = [];
    const clauseBindings: TemplateClauseBinding[] = [];
    let pos = 0;
    for (const clauseId of selectedClauses) {
      const clauseSteps = stepsByClause.get(clauseId) ?? [];
      const validSteps = clauseSteps.filter((s) => s.toolId);
      // chain mode: each step depends on the previous
      const agg = aggregation.get(clauseId) ?? { mode: 'cross_check' as const, strategy: 'all_pass' as const };
      for (let i = 0; i < validSteps.length; i++) {
        const s = validSteps[i];
        const tool = toolById.get(s.toolId);
        const dependsOn =
          agg.mode === 'chain' && i > 0 ? [validSteps[i - 1].localId] : [];
        steps.push({
          stepId: s.localId,
          title: s.title || tool?.name || s.localId,
          toolId: s.toolId,
          toolVersion: tool?.version ?? '1.0.0',
          params: s.params,
          dependsOn,
          onFailure: 'continue',
          position: pos++,
          clauseId,
          verdictRule: s.verdictRule,
          groupKey: s.groupKey || undefined,
          timeoutMs: s.timeoutMs,
        });
      }
      clauseBindings.push({
        clauseId,
        enabled: true,
        position: clauseBindings.length,
        aggregation: agg,
      });
    }
    const toolRefs = Array.from(new Set(steps.map((s) => s.toolId))).map((toolId) => ({
      toolId,
      toolVersionLock: 'follow' as const,
    }));
    setSaving(true);
    try {
      await onSave({
        name,
        description: description || undefined,
        concurrencyLimit: concurrency,
        mode: 'compliance',
        variables,
        clauseBindings,
        steps,
        toolRefs,
        revision: template?.revision,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={template ? `合规编排：${template.name}` : '新建合规模板'}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      width={1000}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Input
            placeholder="模板名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: 240 }}
            status={!name.trim() ? 'error' : ''}
          />
          <Input
            placeholder="描述"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: 320 }}
          />
          <Select
            value={standardId}
            onChange={setStandardId}
            style={{ width: 200 }}
            options={standards.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Space>
            <Typography.Text type="secondary">并发：</Typography.Text>
            <InputNumber min={1} max={8} value={concurrency} onChange={(v) => setConcurrency(v ?? 1)} style={{ width: 70 }} />
          </Space>
        </Space>

        <Alert
          type="info" showIcon
          message="合规模式以条款为骨架：勾选要测试的叶子条款，在每个条款下编排工具并配置判定规则，运行后按条款汇总成报告。"
        />

        <div style={{ display: 'flex', gap: 16 }}>
          {/* Clause tree */}
          <Card size="small" title="选择测试条款" style={{ width: 300, flexShrink: 0 }} styles={{ body: { maxHeight: 520, overflow: 'auto' } }}>
            {clauseTree.length === 0 ? (
              <Empty description="该标准暂无条款" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Tree
                checkedKeys={Array.from(selectedClauses)}
                onCheck={(_, info) => {
                  // only allow checking leaf clauses
                  const node = info.node;
                  if (node.isLeaf) toggleClause(node.key as string);
                }}
                treeData={buildTreeData(clauseTree)}
                defaultExpandAll
                selectable={false}
              />
            )}
          </Card>

          {/* Clause editors */}
          <div style={{ flex: 1, maxHeight: 520, overflow: 'auto', paddingRight: 4 }}>
            {selectedClauses.size === 0 ? (
              <Empty description="在左侧勾选条款开始编排" />
            ) : (
              Array.from(selectedClauses).map((clauseId) => {
                const clause = leafClauses.find((c) => c.clauseId === clauseId);
                const clauseSteps = stepsByClause.get(clauseId) ?? [];
                const agg = aggregation.get(clauseId) ?? { mode: 'cross_check', strategy: 'all_pass' } as ClauseAggregation;
                return (
                  <Card
                    key={clauseId}
                    size="small"
                    style={{ marginBottom: 12 }}
                    title={
                      <Tooltip
                        title={
                          clause?.description ? (
                            <div style={{ maxWidth: 360 }}>
                              <div style={{ marginBottom: 4 }}>{clause.description}</div>
                              {clause.testingMethod && (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  测试方法：{clause.testingMethod}
                                </Typography.Text>
                              )}
                            </div>
                          ) : undefined
                        }
                        placement="topLeft"
                      >
                        <Space style={{ cursor: clause?.description ? 'help' : 'default' }}>
                          <Tag color="geekblue">{clauseId}</Tag>
                          <span>{clause?.title ?? clauseId}</span>
                        </Space>
                      </Tooltip>
                    }
                    extra={
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addStep(clauseId)}>
                        添加工具
                      </Button>
                    }
                  >
                    <AggregationEditor value={agg} onChange={(a) => setAgg(clauseId, a)} />
                    <Divider style={{ margin: '8px 0' }} />
                    {clauseSteps.length === 0 ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        还没有工具步骤，点右上角添加。
                      </Typography.Text>
                    ) : (
                      clauseSteps.map((s, idx) => {
                        const tool = toolById.get(s.toolId);
                        return (
                          <Card key={s.localId} size="small" type="inner" style={{ marginBottom: 8 }}
                            title={
                              <Space>
                                <Tag>{idx + 1}</Tag>
                                <Select
                                  size="small"
                                  style={{ width: 220 }}
                                  placeholder="选择工具"
                                  value={s.toolId || undefined}
                                  showSearch
                                  optionFilterProp="label"
                                  onChange={(toolId) => {
                                    const t = toolById.get(toolId);
                                    updateStep(clauseId, s.localId, {
                                      toolId,
                                      title: t?.name ?? s.title,
                                      params: {},
                                      verdictRule: null,
                                    });
                                  }}
                                  options={tools.map((t) => ({
                                    value: t.id,
                                    label: `${t.name} (${labelOf(t.category)})`,
                                  }))}
                                />
                                {tool && <Tag>{tool.interactionMode === 'form' ? '模组' : '命令'}</Tag>}
                              </Space>
                            }
                            extra={
                              <Space>
                                {idx > 0 && (
                                  <Tooltip title="上移">
                                    <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => {
                                      const arr = [...clauseSteps];
                                      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                                      setStepsByClause((m) => new Map(m).set(clauseId, arr));
                                    }} />
                                  </Tooltip>
                                )}
                                {idx < clauseSteps.length - 1 && (
                                  <Tooltip title="下移">
                                    <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => {
                                      const arr = [...clauseSteps];
                                      [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
                                      setStepsByClause((m) => new Map(m).set(clauseId, arr));
                                    }} />
                                  </Tooltip>
                                )}
                                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeStep(clauseId, s.localId)} />
                              </Space>
                            }
                          >
                            {s.toolId ? (
                              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <StepParamBinder
                                  fields={(tool?.formFields ?? []) as FormField[]}
                                  params={s.params}
                                  variables={variables}
                                  onAddVariable={(v) => setVariables((prev) => prev.some((x) => x.name === v.name) ? prev : [...prev, v])}
                                  onChange={(id, value) => updateStep(clauseId, s.localId, { params: { ...s.params, [id]: value } })}
                                />
                                <div>
                                  <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>判定规则：</Typography.Text>
                                  <VerdictRuleEditor
                                    toolId={s.toolId}
                                    value={s.verdictRule}
                                    onChange={(verdictRule) => updateStep(clauseId, s.localId, { verdictRule })}
                                  />
                                </div>
                              </Space>
                            ) : (
                              <Typography.Text type="warning" style={{ fontSize: 12 }}>请选择工具</Typography.Text>
                            )}
                          </Card>
                        );
                      })
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </Space>
    </Modal>
  );
}

function AggregationEditor({ value, onChange }: { value: ClauseAggregation; onChange: (a: ClauseAggregation) => void }) {
  return (
    <Space wrap size={6}>
      <Radio.Group
        size="small"
        value={value.mode}
        onChange={(e) => {
          const mode = e.target.value;
          if (mode === 'chain') {
            onChange({ mode: 'chain', finalVerdict: { passAll: [] } });
          } else {
            onChange({ mode: 'cross_check', strategy: value.mode === 'cross_check' ? value.strategy : 'all_pass' });
          }
        }}
        optionType="button"
        buttonStyle="solid"
      >
        <Radio.Button value="cross_check"><BranchesOutlined /> 多工具校验</Radio.Button>
        <Radio.Button value="chain"><ApiOutlined /> 链式测试</Radio.Button>
      </Radio.Group>
      {value.mode === 'cross_check' && (
        <Select
          size="small"
          style={{ width: 150 }}
          value={value.strategy}
          onChange={(strategy) => onChange({ ...value, strategy })}
          options={[
            { value: 'all_pass', label: '全部通过' },
            { value: 'any_pass', label: '任一通过' },
            { value: 'any_fail', label: '任一失败' },
            { value: 'majority', label: '多数通过' },
          ]}
        />
      )}
      {value.mode === 'chain' && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          步骤按顺序执行，上游失败则跳过后续并判该条款失败（注明原因）。
        </Typography.Text>
      )}
    </Space>
  );
}

interface TreeNode {
  key: string;
  title: ReactNode;
  isLeaf: boolean;
  selectable: boolean;
  disabled: boolean;
  children?: TreeNode[];
}
function buildTreeData(nodes: ClauseNode[]): TreeNode[] {
  return nodes.map((n): TreeNode => {
    const hasChildren = !!(n.children && n.children.length > 0);
    return {
      key: n.clauseId,
      title: (
        <Tooltip
          title={n.description ? <div style={{ maxWidth: 320 }}>{n.description}</div> : undefined}
          placement="right"
        >
          <Space size={4}>
            <span>{n.clauseId}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>{n.title}</span>
          </Space>
        </Tooltip>
      ),
      isLeaf: !hasChildren,
      selectable: !hasChildren,
      disabled: hasChildren,
      children: hasChildren ? buildTreeData(n.children!) : undefined,
    };
  });
}
