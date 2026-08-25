/**
 * expandMode 运行时展开层（v0.5）—— 让 TemplateStep.expandMode 真正生效。
 *
 * 两种模式（数据源均为**项目变量**，在运行开始前即可展开）：
 * - for_each_json：expandSource 指向的变量为数组或 JSON 数组字符串，
 *   逐项生成实例；实例变量 item=元素、index=序号(0 起)。
 * - cartesian：expandDims 列出的每个变量均为数组，做笛卡尔积；
 *   每个元素同时以 {{<变量名>}} 与 {{item.<变量名>}} 暴露。
 *
 * 实例规则：
 * - stepId = `${原id}#${k}`（k 从 1 起），保持同 clauseId 以便信号归并；
 * - groupKey 加后缀 `#i<k>` 防止 dedupeGroupedSteps 把实例折叠回一个；
 * - dependsOn 重映射：依赖也被展开 → 按序号配对（超出取最后一个）；未展开 → 原样；
 * - params 深拷贝后预渲染 {{item}} / {{item.字段}} / {{index}} / {{<dim名>}}；
 * - 单步实例上限 MAX_EXPANDED_INSTANCES=100，超出截断并在 notes 说明。
 */
import type { TemplateStep } from '@en18031/shared';

export const MAX_EXPANDED_INSTANCES = 100;

export interface ExpansionResult {
  steps: TemplateStep[];
  /** 因展开新增的实例数 */
  expandedCount: number;
  /** 人类可读的处理说明（写入 run 日志/时间线） */
  notes: string[];
}

interface InstanceVars {
  item: unknown;
  index: number;
  dims?: Record<string, unknown>;
}

/** 解析数组源：数组直接用；字符串尝试 JSON.parse；其余视为无效 */
function resolveArray(v: unknown): { arr: unknown[] } | { error: string } {
  if (Array.isArray(v)) return { arr: v };
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return { arr: parsed };
      return { error: 'JSON 解析成功但不是数组' };
    } catch {
      return { error: '不是合法的 JSON 数组字符串' };
    }
  }
  return { error: '变量缺失或类型不支持（需要数组/JSON 数组字符串）' };
}

const MUSTACHE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** 实例参数预渲染：支持 {{item}}、{{item.a.b}}、{{index}}、{{<dim名>}} */
function renderItemParams<T>(params: T, vars: InstanceVars): T {
  const renderString = (s: string): string =>
    s.replace(MUSTACHE, (_full, expr: string) => {
      const parts = expr.split('.').map((p) => p.trim());
      if (parts[0] === 'index') return String(vars.index);
      let bucket: unknown;
      if (parts[0] === 'item') {
        bucket = vars.item;
        for (const key of parts.slice(1)) {
          if (bucket && typeof bucket === 'object' && key in (bucket as Record<string, unknown>)) {
            bucket = (bucket as Record<string, unknown>)[key];
          } else {
            bucket = undefined;
            break;
          }
        }
      } else if (vars.dims && parts.length === 1 && parts[0] in vars.dims) {
        bucket = vars.dims[parts[0]];
      } else {
        return `{{${expr}}}`; // 非展开占位符保留，交给后续正常替换
      }
      if (bucket === undefined || bucket === null) return `{{${expr}}}`;
      return typeof bucket === 'object' ? JSON.stringify(bucket) : String(bucket);
    });

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return renderString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return walk(params) as T;
}

/** 笛卡尔积：dims 依次做乘积，产出元素为 {名: 值} 的组合列表 */
function cartesianProduct(dims: Array<{ name: string; values: unknown[] }>): Record<string, unknown>[] {
  let combos: Record<string, unknown>[] = [{}];
  for (const { name, values } of dims) {
    const next: Record<string, unknown>[] = [];
    for (const combo of combos) {
      for (const v of values) next.push({ ...combo, [name]: v });
    }
    combos = next;
  }
  return combos;
}

