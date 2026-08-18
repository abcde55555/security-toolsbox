import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, pagingFromQuery, parseBody } from './helpers.js';
import { customToolCreateSchema, customToolUpdateSchema } from '@en18031/shared';
import { Errors } from '../services/errors.js';

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // ---- tool categories ----
  app.get('/api/tool-categories', { preHandler: requireRole('auditor') }, async (_req, reply) => {
    try {
      ok(reply, getServices().repos.categories.list());
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/tool-categories', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const b = (req.body ?? {}) as { key?: string; label?: string };
      if (!b.label?.trim()) throw Errors.validation('分类名称必填');
      const cat = getServices().repos.categories.create({ key: b.key ?? b.label, label: b.label });
      ok(reply, cat);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/tool-categories/:key', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { key } = req.params as { key: string };
      const b = (req.body ?? {}) as { label?: string };
      const cat = getServices().repos.categories.update(key, { label: b.label });
      if (!cat) throw Errors.notFound('分类', key);
      ok(reply, cat);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/tool-categories/:key', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { key } = req.params as { key: string };
      const result = getServices().repos.categories.delete(key);
      ok(reply, result);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/tool-categories/:key/reorder', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { key } = req.params as { key: string };
      const { dir } = (req.body ?? {}) as { dir?: -1 | 1 };
      const d = dir === 1 ? 1 : -1;
      ok(reply, getServices().repos.categories.reorder(key, d));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/tools', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const services = getServices();
      const q = req.query as Record<string, string>;
      const { page, pageSize } = pagingFromQuery(q);
      const result = services.tools.list({
        keyword: q.keyword,
        type: q.type,
        interactionMode: q.interactionMode,
        category: q.category,
        healthStatus: q.healthStatus,
        tag: q.tag,
        page,
        pageSize,
      });
      ok(reply, result.items, {
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
      });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/tools/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().tools.get(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/tools', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const body = parseBody(customToolCreateSchema, req.body);
      const tool = getServices().tools.create(body as never);
      ok(reply, tool);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/tools/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = parseBody(customToolUpdateSchema, req.body);
      const { revision, ...patch } = body as { revision?: number } & Record<string, unknown>;
      const tool = getServices().tools.update(id, patch as never, revision);
      ok(reply, tool);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/tools/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      getServices().tools.delete(id);
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/tools/:id/health-check', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const status = await getServices().tools.runHealthCheck(id);
      ok(reply, { id, healthStatus: status });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/tools/:id/references', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().tools.references(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  // Test-run a single command (from the command editor) without persisting it.
  // Body: { commandTemplate, params, timeoutMs, toolId? }. Substitutes params
  // into the template, executes, and returns stdout/stderr/exitCode plus which
  // mapping rules for the tool (if saved) would match the output.
  app.post('/api/test-command', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const services = getServices();
      const b = (req.body ?? {}) as {
        commandTemplate?: string;
        params?: Record<string, unknown>;
        timeoutMs?: number;
        toolId?: string;
      };
      const template = (b.commandTemplate ?? '').trim();
      if (!template) throw Errors.validation('commandTemplate 必填');

      const params = b.params ?? {};
      let fullCommand = template;
      const missing: string[] = [];
      fullCommand = fullCommand.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_m, key) => {
        const v = params[key];
        if (v === undefined || v === null || v === '') {
          missing.push(key);
          return '';
        }
        return String(v);
      });
      if (missing.length > 0) {
        throw Errors.validation(`缺少参数: ${missing.join(', ')}`);
      }

      const { CommandExecutor } = await import('../engine/commandExecutor.js');
      const executor = new CommandExecutor();
      const result = await executor.runCommand(fullCommand, {
        timeoutMs: b.timeoutMs ?? 30000,
      });

      const output = `${result.stdout}\n${result.stderr}`;
      let matched: Array<{ clauseId: string; pattern: string; matcherType: string; onMatch: string }> = [];
      if (b.toolId) {
        const rules = services.repos.clauses.listMappingRules(b.toolId);
        matched = rules
          .filter((r) => {
            try {
              return r.matcherType === 'regex'
                ? new RegExp(r.pattern, 'm').test(output)
                : output.includes(r.pattern);
            } catch {
              return false;
            }
          })
          .map((r) => ({
            clauseId: r.clauseId,
            pattern: r.pattern,
            matcherType: r.matcherType,
            onMatch: r.onMatch,
          }));
      }

      ok(reply, {
        command: fullCommand,
        exitCode: result.exitCode,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        matchedRules: matched,
      });
    } catch (e) {
      handleError(reply, e);
    }
  });
}
