import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, pagingFromQuery, parseBody } from './helpers.js';
import { commandRunAttachSchema } from '@en18031/shared';

export async function commandRunRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/tools/:id/commands/:commandId/run',
    { preHandler: requireRole('auditor') },
    async (req, reply) => {
      try {
        const { id, commandId } = req.params as { id: string; commandId: string };
        const { runId } = getServices().commandRunner.start(id, commandId, req.body);
        ok(reply, { runId });
      } catch (e) {
        handleError(reply, e);
      }
    },
  );

  app.post(
    '/api/command-runs/:runId/cancel',
    { preHandler: requireRole('auditor') },
    async (req, reply) => {
      try {
        const { runId } = req.params as { runId: string };
        const result = getServices().commandRunner.cancel(runId);
        ok(reply, { runId, cancelRequested: result.cancelled });
      } catch (e) {
        handleError(reply, e);
      }
    },
  );

  app.get(
    '/api/command-runs',
    { preHandler: requireRole('auditor') },
    async (req, reply) => {
      try {
        const q = req.query as Record<string, string>;
        const { page, pageSize } = pagingFromQuery(q);
        const result = getServices().commandRunner.list({
          toolId: q.toolId,
          projectId: q.projectId,
          status: q.status,
          keyword: q.keyword,
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
    },
  );

  app.get(
    '/api/command-runs/:runId',
    { preHandler: requireRole('auditor') },
    async (req, reply) => {
      try {
        const { runId } = req.params as { runId: string };
        ok(reply, getServices().commandRunner.get(runId));
      } catch (e) {
        handleError(reply, e);
      }
    },
  );

  app.post(
    '/api/command-runs/:runId/attach',
    { preHandler: requireRole('auditor') },
    async (req, reply) => {
      try {
        const { runId } = req.params as { runId: string };
        const body = parseBody(commandRunAttachSchema, req.body);
        ok(reply, getServices().commandRunner.attachToProject(runId, body));
      } catch (e) {
        handleError(reply, e);
      }
    },
  );
}
