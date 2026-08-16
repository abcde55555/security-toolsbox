import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInMemoryRepositories } from '../repositories/index.js';
import { ExecutionEngine } from '../engine/executionEngine.js';
import { ModuleLoader } from '../engine/moduleLoader.js';
import { OrchestratorService } from '../services/orchestratorService.js';
import type { ServiceContext } from '../services/context.js';
import type { TemplateStep } from '@en18031/shared';
import './helpers.js';

function makeContext() {
  const { repos, close } = createInMemoryRepositories();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const moduleLoader = new ModuleLoader();
  const engine = new ExecutionEngine(moduleLoader);
  const ctx: ServiceContext = { repos, engine, moduleLoader, bus, userId: 'tester' };
  return { repos, bus, ctx, close };
}

function writeFlakyScript(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'en18031-retry-'));
  const file = path.join(dir, 'flaky.sh');
  fs.writeFileSync(
    file,
    `#!/bin/sh
name="default"
code=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift;;
    --code) code="$2"; shift;;
  esac
  shift
done
if [ -n "$code" ]; then exit "$code"; fi
marker="${dir}/$name.marker"
if [ -f "$marker" ]; then rm -f "$marker"; exit 0; else touch "$marker"; exit 1; fi
`,
    { mode: 0o755 },
  );
  return file;
}

async function waitForTerminal(
  repos: ServiceContext['repos'],
  runId: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = repos.projects.getRun(runId);
    if (run && ['success', 'fail', 'partial', 'cancelled'].includes(run.status)) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`run ${runId} did not finish in time`);
}

describe('OrchestratorService.retryStep', () => {
  it('resumes a finished run: reruns the target, resets downstream, recomputes success', async () => {
    const { repos, ctx } = makeContext();
    const script = writeFlakyScript();

    const tool = repos.tools.create({
      name: 'flaky 脚本',
      type: 'custom',
      interactionMode: 'cmd',
      version: '1.0.0',
      category: 'other',
      path: script,
      commands: [],
    });

    const step1: TemplateStep = {
      stepId: 'step-1',
      title: '不稳定步骤',
      toolId: tool.id,
      toolVersion: '1.0.0',
      params: { name: 'a' },
      dependsOn: [],
      onFailure: 'continue',
      position: 0,
    };
    const step2: TemplateStep = {
      stepId: 'step-2',
      title: '下游步骤',
      toolId: tool.id,
      toolVersion: '1.0.0',
      params: { name: 'b', code: '0' },
      dependsOn: ['step-1'],
      onFailure: 'continue',
      position: 1,
    };

    const template = repos.templates.create({
      name: '重试测试模板',
      workspaceId: 'default',
      variables: [],
      concurrencyLimit: 1,
      steps: [step1, step2],
      toolRefs: [],
      createdBy: 'tester',
    });
    const project = repos.projects.create({
      name: '重试测试项目',
      templateId: template.id,
      templateVersionSnapshot: template.revision,
      standardVersion: 'EN18031',
      targetComplianceLevel: 'L1',
      variables: {},
      createdBy: 'tester',
    });

    const orch = new OrchestratorService(ctx);
    const run = await orch.startRun(project.id);
    await waitForTerminal(repos, run.id);

    const afterFirst = repos.projects.getRun(run.id)!;
    expect(afterFirst.status).toBe('fail');
    const firstStep1 = repos.projects
      .listStepRuns(run.id)
      .filter((s) => s.stepId === 'step-1')
      .at(-1)!;
    expect(firstStep1.status).toBe('fail');
    const firstStep2 = repos.projects
      .listStepRuns(run.id)
      .filter((s) => s.stepId === 'step-2')
      .at(-1)!;
    expect(firstStep2.status).toBe('skipped');

    await orch.retryStep(project.id, run.id, firstStep1.id);
    await waitForTerminal(repos, run.id);

    const final = repos.projects.getRun(run.id)!;
    expect(final.status).toBe('success');

    const allStep1 = repos.projects.listStepRuns(run.id).filter((s) => s.stepId === 'step-1');
    expect(allStep1.length).toBe(2);
    expect(allStep1[1].retryOf).toBe(firstStep1.id);
    expect(allStep1[1].status).toBe('success');

    const finalStep2 = repos.projects
      .listStepRuns(run.id)
      .filter((s) => s.stepId === 'step-2')
      .at(-1)!;
    expect(finalStep2.status).toBe('success');
  });
});
