import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createInMemoryRepositories } from '../repositories/index.js';
import { ClauseMappingService } from '../services/clauseMappingService.js';
import type { ServiceContext } from '../services/context.js';
import type { ExecutionResult } from '@en18031/shared';
import './helpers.js';

function makeService() {
  const { repos, close } = createInMemoryRepositories();
  const ctx = {
    repos,
    bus: new EventEmitter(),
    userId: 'tester',
    engine: {} as never,
    moduleLoader: {} as never,
    authz: {} as never,
  } as unknown as ServiceContext;
  return { svc: new ClauseMappingService(ctx), repos, close };
}

function baseResult(stdout: string): ExecutionResult {
  return {
    runId: 'sr-1', projectId: 'p1', stepId: 's1', toolId: 'ble-scan',
    status: 'success', exitCode: 0, stdout, stderr: '', durationMs: 1,
    startedAt: '', finishedAt: '', evidence: [], verdicts: [],
  };
}

async function seed({ rule }: { rule: { matcherType: 'js-expression' | 'contains'; pattern: string; onMatch: 'verdict-pass' | 'evidence-only' | 'verdict-fail' } }) {
  const { svc, repos, close } = makeService();
  const tool = repos.tools.create({
    name: 'BLE 扫描器', type: 'custom', interactionMode: 'cmd',
    version: '1.0', category: 'wireless',
  });
  repos.clauses.upsert({
    standardVersion: 'EN18031:1', clauseId: 'GEC-1', title: '通用加密',
    chapter: 'A', level: 'L1', defaultSeverity: 'middle',
    description: '', tags: [],
  });
  repos.clauses.createMappingRule({
    toolId: tool.id, clauseId: 'GEC-1',
    matcherType: rule.matcherType, pattern: rule.pattern, onMatch: rule.onMatch,
    priority: 10,
  });
  return { svc, repos, close, tool };
}

describe('clauseMappingService —— v0.4 判定语义修正', () => {
  it('js-expression 走真实表达式求值（不再按正则近似）', async () => {
    const { svc, close, tool } = await seed({
      rule: {
        matcherType: 'js-expression',
        // 正则近似下这个表达式永远匹配不上；表达式语义下命中
        pattern: '/connected/.test(output) && !/error/i.test(output)',
        onMatch: 'verdict-pass',
      },
    });
    try {
      const out = svc.processAndPersist({
        projectId: 'p1', projectRunId: 'r1', stepRunId: 'sr-1',
        standardVersion: 'EN18031:1', toolId: tool.id,
        result: baseResult('device connected\nall good'),
      });
      expect(out.verdicts).toHaveLength(1);
      expect(out.verdicts[0].pass).toBe(true);
      expect(out.evidenceIds.length).toBeGreaterThan(0);
    } finally { close(); }
  });

  it('js-expression 求值为假时不产出判定', async () => {
    const { svc, close, tool } = await seed({
      rule: {
        matcherType: 'js-expression',
        pattern: '/connected/.test(output) && !/error/i.test(output)',
        onMatch: 'verdict-pass',
      },
    });
    try {
      const out = svc.processAndPersist({
        projectId: 'p1', projectRunId: 'r1', stepRunId: 'sr-1',
        standardVersion: 'EN18031:1', toolId: tool.id,
        result: baseResult('connection error'),
      });
      expect(out.verdicts).toHaveLength(0);
    } finally { close(); }
  });

  it('evidence-only：命中只沉淀证据，不产出 pass=false 判定（v0.4 修正）', async () => {
    const { svc, close, tool } = await seed({
      rule: { matcherType: 'contains', pattern: 'handshake logged', onMatch: 'evidence-only' },
    });
    try {
      const out = svc.processAndPersist({
        projectId: 'p1', projectRunId: 'r1', stepRunId: 'sr-1',
        standardVersion: 'EN18031:1', toolId: tool.id,
        result: baseResult('handshake logged ok'),
      });
      expect(out.evidenceIds).toHaveLength(1); // 规则命中产生的断言证据
      expect(out.verdicts).toHaveLength(0); // 不再有误报的 fail 判定
    } finally { close(); }
  });

  it('verdict-fail 行为保持不变：命中即失败判定', async () => {
    const { svc, close, tool } = await seed({
      rule: { matcherType: 'contains', pattern: 'weak cipher', onMatch: 'verdict-fail' },
    });
    try {
      const out = svc.processAndPersist({
        projectId: 'p1', projectRunId: 'r1', stepRunId: 'sr-1',
        standardVersion: 'EN18031:1', toolId: tool.id,
        result: baseResult('negotiated weak cipher RC4'),
      });
      expect(out.verdicts).toHaveLength(1);
      expect(out.verdicts[0].pass).toBe(false);
    } finally { close(); }
  });
});
