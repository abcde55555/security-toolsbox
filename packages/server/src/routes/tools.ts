import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, pagingFromQuery, parseBody } from './helpers.js';
import { customToolCreateSchema, customToolUpdateSchema } from '@en18031/shared';

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
      if (!b.label?.trim()) throw Object.assign(new Error('分类名称必填'), { statusCode: 400, code: 9003 });
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
      if (!cat) throw Object.assign(new Error('分类不存在'), { statusCode: 404, code: 9004 });
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
}
