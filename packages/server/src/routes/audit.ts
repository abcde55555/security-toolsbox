import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError, pagingFromQuery } from './helpers.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit-logs', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as Record<string, string>;
      const { page, pageSize } = pagingFromQuery(q);
      const result = getServices().repos.audit.query({
        keyword: q.keyword,
        action: q.action,
        entityType: q.entityType,
        userId: q.userId,
        since: q.since,
        until: q.until,
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
}
