import type { Database } from 'better-sqlite3';
import type { Notification, NotificationStatus } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export type NotificationRecordType = Notification['type'];

export interface CreateNotificationInput {
  userId?: string;
  type: NotificationRecordType;
  title: string;
  message?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  sessionId?: string;
  projectId?: string;
  createdBy: string;
}

export class NotificationRepository {
  constructor(private db: Database) {}

  create(input: CreateNotificationInput): Notification {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO notifications
          (id, workspaceId, userId, type, title, message, reason, payload, sessionId, projectId,
           status, createdBy, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        'default',
        input.userId ?? 'local-admin',
        input.type,
        input.title,
        input.message ?? '',
        input.reason ?? null,
        toJson(input.payload ?? {}),
        input.sessionId ?? null,
        input.projectId ?? null,
        'unread',
        input.createdBy,
        nowIso(),
      );
    return this.getById(id)!;
  }

  getById(id: string): Notification | null {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapNotification(row) : null;
  }

  list(q: { status?: NotificationStatus; type?: NotificationRecordType; limit?: number } = {}): {
    items: Notification[];
    total: number;
  } {
    const limit = Math.min(Math.max(1, q.limit ?? 50), 200);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      where.push('status = ?');
      params.push(q.status);
    }
    if (q.type) {
      where.push('type = ?');
      params.push(q.type);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM notifications ${whereSql}`).get(...params) as {
        n: number;
      }
    ).n;
    const rows = this.db
      .prepare(`SELECT * FROM notifications ${whereSql} ORDER BY createdAt DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];
    return { items: rows.map((r) => this.mapNotification(r)), total };
  }

  unreadCount(): number {
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE status = 'unread'`).get() as {
        n: number;
      }
    ).n;
  }

  /** Status transitions; snooze stores an absolute wake-up timestamp. */
  setStatus(id: string, status: NotificationStatus, opts: { snoozedUntilMs?: number } = {}): Notification | null {
    const patch: Record<string, unknown> = {};
    if (status === 'read') patch.readAt = nowIso();
    if (status === 'snoozed') patch.snoozedUntil = new Date(Date.now() + (opts.snoozedUntilMs ?? 8 * 3600_000)).toISOString();
    if (status === 'accepted' || status === 'dismissed') patch.actedAt = nowIso();
    const sets = Object.keys(patch)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    const res = this.db
      .prepare(`UPDATE notifications SET status = @status${sets ? ', ' + sets : ''} WHERE id = @id`)
      .run({ id, status, ...patch });
    return res.changes > 0 ? this.getById(id) : null;
  }

  private mapNotification(r: Record<string, unknown>): Notification {
    return {
      id: String(r.id),
      userId: String(r.userId),
      type: r.type as NotificationRecordType,
      title: String(r.title),
      message: r.message ? String(r.message) : '',
      reason: r.reason ? String(r.reason) : undefined,
      payload: parseJson<Record<string, unknown>>(r.payload, {}),
      sessionId: r.sessionId ? String(r.sessionId) : undefined,
      projectId: r.projectId ? String(r.projectId) : undefined,
      status: r.status as NotificationStatus,
      readAt: r.readAt ? String(r.readAt) : undefined,
      snoozedUntil: r.snoozedUntil ? String(r.snoozedUntil) : undefined,
      actedAt: r.actedAt ? String(r.actedAt) : undefined,
      createdBy: String(r.createdBy),
      createdAt: String(r.createdAt),
    };
  }
}
