import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';
import { Errors } from '../services/errors.js';
import type { Clause, ClauseMappingRule } from '@en18031/shared';

const clauseInputSchema = {
  clauseId: (v: unknown) => typeof v === 'string' && v.trim().length > 0,
  chapter: (v: unknown) => typeof v === 'string' && v.trim().length > 0,
  title: (v: unknown) => typeof v === 'string' && v.trim().length > 0,
  level: (v: unknown) => v === 'L1' || v === 'L2' || v === 'L3',
  defaultSeverity: (v: unknown) => v === 'high' || v === 'middle' || v === 'low',
};

function parseClauseBody(body: unknown, standardVersion: string): Clause {
  const b = (body ?? {}) as Record<string, unknown>;
  const clauseId = String(b.clauseId ?? '').trim();
  const chapter = String(b.chapter ?? '').trim();
  const title = String(b.title ?? '').trim();
  if (!clauseId) throw Errors.validation('条款编号必填');
  if (!chapter) throw Errors.validation('章节必填');
  if (!title) throw Errors.validation('标题必填');
  const level = (b.level ?? 'L1') as Clause['level'];
  if (!clauseInputSchema.level(level)) {
    throw Errors.validation('等级必须为 L1/L2/L3');
  }
  const defaultSeverity = (b.defaultSeverity ?? 'middle') as Clause['defaultSeverity'];
  if (!clauseInputSchema.defaultSeverity(defaultSeverity)) {
    throw Errors.validation('严重度必须为 high/middle/low');
  }
  return {
    clauseId,
    standardVersion,
    chapter,
    title,
    description: typeof b.description === 'string' ? b.description : '',
    level,
    testingMethod: b.testingMethod ? String(b.testingMethod) : undefined,
    defaultSeverity,
    parentId: b.parentId ? String(b.parentId) : undefined,
    tags: Array.isArray(b.tags) ? (b.tags as string[]) : [],
  };
}

interface ClauseLookup {
  get(standardVersion: string, clauseId: string): Clause | null;
  list(standardVersion: string): Clause[];
}

function validateParentId(
  repos: ClauseLookup,
  standardVersion: string,
  clauseId: string,
  parentId: string | undefined,
): void {
  if (!parentId) return;
  if (parentId === clauseId) {
    throw Errors.validation('父条款不能指向自身');
  }
  if (!repos.get(standardVersion, parentId)) {
    throw Errors.validation(`父条款 ${parentId} 不存在`);
  }
  // Reject if parentId is a descendant of clauseId (would form a cycle).
  const childrenOf = new Map<string, string[]>();
  for (const c of repos.list(standardVersion)) {
    if (c.parentId) {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c.clauseId);
      childrenOf.set(c.parentId, arr);
    }
  }
  const stack = [clauseId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === parentId) {
      throw Errors.validation('父条款不能是当前条款的子项（会形成循环）');
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const child of childrenOf.get(cur) ?? []) stack.push(child);
  }
}

