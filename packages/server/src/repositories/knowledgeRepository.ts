import type { Database } from 'better-sqlite3';
import type { KnowledgeNote } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export type KnowledgeSourceType = KnowledgeNote['sourceType'];

export interface CreateNoteInput {
  title: string;
  content: string;
  tags?: string[];
  attachments?: string[];
  sourceType?: KnowledgeSourceType;
  sourceUrl?: string;
  author: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  tags?: string[];
  attachments?: string[];
  sourceType?: KnowledgeSourceType;
  sourceUrl?: string | null;
}

export class KnowledgeRepository {
  constructor(private db: Database) {}

  create(input: CreateNoteInput): KnowledgeNote {
    const id = uuid();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO knowledge_notes
          (id, workspaceId, title, content, tags, attachments, sourceType, sourceUrl, author, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        'default',
        input.title,
        input.content,
        toJson(input.tags ?? []),
        toJson(input.attachments ?? []),
        input.sourceType ?? 'manual',
        input.sourceUrl ?? null,
        input.author,
        now,
        now,
      );
    return this.getById(id)!;
  }

  getById(id: string): KnowledgeNote | null {
    const row = this.db
      .prepare('SELECT * FROM knowledge_notes WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapNote(row) : null;
  }

  /** Keyword search across title/content/tags; empty keyword returns the latest notes first. */
  list(q: { keyword?: string; limit?: number } = {}): { items: KnowledgeNote[]; total: number } {
    const limit = Math.min(Math.max(1, q.limit ?? 50), 200);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.keyword && q.keyword.trim()) {
      const kw = `%${q.keyword.trim()}%`;
      where.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)');
      params.push(kw, kw, kw);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM knowledge_notes ${whereSql}`).get(...params) as {
        n: number;
      }
    ).n;
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_notes ${whereSql} ORDER BY updatedAt DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];
    return { items: rows.map((r) => this.mapNote(r)), total };
  }

  update(id: string, patch: UpdateNoteInput): KnowledgeNote | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const next = {
      title: patch.title ?? existing.title,
      content: patch.content ?? existing.content,
      tags: patch.tags ?? existing.tags,
      attachments: patch.attachments ?? existing.attachments,
      sourceType: patch.sourceType ?? existing.sourceType,
      sourceUrl:
        patch.sourceUrl === undefined ? existing.sourceUrl : (patch.sourceUrl ?? undefined),
    };
    this.db
      .prepare(
        `UPDATE knowledge_notes
         SET title=?, content=?, tags=?, attachments=?, sourceType=?, sourceUrl=?, updatedAt=?
         WHERE id=?`,
      )
      .run(
        next.title,
        next.content,
        toJson(next.tags),
        toJson(next.attachments),
        next.sourceType,
        next.sourceUrl ?? null,
        nowIso(),
        id,
      );
    return this.getById(id);
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM knowledge_notes WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private mapNote(r: Record<string, unknown>): KnowledgeNote {
    return {
      id: String(r.id),
      title: String(r.title),
      content: String(r.content),
      tags: parseJson<string[]>(r.tags, []),
      attachments: parseJson<string[]>(r.attachments, []),
      sourceType: r.sourceType as KnowledgeSourceType,
      sourceUrl: r.sourceUrl ? String(r.sourceUrl) : undefined,
      author: String(r.author),
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }
}
