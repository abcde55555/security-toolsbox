import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', { preHandler: requireRole('auditor') }, async (_req, reply) => {
    try {
      ok(reply, getServices().templates.list());
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/templates/:id', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().templates.get(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/templates', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>;
      const tpl = getServices().templates.create(body as never);
      ok(reply, tpl);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/templates/:id', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const tpl = getServices().templates.update(id, req.body as never);
      ok(reply, tpl);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/templates/:id', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      getServices().templates.delete(id);
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/templates/:id/clone', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { newName, inheritParent } = req.body as { newName: string; inheritParent?: boolean };
      const tpl = getServices().templates.clone(id, newName, inheritParent);
      ok(reply, tpl);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/templates/:id/confirm-upgrade', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { toolId, lock } = req.body as { toolId: string; lock: boolean };
      ok(reply, getServices().templates.confirmUpgrade(id, toolId, lock));
    } catch (e) {
      handleError(reply, e);
    }
  });
}
