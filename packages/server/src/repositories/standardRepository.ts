import type { Database } from 'better-sqlite3';
import type { Standard } from '@en18031/shared';
import { nowIso } from '@en18031/shared';

export class StandardRepository {
  constructor(private db: Database) {}

  list(): Standard[] {
    const rows = this.db.prepare('SELECT * FROM standards ORDER BY createdAt').all() as Record<string, unknown>[];
    return rows.map((r) => this.map(r));
  }

  get(id: string): Standard | null {
    const row = this.db.prepare('SELECT * FROM standards WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.map(row) : null;
  }

  upsert(input: { id: string; code: string; name: string; version: string; description?: string }): Standard {
    const existing = this.get(input.id);
    const now = nowIso();
    if (existing) {
      this.db
        .prepare('UPDATE standards SET code=?, name=?, version=?, description=?, updatedAt=? WHERE id=?')
        .run(input.code, input.name, input.version, input.description ?? null, now, input.id);
    } else {
      this.db
        .prepare(
          'INSERT INTO standards (id, code, name, version, description, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
        )
        .run(input.id, input.code, input.name, input.version, input.description ?? null, now, now);
    }
    return this.get(input.id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM standards WHERE id=?').run(id);
    return result.changes > 0;
  }

  private map(r: Record<string, unknown>): Standard {
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      version: String(r.version),
      description: r.description ? String(r.description) : undefined,
      createdAt: String(r.createdAt),
      updatedAt: String(r.updatedAt),
    };
  }
}
