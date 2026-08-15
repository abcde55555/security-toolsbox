import type { Database } from 'better-sqlite3';
import type { AuditLog } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { toJson } from './json.js';

export interface AuditLogQuery {
  workspaceId?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  keyword?: string;
  since?: string;
  until?: string;
  page?: number;
  pageSize?: number;
}

export class AuditRepository {
  constructor(private db: Database) {}

  insert(input: {
    workspaceId?: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
    userAgent?: string;
  }): AuditLog {
    const log: AuditLog = {
      id: uuid(),
      workspaceId: input.workspaceId ?? 'default',
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, workspaceId, userId, action, entityType, entityId, before, after, ip, userAgent, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        log.id,
        log.workspaceId,
        log.userId,
        log.action,
        log.entityType,
        log.entityId,
        input.before !== undefined ? toJson(input.before) : null,
        input.after !== undefined ? toJson(input.after) : null,
        log.ip ?? null,
        log.userAgent ?? null,
        log.createdAt,
      );
    return log;
  }

  query(q: AuditLogQuery = {}): { items: AuditLog[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.workspaceId) {
      conditions.push('workspaceId = ?');
      params.push(q.workspaceId);
    }
    if (q.userId) {
      conditions.push('userId = ?');
      params.push(q.userId);
    }
    if (q.action) {
      conditions.push('action = ?');
      params.push(q.action);
    }
    if (q.entityType) {
      conditions.push('entityType = ?');
      params.push(q.entityType);
    }
    if (q.entityId) {
      conditions.push('entityId = ?');
      params.push(q.entityId);
    }
    if (q.since) {
      conditions.push('createdAt >= ?');
      params.push(q.since);
    }
    if (q.until) {
      conditions.push('createdAt <= ?');
      params.push(q.until);
    }
    if (q.keyword) {
      conditions.push('(action LIKE ? OR entityType LIKE ? OR entityId LIKE ? OR after LIKE ? OR before LIKE ?)');
      const kw = `%${q.keyword}%`;
      for (let i = 0; i < 5; i++) params.push(kw);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) as c FROM audit_logs ${where}`).get(...params) as { c: number }).c;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 20));
    const items = this.db
      .prepare(
        `SELECT * FROM audit_logs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return {
      items: items.map((r) => this.mapRow(r)),
      total,
    };
  }

  private mapRow(r: Record<string, unknown>): AuditLog {
    return {
      id: String(r.id),
      workspaceId: String(r.workspaceId),
      userId: String(r.userId),
      action: String(r.action),
      entityType: String(r.entityType),
      entityId: String(r.entityId),
      before: r.before ? JSON.parse(String(r.before)) : undefined,
      after: r.after ? JSON.parse(String(r.after)) : undefined,
      ip: r.ip ? String(r.ip) : undefined,
      userAgent: r.userAgent ? String(r.userAgent) : undefined,
      createdAt: String(r.createdAt),
    };
  }
}
