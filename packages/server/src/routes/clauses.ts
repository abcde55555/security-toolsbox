import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';
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
  if (!clauseId) throw Object.assign(new Error('条款编号必填'), { statusCode: 400, code: 9003 });
  if (!chapter) throw Object.assign(new Error('章节必填'), { statusCode: 400, code: 9003 });
  if (!title) throw Object.assign(new Error('标题必填'), { statusCode: 400, code: 9003 });
  const level = (b.level ?? 'L1') as Clause['level'];
  if (!clauseInputSchema.level(level)) {
    throw Object.assign(new Error('等级必须为 L1/L2/L3'), { statusCode: 400, code: 9003 });
  }
  const defaultSeverity = (b.defaultSeverity ?? 'middle') as Clause['defaultSeverity'];
  if (!clauseInputSchema.defaultSeverity(defaultSeverity)) {
    throw Object.assign(new Error('严重度必须为 high/middle/low'), { statusCode: 400, code: 9003 });
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
        throw Object.assign(new Error(`条款 ${clause.clauseId} 已存在`), { statusCode: 409, code: 9005 });
      }
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
      const updated = getServices().repos.clauses.update(standardVersion, clauseId, {
        ...(b.title !== undefined && { title: String(b.title) }),
        ...(b.description !== undefined && { description: String(b.description) }),
        ...(b.chapter !== undefined && { chapter: String(b.chapter) }),
        ...(b.level !== undefined && { level: b.level as Clause['level'] }),
        ...(b.testingMethod !== undefined && { testingMethod: String(b.testingMethod) }),
        ...(b.defaultSeverity !== undefined && { defaultSeverity: b.defaultSeverity as Clause['defaultSeverity'] }),
        ...(b.parentId !== undefined && { parentId: b.parentId ? String(b.parentId) : undefined }),
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
      const deleted = getServices().repos.clauses.delete(standardVersion, clauseId);
      if (!deleted) throw Object.assign(new Error('条款不存在'), { statusCode: 404, code: 9004 });
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
      const clauses = req.body as Clause[];
      const repos = getServices().repos;
      const list = Array.isArray(clauses) ? clauses : [];
      for (const c of list) repos.clauses.upsert(c);
      ok(reply, { imported: list.length });
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