export async function clauseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/clauses', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { standardVersion?: string; level?: 'L1' | 'L2' | 'L3'; chapter?: string };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      const clauses = getServices().clauses.listClauses(standardVersion, q.level);
      ok(reply, q.chapter ? clauses.filter((c) => c.chapter === q.chapter) : clauses);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/clauses/tree', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { standardVersion?: string; level?: 'L1' | 'L2' | 'L3' };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      ok(reply, getServices().repos.clauses.tree(standardVersion, q.level));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/clauses/:clauseId', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { clauseId } = req.params as { clauseId: string };
      const q = req.query as { standardVersion?: string };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      const clause = getServices().clauses.validateClauseExists(standardVersion, clauseId);
      ok(reply, clause);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clauses', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const q = req.query as { standardVersion?: string };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      const clause = parseClauseBody(req.body, standardVersion);
      if (getServices().repos.clauses.get(standardVersion, clause.clauseId)) {
        throw Errors.conflict(`条款 ${clause.clauseId} 已存在`);
      }
      validateParentId(getServices().repos.clauses, standardVersion, clause.clauseId, clause.parentId);
      getServices().repos.clauses.upsert(clause);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'clause.create',
        entityType: 'clause',
        entityId: clause.clauseId,
        after: clause,
      });
      ok(reply, clause);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/clauses/:clauseId', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { clauseId } = req.params as { clauseId: string };
      const q = req.query as { standardVersion?: string };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      getServices().clauses.validateClauseExists(standardVersion, clauseId);
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (b.level !== undefined && !clauseInputSchema.level(b.level as Clause['level'])) {
        throw Errors.validation('等级必须为 L1/L2/L3');
      }
      if (
        b.defaultSeverity !== undefined &&
        !clauseInputSchema.defaultSeverity(b.defaultSeverity as Clause['defaultSeverity'])
      ) {
        throw Errors.validation('严重度必须为 high/middle/low');
      }
      const nextParentId =
        b.parentId !== undefined ? (b.parentId ? String(b.parentId) : undefined) : undefined;
      if (b.parentId !== undefined) {
        validateParentId(getServices().repos.clauses, standardVersion, clauseId, nextParentId);
      }
      const updated = getServices().repos.clauses.update(standardVersion, clauseId, {
        ...(b.title !== undefined && { title: String(b.title) }),
        ...(b.description !== undefined && { description: String(b.description) }),
        ...(b.chapter !== undefined && { chapter: String(b.chapter) }),
        ...(b.level !== undefined && { level: b.level as Clause['level'] }),
        ...(b.testingMethod !== undefined && { testingMethod: String(b.testingMethod) }),
        ...(b.defaultSeverity !== undefined && { defaultSeverity: b.defaultSeverity as Clause['defaultSeverity'] }),
        ...(b.parentId !== undefined && { parentId: nextParentId }),
        ...(b.tags !== undefined && { tags: Array.isArray(b.tags) ? (b.tags as string[]) : [] }),
      });
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'clause.update',
        entityType: 'clause',
        entityId: clauseId,
        after: updated,
      });
      ok(reply, updated);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/clauses/:clauseId', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { clauseId } = req.params as { clauseId: string };
      const q = req.query as { standardVersion?: string };
      const standardVersion = q.standardVersion ?? 'EN18031:2019';
      getServices().clauses.validateClauseExists(standardVersion, clauseId);
      const hasChildren = getServices()
        .repos.clauses.list(standardVersion)
        .some((c) => c.parentId === clauseId);
      if (hasChildren) {
        throw Errors.conflict('该条款下仍有子条款，请先删除或转移子条款');
      }
      const deleted = getServices().repos.clauses.delete(standardVersion, clauseId);
      if (!deleted) throw Errors.notFound('条款', clauseId);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'clause.delete',
        entityType: 'clause',
        entityId: clauseId,
      });
      ok(reply, { clauseId, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clauses/batch-import', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const clauses = req.body as unknown[];
      const q = req.query as { standardVersion?: string };
      const repos = getServices().repos;
      const list = Array.isArray(clauses) ? clauses : [];
      const errors: Array<{ index: number; clauseId?: string; error: string }> = [];
      let imported = 0;
      // Normalize and import in a single transaction so partial failures are clear.
      repos.clauses.transaction((repo) => {
        list.forEach((raw, i) => {
          try {
            const c = raw as Partial<Clause> & { children?: unknown };
            if (!c || typeof c !== 'object') throw new Error('不是有效的条款对象');
            if (!c.clauseId) throw new Error('缺少 clauseId');
            if (!c.title) throw new Error('缺少 title');
            // When importing from a standard's page (?standardVersion=),
            // always import into THAT standard, ignoring the standardVersion
            // embedded in the JSON (copying clauses between standards). The
            // embedded value is only used as a fallback.
            const standardVersion = q.standardVersion ?? c.standardVersion;
            if (!standardVersion) throw new Error('缺少 standardVersion');
            // Tree-exported JSON carries nested `children`; drop it.
            const { children: _ignored, ...clean } = c;
            repo.upsert({
              ...clean,
              clauseId: String(c.clauseId),
              title: String(c.title),
              standardVersion: String(standardVersion),
              chapter: c.chapter as string | undefined,
              description: c.description as string | undefined,
              level: c.level as Clause['level'] | undefined,
              testingMethod: c.testingMethod,
              defaultSeverity: c.defaultSeverity as Clause['defaultSeverity'] | undefined,
              parentId: c.parentId ?? undefined,
              tags: c.tags as string[] | undefined,
            });
            imported++;
          } catch (e) {
            const c = (raw ?? {}) as { clauseId?: string };
            errors.push({ index: i, clauseId: c.clauseId, error: (e as Error).message });
          }
        });
      });
      ok(reply, { imported, total: list.length, errors });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.get('/api/clause-mapping-rules', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { toolId?: string };
      ok(reply, getServices().repos.clauses.listMappingRules(q.toolId));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clause-mapping-rules', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const body = req.body as Omit<ClauseMappingRule, 'id'>;
      const rule = getServices().repos.clauses.createMappingRule(body);
      ok(reply, rule);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/clause-mapping-rules/:id', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      getServices().repos.clauses.deleteMappingRule(id);
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/clause-verdicts/:id/override', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { pass, reason } = req.body as { pass: boolean; reason: string };
      ok(reply, getServices().clauses.overrideVerdict(id, pass, reason));
    } catch (e) {
      handleError(reply, e);
    }
  });
}
