import type { Database } from 'better-sqlite3';
import type { Clause, ClauseMappingRule, ClauseNode } from '@en18031/shared';
import { uuid, nowIso } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

export class ClauseRepository {
  constructor(private db: Database) {}

  upsert(clause: Clause): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO clauses (clauseId, standardVersion, chapter, title, description, level, testingMethod,
           defaultSeverity, parentId, tags, createdAt, updatedAt)
         VALUES (@clauseId,@standardVersion,@chapter,@title,@description,@level,@testingMethod,
           @defaultSeverity,@parentId,@tags,@createdAt,@updatedAt)
         ON CONFLICT(standardVersion, clauseId) DO UPDATE SET
           chapter=excluded.chapter, title=excluded.title, description=excluded.description,
           level=excluded.level, testingMethod=excluded.testingMethod, defaultSeverity=excluded.defaultSeverity,
           parentId=excluded.parentId, tags=excluded.tags, updatedAt=excluded.updatedAt`,
      )
      .run({
        clauseId: clause.clauseId,
        standardVersion: clause.standardVersion,
        chapter: clause.chapter,
        title: clause.title,
        description: clause.description,
        level: clause.level,
        testingMethod: clause.testingMethod ?? null,
        defaultSeverity: clause.defaultSeverity,
        parentId: clause.parentId ?? null,
        tags: toJson(clause.tags ?? []),
        createdAt: now,
        updatedAt: now,
      });
  }

  list(standardVersion: string, level?: string): Clause[] {
    const rows = level
      ? (this.db
          .prepare('SELECT * FROM clauses WHERE standardVersion = ? AND level = ? ORDER BY clauseId')
          .all(standardVersion, level) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM clauses WHERE standardVersion = ? ORDER BY clauseId')
          .all(standardVersion) as Record<string, unknown>[]);
    return rows.map((r) => this.mapClause(r));
  }

  get(standardVersion: string, clauseId: string): Clause | null {
    const row = this.db
      .prepare('SELECT * FROM clauses WHERE standardVersion = ? AND clauseId = ?')
      .get(standardVersion, clauseId) as Record<string, unknown> | undefined;
    return row ? this.mapClause(row) : null;
  }

  exists(standardVersion: string, clauseId: string): boolean {
    return this.get(standardVersion, clauseId) !== null;
  }

  countForStandard(standardVersion: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM clauses WHERE standardVersion = ?')
      .get(standardVersion) as { c: number };
    return row.c;
  }

  /** Build the parent/child clause tree. Root clauses have no parentId. */
  tree(standardVersion: string, level?: 'L1' | 'L2' | 'L3'): ClauseNode[] {
    const all = this.list(standardVersion, level);
    const byId = new Map<string, ClauseNode>();
    for (const c of all) byId.set(c.clauseId, { ...c, children: [] });
    const roots: ClauseNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortRec = (nodes: ClauseNode[]) => {
      nodes.sort((a, b) => a.clauseId.localeCompare(b.clauseId, undefined, { numeric: true }));
      nodes.forEach((n) => n.children && sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }

  countForLevel(standardVersion: string, level: 'L1' | 'L2' | 'L3'): number {
    const ordering = { L1: 1, L2: 2, L3: 3 } as const;
    const maxOrder = ordering[level];
    const rows = this.db
      .prepare('SELECT level FROM clauses WHERE standardVersion = ?')
      .all(standardVersion) as { level: string }[];
    return rows.filter((r) => ordering[r.level as 'L1' | 'L2' | 'L3'] <= maxOrder).length;
  }

  listAllForLevel(standardVersion: string, level: 'L1' | 'L2' | 'L3'): Clause[] {
    const ordering = { L1: 1, L2: 2, L3: 3 } as const;
    const maxOrder = ordering[level];
    return this.list(standardVersion).filter((c) => ordering[c.level] <= maxOrder);
  }

  private mapClause(r: Record<string, unknown>): Clause {
    return {
      clauseId: String(r.clauseId),
      standardVersion: String(r.standardVersion),
      chapter: String(r.chapter),
      title: String(r.title),
      description: String(r.description ?? ''),
      level: r.level as Clause['level'],
      testingMethod: r.testingMethod ? String(r.testingMethod) : undefined,
      defaultSeverity: r.defaultSeverity as Clause['defaultSeverity'],
      parentId: r.parentId ? String(r.parentId) : undefined,
      tags: parseJson<string[]>(r.tags, []),
    };
  }

  update(
    standardVersion: string,
    clauseId: string,
    patch: Partial<Pick<Clause, 'title' | 'description' | 'chapter' | 'level' | 'testingMethod' | 'defaultSeverity' | 'tags' | 'parentId'>>,
  ): Clause | null {
    const existing = this.get(standardVersion, clauseId);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE clauses SET chapter=?, title=?, description=?, level=?, testingMethod=?,
           defaultSeverity=?, parentId=?, tags=?, updatedAt=?
         WHERE standardVersion=? AND clauseId=?`,
      )
      .run(
        merged.chapter,
        merged.title,
        merged.description,
        merged.level,
        merged.testingMethod ?? null,
        merged.defaultSeverity,
        merged.parentId ?? null,
        toJson(merged.tags ?? []),
        now,
        standardVersion,
        clauseId,
      );
    return this.get(standardVersion, clauseId);
  }

  delete(standardVersion: string, clauseId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM clauses WHERE standardVersion=? AND clauseId=?')
      .run(standardVersion, clauseId);
    return result.changes > 0;
  }

  listMappingRules(toolId?: string): ClauseMappingRule[] {
    const rows = toolId
      ? (this.db
          .prepare('SELECT * FROM clause_mapping_rules WHERE toolId = ? ORDER BY priority DESC, id')
          .all(toolId) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM clause_mapping_rules ORDER BY priority DESC, id')
          .all() as Record<string, unknown>[]);
    return rows.map((r) => ({
      id: String(r.id),
      toolId: String(r.toolId),
      commandId: r.commandId ? String(r.commandId) : undefined,
      clauseId: String(r.clauseId),
      matcherType: r.matcherType as ClauseMappingRule['matcherType'],
      pattern: String(r.pattern),
      onMatch: r.onMatch as ClauseMappingRule['onMatch'],
      severityOverride: r.severityOverride ? (String(r.severityOverride) as ClauseMappingRule['severityOverride']) : undefined,
      priority: Number(r.priority ?? 0),
    }));
  }

  createMappingRule(rule: Omit<ClauseMappingRule, 'id'>): ClauseMappingRule {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO clause_mapping_rules (id, toolId, commandId, clauseId, matcherType, pattern, onMatch, severityOverride, priority, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        rule.toolId,
        rule.commandId ?? null,
        rule.clauseId,
        rule.matcherType,
        rule.pattern,
        rule.onMatch,
        rule.severityOverride ?? null,
        rule.priority,
        nowIso(),
      );
    return { ...rule, id };
  }

  deleteMappingRule(id: string): void {
    this.db.prepare('DELETE FROM clause_mapping_rules WHERE id = ?').run(id);
  }
}
