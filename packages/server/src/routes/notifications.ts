import type { FastifyInstance } from 'fastify';
import type { NotificationStatus } from '@en18031/shared';
import { getServices } from '../services/index.js';
import { handleError, ok, requireRole } from './helpers.js';

const VALID_STATUSES: NotificationStatus[] = ['unread', 'read', 'accepted', 'dismissed', 'snoozed'];

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  /** List notifications; ?status=unread|read|accepted|dismissed|snoozed, ?type=, ?limit=. */
  app.get('/api/notifications', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { status?: NotificationStatus; type?: string; limit?: string };
      const services = getServices();
      const limit = q.limit ? Number(q.limit) : undefined;
      const { items, total } = services.repos.notifications.list({
        status: q.status,
        type: q.type as never,
        limit,
      });
      ok(reply, items, { total, page: 1, pageSize: items.length || (limit ?? 50), totalPages: 1 });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/notifications/unread-count', { preHandler: requireRole('auditor') }, async (_req, reply) => {
    try {
      ok(reply, { count: getServices().repos.notifications.unreadCount() });
    } catch (e) {
      handleError(reply, e);
    }
  });

  /** Transition a notification's status: read / accepted / dismissed / snoozed. */
  app.post('/api/notifications/:id/status', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { status?: NotificationStatus; snoozeHours?: number };
      if (!body.status || !VALID_STATUSES.includes(body.status)) {
        throw Object.assign(new Error(`非法通知状态：${String(body.status)}`), { code: 9003, httpStatus: 400 });
      }
      const services = getServices();
      const updated = services.repos.notifications.setStatus(id, body.status, {
        snoozedUntilMs: body.snoozeHours ? body.snoozeHours * 3600_000 : undefined,
      });
      if (!updated) throw Object.assign(new Error(`通知 '${id}' 不存在`), { code: 9004, httpStatus: 404 });
      services.repos.audit.insert({
        userId: services.authz.getCurrentUser().id,
        action: 'notification.status',
        entityType: 'notification',
        entityId: id,
        after: { status: body.status },
      });
      ok(reply, updated);
    } catch (e) {
      handleError(reply, e);
    }
  });
}
