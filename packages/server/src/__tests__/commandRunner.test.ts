import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createInMemoryRepositories } from '../repositories/index.js';
import { ExecutionEngine } from '../engine/executionEngine.js';
import { ModuleLoader } from '../engine/moduleLoader.js';
import { CommandRunnerService } from '../services/commandRunnerService.js';
import { ToolRegistryService } from '../services/toolRegistryService.js';
import { AppError } from '../services/errors.js';
import { seedCommandTools } from '../db/commandToolSeed.js';
import type { ServiceContext } from '../services/context.js';
import type { ToolCommand } from '@en18031/shared';
import './helpers.js';

function makeContext() {
  const { repos, close } = createInMemoryRepositories();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const moduleLoader = new ModuleLoader();
  const engine = new ExecutionEngine(moduleLoader);
  const ctx: ServiceContext = { repos, engine, moduleLoader, bus, userId: 'tester' };
  return { repos, bus, engine, ctx, close };
}

function makeTool(repos: ServiceContext['repos'], commands: ToolCommand[]) {
  return repos.tools.create({
    name: '测试工具',
    type: 'custom',
    interactionMode: 'cmd',
    version: '1.0.0',
    category: 'other',
    commands,
  });
}

describe('CommandRunnerService', () => {
  it('runs an echo command to success and emits bus events with runId', async () => {
    const { repos, bus, ctx, close } = makeContext();
    const tool = makeTool(repos, [
      {
        id: 'hello',
        name: 'hello',
        commandTemplate: 'echo hello-{{who}}',
        params: [{ id: 'who', label: 'who', type: 'text', value: 'world' }],
      },
    ]);

    const statusEvents: unknown[] = [];
    const logEvents: unknown[] = [];
    bus.on('run:status', (p) => statusEvents.push(p));
    bus.on('run:logLine', (p) => logEvents.push(p));

    const runner = new CommandRunnerService(ctx);
    const { runId } = runner.start(tool.id, 'hello', {});
    expect(runId).toBeTruthy();

    const finished = await runner.waitFor(runId);
    expect(finished.status).toBe('success');
    expect(finished.exitCode).toBe(0);
    expect(finished.stdoutFileRef).toBeTruthy();

    const detail = runner.get(runId);
    expect(detail.stdout).toContain('hello-world');

    expect(statusEvents.every((e: any) => e.runId === runId)).toBe(true);
    expect(logEvents.length).toBeGreaterThan(0);
    expect(logEvents.every((e: any) => e.runId === runId)).toBe(true);
    close();
  });

  it('rejects missing required params with VALIDATION_FAILED (9003)', () => {
    const { repos, ctx, close } = makeContext();
    const tool = makeTool(repos, [
      {
        id: 'ping',
        name: 'ping',
        commandTemplate: 'ping {{target}}',
        params: [{ id: 'target', label: 'target', type: 'text', required: true }],
      },
    ]);
    const runner = new CommandRunnerService(ctx);
    try {
      runner.start(tool.id, 'ping', { params: {} });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(9003);
    }
    close();
  });

  it('accepts a non-required empty param by omitting the placeholder', async () => {
    const { repos, ctx, close } = makeContext();
    const tool = makeTool(repos, [
      {
        id: 'x',
        name: 'x',
        commandTemplate: 'echo {{name}}',
        params: [{ id: 'name', label: 'name', type: 'text' }],
      },
    ]);
    const runner = new CommandRunnerService(ctx);
    const { runId } = runner.start(tool.id, 'x', { params: {} });
    const finished = await runner.waitFor(runId);
    expect(finished.status).toBe('success');
    expect(finished.resolvedCommand).not.toContain('{{name}}');
    close();
  });

  it('marks a failed command exit as fail', async () => {
    const { repos, ctx, close } = makeContext();
    const tool = makeTool(repos, [
      {
        id: 'fail',
        name: 'fail',
        commandTemplate: 'sh -c "echo boom >&2; exit 3"',
        params: [],
      },
    ]);
    const runner = new CommandRunnerService(ctx);
    const { runId } = runner.start(tool.id, 'fail', {});
    const finished = await runner.waitFor(runId);
    expect(finished.status).toBe('fail');
    expect(finished.exitCode).toBe(3);
    const detail = runner.get(runId);
    expect(detail.stderr).toContain('boom');
    close();
  });

  it('refuses to run a command whose platforms list excludes the current OS', () => {
    const { repos, ctx, close } = makeContext();
    const other = process.platform === 'win32' ? 'linux' : 'win32';
    const tool = makeTool(repos, [
      {
        id: 'linuxonly',
        name: 'linuxonly',
        commandTemplate: 'echo hi',
        params: [],
        platforms: [other as 'linux' | 'win32'],
      },
    ]);
    const runner = new CommandRunnerService(ctx);
    try {
      runner.start(tool.id, 'linuxonly', {});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(9003);
      expect((e as AppError).message).toMatch(/仅支持/);
    }
    close();
  });

  it('lists runs filtered by projectId after attach', async () => {
    const { repos, ctx, close } = makeContext();
    const tool = makeTool(repos, [
      {
        id: 'echo',
        name: 'echo',
        commandTemplate: 'echo {{msg}}',
        params: [{ id: 'msg', label: 'msg', type: 'text', value: 'hi' }],
      },
    ]);
    const runner = new CommandRunnerService(ctx);
    const { runId } = runner.start(tool.id, 'echo', {});
    await runner.waitFor(runId);
    runner.attachToProject(runId, { projectId: 'proj-1', note: '证据' });
    const listed = runner.list({ projectId: 'proj-1' });
    expect(listed.total).toBe(1);
    expect(listed.items[0].projectId).toBe('proj-1');
    close();
  });
});

describe('builtin guard + command seed', () => {
  let env: ReturnType<typeof makeContext>;
  beforeEach(() => {
    env = makeContext();
  });

  it('forbids update/delete on builtin tools (9002) while seed works', async () => {
    const { repos, ctx, close } = env;
    repos.tools.create({
      id: 'builtin-x',
      name: 'b',
      type: 'module',
      interactionMode: 'form',
      version: '1.0.0',
      category: 'other',
      builtin: true,
    });
    const tools = new ToolRegistryService(ctx);
    expect(() => tools.update('builtin-x', { name: 'x' })).toThrow(AppError);
    try {
      tools.update('builtin-x', { name: 'x' });
    } catch (e) {
      expect((e as AppError).code).toBe(9002);
    }
    expect(() => tools.delete('builtin-x')).toThrow();

    await seedCommandTools(repos);
    const net = repos.tools.getById('demo-net-connectivity')!;
    expect(net).toBeTruthy();
    expect(net.builtin).toBe(false);
    expect(net.commands?.length).toBe(4);
    // create-only: second seed does not throw or duplicate
    await seedCommandTools(repos);
    close();
  });
});
