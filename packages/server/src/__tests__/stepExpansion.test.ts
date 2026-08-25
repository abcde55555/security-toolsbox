import { describe, it, expect } from 'vitest';
import { expandSteps, MAX_EXPANDED_INSTANCES } from '../services/stepExpansion.js';
import type { TemplateStep } from '@en18031/shared';

function step(partial: Partial<TemplateStep>): TemplateStep {
  return {
    stepId: 's1',
    title: '扫描',
    toolId: 't1',
    toolVersion: '1.0',
    params: {},
    dependsOn: [],
    onFailure: 'continue',
    position: 0,
    ...partial,
  };
}

describe('expandSteps —— expandMode 运行时展开（v0.5）', () => {
  it('for_each_json：数组变量逐项展开，params 预渲染 item 字段', () => {
    const tpl = step({
      stepId: 'scan',
      expandMode: 'for_each_json',
      expandSource: 'devices',
      params: { target: '{{item.ip}}', note: '{{item.name}}({{index}})' },
    });
    const r = expandSteps([tpl], {
      devices: [{ ip: '10.0.0.1', name: '手环A' }, { ip: '10.0.0.2', name: '手环B' }],
    });
    expect(r.steps).toHaveLength(2);
    expect(r.expandedCount).toBe(1); // 2 实例 - 1 原步骤
    expect(r.steps.map((s) => s.stepId)).toEqual(['scan#1', 'scan#2']);
    expect(r.steps[0].params).toEqual({ target: '10.0.0.1', note: '手环A(0)' });
    expect(r.steps[1].params).toEqual({ target: '10.0.0.2', note: '手环B(1)' });
    expect(r.notes.some((n) => n.includes('展开为 2 个实例'))).toBe(true);
  });

  it('for_each_json 接受 JSON 数组字符串；对象元素整体注入为 JSON 文本', () => {
    const tpl = step({
      stepId: 'x',
      expandMode: 'for_each_json',
      expandSource: 'list',
      params: { arg: '{{item}}' },
    });
    const r = expandSteps([tpl], { list: '["a","b"]' });
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0].params).toEqual({ arg: 'a' });
  });

  it('cartesian：两维度做乘积，dim 变量与 item.<名> 双通道暴露', () => {
    const tpl = step({
      stepId: 'pair',
      expandMode: 'cartesian',
      expandDims: ['devices', 'channels'],
      params: { d: '{{devices}}', c: '{{channels}}', tag: '{{item.devices}}-{{item.channels}}' },
    });
    const r = expandSteps([tpl], { devices: ['D1', 'D2'], channels: ['ch37', 'ch38', 'ch39'] });
    expect(r.steps).toHaveLength(6);
    expect(r.steps[0].params).toEqual({ d: 'D1', c: 'ch37', tag: 'D1-ch37' });
    expect(r.steps[5].params).toEqual({ d: 'D2', c: 'ch39', tag: 'D2-ch39' });
  });

  it('依赖按序号配对：下游实例 k 依赖上游实例 min(k, N上游)', () => {
    const upstream = step({
      stepId: 'disc', expandMode: 'for_each_json', expandSource: 'ips', params: { t: '{{item}}' },
    });
    const downstream = step({
      stepId: 'check', dependsOn: ['disc'],
      expandMode: 'for_each_json', expandSource: 'ports', params: { p: '{{item}}' },
    });
    const r = expandSteps(
      [upstream, downstream],
      { ips: ['10.0.0.1', '10.0.0.2'], ports: ['80', '443', '22'] },
    );
    const checkInsts = r.steps.filter((s) => s.stepId.startsWith('check#'));
    expect(checkInsts).toHaveLength(3);
    // 上游只有 2 实例 → 第 3 个下游实例配对到最后一个上游实例
    expect(checkInsts[0].dependsOn).toEqual(['disc#1']);
    expect(checkInsts[1].dependsOn).toEqual(['disc#2']);
    expect(checkInsts[2].dependsOn).toEqual(['disc#2']);
  });

  it('未展开的依赖保持原样；groupKey 加实例后缀防折叠', () => {
    const plain = step({ stepId: 'prep', title: '准备' });
    const exp = step({
      stepId: 'work', groupKey: 'g1', clauseId: 'C-1',
      expandMode: 'for_each_json', expandSource: 'items', params: {}, dependsOn: ['prep'],
    });
    const r = expandSteps([plain, exp], { items: [1, 2] });
    const inst = r.steps.find((s) => s.stepId === 'work#1')!;
    expect(inst.dependsOn).toEqual(['prep']);
    expect(inst.groupKey).toBe('g1#i1');
    expect(inst.clauseId).toBe('C-1');
  });

  it('超过上限截断并记录说明', () => {
    const big = Array.from({ length: MAX_EXPANDED_INSTANCES + 30 }, (_, i) => i);
    const tpl = step({
      stepId: 'bulk', expandMode: 'for_each_json', expandSource: 'big', params: {},
    });
    const r = expandSteps([tpl], { big });
    expect(r.steps).toHaveLength(MAX_EXPANDED_INSTANCES);
    expect(r.notes.some((n) => n.includes('截断'))).toBe(true);
  });

  it('无效源（缺失/非数组/坏 JSON）安全退化为单实例', () => {
    const tpl = step({ stepId: 'e', expandMode: 'for_each_json', expandSource: 'nope', params: {} });
    for (const vars of [{}, { nope: 42 }, { nope: '{bad json' }]) {
      const r = expandSteps([tpl], vars);
      expect(r.steps).toHaveLength(1);
      expect(r.steps[0].stepId).toBe('e');
      expect(r.notes.some((n) => n.includes('按单实例执行'))).toBe(true);
    }
  });

  it('空数组退化为单实例（保下游 DAG），item=null', () => {
    const tpl = step({ stepId: 'z', expandMode: 'for_each_json', expandSource: 'empty', params: { v: '{{item.x}}' } });
    const r = expandSteps([tpl], { empty: [] });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].stepId).toBe('z');
    expect(r.steps[0].params).toEqual({ v: '{{item.x}}' }); // item=null → 占位符保留
  });

  it('无 expandMode 的步骤原样通过', () => {
    const plain = step({ stepId: 'p', params: { keep: '{{project.foo}}' } });
    const r = expandSteps([plain], {});
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toBe(plain);
    expect(r.expandedCount).toBe(0);
  });
});