export function expandSteps(steps: TemplateStep[], variables: Record<string, unknown>): ExpansionResult {
  const notes: string[] = [];
  const expandedCountBefore = steps.length;
  /** 原步骤 id → 实例 id 列表（未展开则不含） */
  const instanceMap = new Map<string, string[]>();
  const out: TemplateStep[] = [];

  for (const step of steps) {
    if (!step.expandMode) {
      out.push(step);
      continue;
    }

    let instances: Array<{ vars: InstanceVars; label: string }> = [];
    if (step.expandMode === 'for_each_json') {
      const src = step.expandSource;
      if (!src) {
        notes.push(`步骤 ${step.stepId} 配置了 for_each_json 但缺少 expandSource，按单实例执行`);
        out.push(step);
        continue;
      }
      const r = resolveArray(variables[src]);
      if ('error' in r) {
        notes.push(`步骤 ${step.stepId} 展开源变量「${src}」无效（${r.error}），按单实例执行`);
        out.push(step);
        continue;
      }
      const arr = r.arr.slice(0, MAX_EXPANDED_INSTANCES);
      if (r.arr.length > MAX_EXPANDED_INSTANCES) {
        notes.push(`步骤 ${step.stepId} 展开数超过上限，已截断为 ${MAX_EXPANDED_INSTANCES} 个实例`);
      }
      instances = arr.map((item, i) => ({ vars: { item, index: i }, label: `#${i + 1}` }));
    } else {
      // cartesian
      const dimNames = step.expandDims ?? [];
      if (dimNames.length === 0) {
        notes.push(`步骤 ${step.stepId} 配置了 cartesian 但缺少 expandDims，按单实例执行`);
        out.push(step);
        continue;
      }
      const dims: Array<{ name: string; values: unknown[] }> = [];
      let invalid = false;
      for (const name of dimNames) {
        const r = resolveArray(variables[name]);
        if ('error' in r) {
          notes.push(`步骤 ${step.stepId} 笛卡尔维度变量「${name}」无效（${r.error}），按单实例执行`);
          invalid = true;
          break;
        }
        dims.push({ name, values: r.arr });
      }
      if (invalid) {
        out.push(step);
        continue;
      }
      let combos = cartesianProduct(dims);
      if (combos.length > MAX_EXPANDED_INSTANCES) {
        notes.push(`步骤 ${step.stepId} 笛卡尔积 ${combos.length} 超过上限，已截断为 ${MAX_EXPANDED_INSTANCES} 个实例`);
        combos = combos.slice(0, MAX_EXPANDED_INSTANCES);
      }
      instances = combos.map((combo, i) => ({ vars: { item: combo, index: i, dims: combo }, label: `#${i + 1}` }));
    }

    if (instances.length === 0) {
      // 空数组：为保下游 DAG 完整，退化为单个实例（item=null）并说明
      notes.push(`步骤 ${step.stepId} 展开源为空数组，退化为单实例执行（item=null）`);
      out.push({ ...step, params: renderItemParams(step.params, { item: null, index: 0 }) });
      instanceMap.set(step.stepId, [step.stepId]);
      continue;
    }

    const ids: string[] = [];
    for (const inst of instances) {
      const k = ids.length + 1;
      const sid = `${step.stepId}#${k}`;
      ids.push(sid);
      out.push({
        ...step,
        stepId: sid,
        title: `${step.title}${inst.label}`,
        params: renderItemParams(step.params, inst.vars),
        groupKey: step.groupKey ? `${step.groupKey}#i${k}` : undefined,
      });
    }
    instanceMap.set(step.stepId, ids);
    notes.push(
      `步骤 ${step.title} 经 expandMode=${step.expandMode} 展开为 ${ids.length} 个实例`,
    );
  }

  // 依赖重映射：展开步骤的实例按序号配对上游实例；未展开依赖保持原样
  const remapDeps = (deps: string[], ownIndex: number): string[] => {
    const mapped: string[] = [];
    for (const d of deps) {
      const instIds = instanceMap.get(d);
      if (!instIds || instIds.length === 0) {
        mapped.push(d);
      } else {
        mapped.push(instIds[Math.min(ownIndex, instIds.length - 1)]);
      }
    }
    return mapped;
  };

  const finalSteps: TemplateStep[] = [];
  for (const s of out) {
    const m = /^(.*)#(\d+)$/.exec(s.stepId);
    if (m && instanceMap.has(m[1])) {
      const ownIndex = Number(m[2]) - 1;
      finalSteps.push({ ...s, dependsOn: remapDeps(s.dependsOn, ownIndex) });
    } else {
      finalSteps.push(s);
    }
  }

  return { steps: finalSteps, expandedCount: Math.max(0, finalSteps.length - expandedCountBefore), notes };
}
