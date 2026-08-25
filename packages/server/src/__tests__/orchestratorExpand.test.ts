/**
 * expandMode 编排器级集成测试：走真实 startRun → 调度 → 终态全链路，
 * 验证展开实例被创建、参数已预渲染、日志说明已广播。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TemplateStep } from '@en18031/shared';
import './helpers.js';

import { EventEmitter } from 'node:events';
import { createInMemoryRepositories } from '../repositories/index.js';
import { ExecutionEngine } from '../engine/executionEngine.js';
import { ModuleLoader } from '../engine/moduleLoader.js';
import { OrchestratorService } from '../services/orchestratorService.js';
import type { ServiceContext } from '../services/context.js';

function makeContext() {
  const { repos, close } = createInMemoryRepositories();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const moduleLoader = new ModuleLoader();
  const engine = new ExecutionEngine(moduleLoader);
  const ctx: ServiceContext = { repos, engine, moduleLoader, bus, userId: 'tester' };
  return { repos, bus, ctx, close };
}

function writeEchoScript(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'en18031-expand-'));
  const file = path.join(dir, 'echo.sh');
  fs.writeFileSync(
    file,
    `#!/bin/sh
name="default"
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift;;
    *) shift;;
  esac
done
echo "ran:$name"
exit 0
`,
    { mode: 0o755 },
  );
  return file;
}

async function waitForTerminal(repos: ServiceContext['repos'], runId: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = repos.projects.getRun(runId);
    if (run && ['success', 'fail', 'partial', 'cancelled'].includes(run.status)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`run ${runId} did not finish in time`);
}

interface Setup {
  orch: OrchestratorService;
  projectId: string;
  repos: ServiceContext['repos'];
  logs: string[];
  close: () => void;
}

function setup(
  stepsFactory: (toolId: string) => TemplateStep[],
  variables: Record<string, unknown>,
): Setup {
  const { repos, bus, ctx, close } = makeContext();
  const logs: string[] = [];
  bus.on('run:logLine', (p: { line?: string }) => p.line && logs.push(p.line));
  const tool = repos.tools.create({
    name: 'echo 工具',
    type: 'custom',
    interactionMode: 'cmd',
    version: '1.0.0',
    category: 'other',
    path: writeEchoScript(),
    commands: [],
  });
  const steps = stepsFactory(tool.id);
  const template = repos.templates.create({
    name: '展开测试模板',
    workspaceId: 'default',
    variables: [],
    concurrencyLimit: 4,
    steps,
    toolRefs: [],
    createdBy: 'tester',
  });
  const project = repos.projects.create({
    name: '展开测试项目',
    templateId: template.id,
    templateVersionSnapshot: template.revision,
    standardVersion: 'EN18031',
    targetComplianceLevel: 'L1',
    variables,
    createdBy: 'tester',
  });
  return { orch: new OrchestratorService(ctx), projectId: project.id, repos, logs, close };
}

describe('expandMode 编排器集成（startRun 全链路）', () => {
  it('for_each_json：变量数组展开为 N 个实例，参数预渲染并成功执行', async () => {
    const s = setup(
      (toolId) => [
        {
          stepId: 'probe',
          title: '逐目标探测',
          toolId,
          toolVersion: '1.0.0',
          params: { name: '{{index}}-{{item}}' },
          dependsOn: [],
          onFailure: 'continue',
          position: 0,
          expandMode: 'for_each_json',
          expandSource: 'targets',
        },
      ],
      { targets: ['10.0.0.1', '10.0.0.2'] },
    );
    try {
      const run = await s.orch.startRun(s.projectId);
      await waitForTerminal(s.repos, run.id);

      const srs = s.repos.projects.listStepRuns(run.id);
      const probeRuns = srs.filter((x) => x.stepId.startsWith('probe#'));
      expect(probeRuns.map((x) => x.stepId).sort()).toEqual(['probe#1', 'probe#2']);
      expect(probeRuns.every((x) => x.status === 'success')).toBe(true);

      // 展开时已把参数渲染进快照（后续调度直接使用）
      const snap1 = probeRuns.find((x) => x.stepId === 'probe#1')!.stepSnapshot as TemplateStep;
      expect(snap1.params).toEqual({ name: '0-10.0.0.1' });

      expect(s.logs.some((l) => l.includes('[展开]') && l.includes('2 个实例'))).toBe(true);
    } finally {
      s.close();
    }
  });

  it('cartesian：两维度乘积展开为 4 个实例', async () => {
    const s = setup(
      (toolId) => [
        {
          stepId: 'pair',
          title: '组合扫描',
          toolId,
          toolVersion: '1.0.0',
          params: { name: '{{item.devices}}@{{item.channels}}' },
          dependsOn: [],
          onFailure: 'continue',
          position: 0,
          expandMode: 'cartesian',
          expandDims: ['devices', 'channels'],
        },
      ],
      { devices: ['D1', 'D2'], channels: ['ch37', 'ch38'] },
    );
    try {
      const run = await s.orch.startRun(s.projectId);
      await waitForTerminal(s.repos, run.id);
      const srs = s.repos.projects.listStepRuns(run.id);
      expect(srs).toHaveLength(4);
      expect(srs.every((x) => x.status === 'success')).toBe(true);
      const names = srs.map((x) => ((x.stepSnapshot as TemplateStep).params as { name: string }).name).sort();
      expect(names).toEqual(['D1@ch37', 'D1@ch38', 'D2@ch37', 'D2@ch38']);
    } finally {
      s.close();
    }
  });
});
