import type { Database } from 'better-sqlite3';
import { nowIso } from '@en18031/shared';

export interface ToolCategory {
  key: string;
  label: string;
  sortOrder: number;
  builtin: boolean;
}

/** The initial, always-available categories (mirrors the old enum). */
export const DEFAULT_CATEGORIES: Array<Omit<ToolCategory, 'createdAt'>> = [
  { key: 'network-compliance', label: '网络合规', sortOrder: 10, builtin: true },
  { key: 'crypto-compliance', label: '密码合规', sortOrder: 20, builtin: true },
  { key: 'credential-compliance', label: '凭证合规', sortOrder: 30, builtin: true },
  { key: 'firmware-analysis', label: '固件分析', sortOrder: 40, builtin: true },
  { key: 'authentication', label: '认证安全', sortOrder: 50, builtin: true },
  { key: 'reconnaissance', label: '侦察探测', sortOrder: 60, builtin: true },
  { key: 'other', label: '其他', sortOrder: 999, builtin: true },
];

export class CategoryRepository {
  constructor(private db: Database) {}

  seed(): void {
    const now = nowIso();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO tool_categories (key, label, sortOrder, builtin, createdAt)
       VALUES (@key, @label, @sortOrder, @builtin, @createdAt)`,
    );
    for (const c of DEFAULT_CATEGORIES) {
      insert.run({
        key: c.key,
        label: c.label,
        sortOrder: c.sortOrder,
        builtin: c.builtin ? 1 : 0,
        createdAt: now,
      });
    }
  }

  list(): ToolCategory[] {
    const rows = this.db
      .prepare('SELECT key, label, sortOrder, builtin FROM tool_categories ORDER BY sortOrder, label')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      sortOrder: Number(r.sortOrder),
      builtin: Boolean(r.builtin),
    }));
  }

  get(key: string): ToolCategory | null {
    const row = this.db
      .prepare('SELECT key, label, sortOrder, builtin FROM tool_categories WHERE key = ?')
      .get(key) as Record<string, unknown> | undefined;
    return row
      ? {
          key: String(row.key),
          label: String(row.label),
          sortOrder: Number(row.sortOrder),
          builtin: Boolean(row.builtin),
        }
      : null;
  }

  create(input: { key: string; label: string }): ToolCategory {
    const normalized = this.normalizeKey(input.key);
    if (this.get(normalized)) {
      throw Object.assign(new Error(`分类 ${normalized} 已存在`), { statusCode: 409, code: 9005 });
    }
    const maxOrder = (this.db
      .prepare('SELECT MAX(sortOrder) as m FROM tool_categories')
      .get() as { m: number | null }).m ?? 0;
    this.db
      .prepare('INSERT INTO tool_categories (key, label, sortOrder, builtin, createdAt) VALUES (?,?,?,0,?)')
      .run(normalized, input.label.trim(), maxOrder + 10, nowIso());
    return this.get(normalized)!;
  }

  update(key: string, patch: { label?: string }): ToolCategory | null {
    const existing = this.get(key);
    if (!existing) return null;
    const label = patch.label?.trim() || existing.label;
    this.db.prepare('UPDATE tool_categories SET label = ? WHERE key = ?').run(label, key);
    return this.get(key);
  }

  /** Move a category before (dir=-1) or after (dir=+1) its neighbor. */
  reorder(key: string, dir: -1 | 1): ToolCategory[] {
    const all = this.list();
    const idx = all.findIndex((c) => c.key === key);
    if (idx < 0) return all;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= all.length) return all;
    const a = all[idx];
    const b = all[swapWith];
    const tmp = a.sortOrder;
    this.db.prepare('UPDATE tool_categories SET sortOrder = ? WHERE key = ?').run(b.sortOrder, a.key);
    this.db.prepare('UPDATE tool_categories SET sortOrder = ? WHERE key = ?').run(tmp, b.key);
    return this.list();
  }

  /**
   * Delete a category. Tools using it are re-categorised to 'other' so nothing
   * is orphaned. Built-in categories cannot be deleted.
   */
  delete(key: string): { deleted: boolean; reassigned: number } {
    const existing = this.get(key);
    if (!existing) return { deleted: false, reassigned: 0 };
    if (existing.builtin) {
      throw Object.assign(new Error('内置分类不能删除'), { statusCode: 400, code: 9003 });
    }
    const result = this.db
      .prepare("UPDATE tools SET category = 'other' WHERE category = ?")
      .run(key);
    this.db.prepare('DELETE FROM tool_categories WHERE key = ?').run(key);
    return { deleted: true, reassigned: result.changes };
  }

  countTools(key: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM tools WHERE category = ? AND deletedAt IS NULL')
      .get(key) as { c: number };
    return row.c;
  }

  private normalizeKey(key: string): string {
    return key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
