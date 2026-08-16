import { describe, it, expect } from 'vitest';
import { createInMemoryRepositories } from '../repositories/index.js';
import { AppError } from '../services/errors.js';
import './helpers.js';

function isConflict(e: unknown): boolean {
  return e instanceof AppError && e.httpStatus === 409;
}

describe('optimistic concurrency control', () => {
  it('throws 409 when updating a tool with a stale revision', () => {
    const { repos } = createInMemoryRepositories();
    const tool = repos.tools.create({
      name: '锁测试工具',
      type: 'custom',
      interactionMode: 'cmd',
      version: '1.0.0',
      category: 'other',
      commands: [],
    });

    repos.tools.update(tool.id, { version: '1.0.1' }, tool.revision);
    const bumped = repos.tools.getById(tool.id)!;
    expect(bumped.revision).toBe(tool.revision + 1);

    expect(() => repos.tools.update(tool.id, { version: '1.0.2' }, tool.revision)).toThrow(
      /已被其他地方修改/,
    );
    expect(isConflict(throws(() => repos.tools.update(tool.id, { version: '1.0.2' }, tool.revision)))).toBe(true);

    const fresh = repos.tools.getById(tool.id)!;
    expect(fresh.version).toBe('1.0.1');
    expect(repos.tools.update(tool.id, { version: '1.0.2' }, fresh.revision)!.version).toBe('1.0.2');
  });

  it('throws 409 when updating a template with a stale revision and rolls back the transaction', () => {
    const { repos } = createInMemoryRepositories();
    const tpl = repos.templates.create({
      name: '锁测试模板',
      workspaceId: 'default',
      variables: [],
      concurrencyLimit: 1,
      steps: [],
      toolRefs: [],
      createdBy: 'tester',
    });

    repos.templates.update(tpl.id, { name: '改名一' }, tpl.revision);
    const bumped = repos.templates.getById(tpl.id)!;
    expect(bumped.revision).toBe(tpl.revision + 1);

    expect(() =>
      repos.templates.update(tpl.id, { name: '改名二', variables: [] }, tpl.revision),
    ).toThrow();

    const fresh = repos.templates.getById(tpl.id)!;
    expect(fresh.name).toBe('改名一');
    expect(repos.templates.update(tpl.id, { name: '改名三' }, fresh.revision)!.name).toBe('改名三');
  });

  it('allows updates without an expected revision (system/internal writes)', () => {
    const { repos } = createInMemoryRepositories();
    const tool = repos.tools.create({
      name: '无锁工具',
      type: 'custom',
      interactionMode: 'cmd',
      version: '1.0.0',
      category: 'other',
      commands: [],
    });
    expect(repos.tools.update(tool.id, { version: '2.0.0' })!.version).toBe('2.0.0');
  });
});

function throws(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}
