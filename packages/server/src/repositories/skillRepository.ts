import type { Database } from 'better-sqlite3';
import type { Skill } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export type SkillRecordStatus = Skill['status'];

export interface CreateSkillInput {
  skillKey: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  body: string;
  sourceNoteIds?: string[];
  sourceCaseIds?: string[];
  status?: SkillRecordStatus;
  author: string;
}

export class SkillRepository {
  constructor(private db: Database) {}

  /**
   * Create a skill. When another row already holds the same skillKey as `isCurrent`,
   * it is demoted (isCurrent=0) and the new row becomes the current version
   * with version = max(version)+1 — i.e. saving an improved skill supersedes,
   * never overwrites, history.
   */
  create(input: CreateSkillInput): Skill {
    const id = uuid();
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const prev = this.db
        .prepare('SELECT MAX(version) AS v FROM skills WHERE skillKey = ?')
        .get(input.skillKey) as { v: number | null };
      const nextVersion = (prev?.v ?? 0) + 1;
      if ((prev?.v ?? 0) > 0) {
        this.db
          .prepare('UPDATE skills SET isCurrent = 0, updatedAt = ? WHERE skillKey = ? AND isCurrent = 1')
          .run(now, input.skillKey);
      }
      this.db
        .prepare(
          `INSERT INTO skills
            (id, workspaceId, skillKey, title, frontmatter, body, sourceNoteIds, sourceCaseIds,
             version, isCurrent, status, author, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          'default',
          input.skillKey,
          input.title,
          toJson(input.frontmatter ?? {}),
          input.body,
          toJson(input.sourceNoteIds ?? []),
          toJson(input.sourceCaseIds ?? []),
          nextVersion,
          1,
          input.status ?? 'draft',
          input.author,
          now,
          now,
        );
    });
    tx();
    return this.getById(id)!;
  }

  getById(id: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapSkill(row) : null;
  }

  /** Current-version skills; optional keyword filter over key/title/body. */
  list(q: { keyword?: string; status?: SkillRecordStatus; onlyCurrent?: boolean; limit?: number } = {}): {
    items: Skill[];
    total: number;
  } {
    const limit = Math.min(Math.max(1, q.limit ?? 100), 200);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.onlyCurrent !== false) where.push('isCurrent = 1');
    if (q.status) {
      where.push('status = ?');
      params.push(q.status);
    }
    if (q.keyword && q.keyword.trim()) {
      const kw = `%${q.keyword.trim()}%`;
      where.push('(skillKey LIKE ? OR title LIKE ? OR body LIKE ?)');
      params.push(kw, kw, kw);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM skills ${whereSql}`).get(...params) as { n: number }
    ).n;
    const rows = this.db
      .prepare(`SELECT * FROM skills ${whereSql} ORDER BY updatedAt DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];
    return { items: rows.map((r) => this.mapSkill(r)), total };
  }

  /** Version history of one skillKey, newest first (including superseded rows). */
  listVersions(skillKey: string): Skill[] {
    const rows = this.db
      .prepare('SELECT * FROM skills WHERE skillKey = ? ORDER BY version DESC')
      .all(skillKey) as Record<string, unknown>[];
    return rows.map((r) => this.mapSkill(r));
  }

  setStatus(id: string, status: SkillRecordStatus, actor: string): Skill | null {
    const patch: Record<string, unknown> = { status, updatedAt: nowIso() };
    if (status === 'approved') {
      patch.approvedBy = actor;
      patch.approvedAt = nowIso();
    }
    const sets = Object.keys(patch)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    const res = this.db.prepare(`UPDATE skills SET ${sets} WHERE id = @id`).run({ id, ...patch });
    return res.changes > 0 ? this.getById(id) : null;
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return res.changes > 0;
  }

  private mapSkill(r: Record<string, unknown>): Skill {
    return {
      id: String(r.id),
      skillKey: String(r.skillKey),
      title: String(r.title),
      frontmatter: parseJson<Record<string, unknown>>(r.frontmatter, {}),
      body: String(r.body),
      sourceNoteIds: parseJson<string[]>(r.sourceNoteIds, []),
      sourceCaseIds: parseJson<string[]>(r.sourceCaseIds, []),
      version: Number(r.version ?? 1),
      isCurrent: Number(r.isCurrent) === 1,
      status: r.status as SkillRecordStatus,
      author: String(r.author),
      approvedBy: r.approvedBy ? String(r.approvedBy) : undefined,
      approvedAt: r.approvedAt ? String(r.approvedAt) : undefined,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }
}
