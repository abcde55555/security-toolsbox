import type { Tool, HealthStatus, ModuleConfig } from '@en18031/shared';
import { moduleConfigSchema, toolCommandsSchema } from '@en18031/shared';
import type { ZodError } from 'zod';
import type { ServiceContext } from './context.js';
import { Errors } from './errors.js';
import { CommandExecutor } from '../engine/commandExecutor.js';
import { redactEnvVars } from './redact.js';

function redactTool(t: Tool): Tool {
  if (!t.envVars) return t;
  return { ...t, envVars: redactEnvVars(t.envVars) };
}

function zodToValidation(err: ZodError): never {
  const msg = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw Errors.validation(msg || '参数校验失败', err.issues);
}

function validateCommands(commands: unknown): void {
  if (commands === undefined) return;
  const parsed = toolCommandsSchema.safeParse(commands);
  if (!parsed.success) zodToValidation(parsed.error);
}

export class ToolRegistryService {
  constructor(private ctx: ServiceContext) {}

  list(query: Parameters<ServiceContext['repos']['tools']['list']>[0]) {
    return this.ctx.repos.tools.list(query);
  }

  get(id: string): Tool {
    const tool = this.ctx.repos.tools.getById(id);
    if (!tool) throw Errors.notFound('工具', id);
    return tool;
  }

  create(input: Partial<Tool> & { name: string; type: Tool['type']; interactionMode: Tool['interactionMode']; version: string; category: Tool['category'] }): Tool {
    if (input.builtin) {
      throw Errors.forbidden('内置工具不可通过此接口创建');
    }
    if (input.type === 'custom' && !input.path && (!input.commands || input.commands.length === 0)) {
      throw Errors.validation('命令手册工具至少需要一条命令，或提供可执行 path');
    }
    validateCommands(input.commands);
    const tool = this.ctx.repos.tools.create({ ...input, workspaceId: 'default' });
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'tool.create',
      entityType: 'tool',
      entityId: tool.id,
      after: redactTool(tool),
    });
    this.runHealthCheck(tool.id).catch(() => {});
    return tool;
  }

  registerBuiltinModule(config: ModuleConfig): Tool {
    const parsed = moduleConfigSchema.parse(config);
    const existing = this.ctx.repos.tools.getById(parsed.id, true);
    const data = {
      id: parsed.id,
      name: parsed.name,
      type: parsed.type,
      interactionMode: parsed.interactionMode,
      version: parsed.version,
      sdkVersion: parsed.sdkVersion,
      author: parsed.author,
      description: parsed.description,
      tags: parsed.tags,
      category: parsed.category,
      path: parsed.path,
      envVars: parsed.envVars,
      healthCheck: parsed.healthCheck,
      formFields: parsed.formFields,
      clauses: parsed.clauses,
      builtin: true,
    };
    const tool = existing
      ? this.ctx.repos.tools.update(parsed.id, data)!
      : this.ctx.repos.tools.create(data);
    this.runHealthCheck(tool.id).catch(() => {});
    return tool;
  }

  update(id: string, patch: Partial<Tool>, expectedRevision?: number): Tool {
    const before = this.get(id);
    if (before.builtin) {
      throw Errors.forbidden('内置工具为只读，不可修改');
    }
    validateCommands(patch.commands);
    const updated = this.ctx.repos.tools.update(id, patch, expectedRevision);
    if (!updated) throw Errors.notFound('工具', id);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'tool.update',
      entityType: 'tool',
      entityId: id,
      before: redactTool(before),
      after: redactTool(updated),
    });
    return updated;
  }

  delete(id: string): void {
    const tool = this.get(id);
    if (tool.builtin) {
      throw Errors.forbidden('内置工具为只读，不可删除');
    }
    const refs = this.ctx.repos.tools.countReferences(id);
    if (refs > 0) {
      throw Errors.toolReferenced(`工具被 ${refs} 个模板引用，不可删除，可改为禁用`);
    }
    this.ctx.repos.tools.softDelete(id);
    this.ctx.repos.audit.insert({
      userId: this.ctx.userId,
      action: 'tool.delete',
      entityType: 'tool',
      entityId: id,
      before: redactTool(tool),
    });
  }

  references(id: string) {
    this.get(id);
    const templates = this.ctx.repos.templates.list();
    return templates.filter((t) => t.toolRefs.some((r) => r.toolId === id));
  }

  async runHealthCheck(id: string): Promise<HealthStatus> {
    const tool = this.ctx.repos.tools.getById(id);
    if (!tool || !tool.healthCheck?.command) {
      this.ctx.repos.tools.setHealth(id, 'unknown', '未配置健康检查');
      return 'unknown';
    }
    const executor = new CommandExecutor();
    try {
      const result = await executor.runCommand(tool.healthCheck.command, {
        timeoutMs: tool.healthCheck.timeoutMs ?? 5000,
      });
      if (result.status === 'timeout') {
        this.ctx.repos.tools.setHealth(id, 'yellow', '版本校验超时');
        return 'yellow';
      }
      if (result.exitCode !== 0) {
        this.ctx.repos.tools.setHealth(id, 'red', result.stderr || result.stdout || '执行失败');
        return 'red';
      }
      const output = (result.stdout + result.stderr).trim();
      const versionMatch = output.match(/\d+\.\d+[.\d]*/);
      if (tool.version && versionMatch) {
        const matches = versionMatch[0] === tool.version || output.includes(tool.version);
        const status: HealthStatus = matches ? 'green' : 'yellow';
        this.ctx.repos.tools.setHealth(id, status, output.slice(0, 500));
        return status;
      }
      this.ctx.repos.tools.setHealth(id, 'green', output.slice(0, 500));
      return 'green';
    } catch (e) {
      this.ctx.repos.tools.setHealth(id, 'red', (e as Error).message);
      return 'red';
    } finally {
      this.ctx.bus.emit('tool:health', { toolId: id });
    }
  }

  recalculateReferenceCounts(): void {
    const tools = this.ctx.repos.tools.list({ includeDeleted: true, pageSize: 500 }).items;
    for (const tool of tools) {
      const count = this.ctx.repos.tools.countReferences(tool.id);
      if (count !== tool.referenceCount) {
        this.ctx.repos.tools.incrementRefCount(tool.id, count - tool.referenceCount);
      }
    }
  }
}
