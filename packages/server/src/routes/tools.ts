import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, pagingFromQuery } from './helpers.js';

export async function toolRoutes(app: FastifyInstance): Promise<void> {
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
      const body = req.body as Record<string, unknown>;
      const tool = getServices().tools.create(body as never);
      ok(reply, tool);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/tools/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const tool = getServices().tools.update(id, req.body as never);
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
