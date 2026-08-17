import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { ok, requireRole, handleError } from './helpers.js';
import type { Standard } from '@en18031/shared';

function parseBody(body: unknown): Omit<Standard, 'createdAt' | 'updatedAt'> {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = String(b.code ?? '').trim();
  const version = String(b.version ?? '').trim();
  const name = String(b.name ?? '').trim();
  if (!code) throw Object.assign(new Error('标准代号必填'), { statusCode: 400, code: 9003 });
  if (!name) throw Object.assign(new Error('标准名称必填'), { statusCode: 400, code: 9003 });
  if (!version) throw Object.assign(new Error('版本必填'), { statusCode: 400, code: 9003 });
  // id is provided explicitly, or derived as CODE:VERSION.
  const id = (b.id ? String(b.id).trim() : `${code}:${version}`).toUpperCase();
  return {
    id,
    code: code.toUpperCase(),
    name,
    version,
    description: b.description ? String(b.description) : undefined,
  };
}

export async function standardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/standards', { preHandler: requireRole('auditor') }, async (_req, reply) => {
    try {
      ok(reply, getServices().repos.standards.list());
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/standards', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const data = parseBody(req.body);
      const repos = getServices().repos;
      if (repos.standards.get(data.id)) {
        throw Object.assign(new Error(`标准 ${data.id} 已存在`), { statusCode: 409, code: 9005 });
      }
      const standard = repos.standards.upsert(data);
      getServices().repos.audit.insert({
        userId: getServices().authz.getCurrentUser().id,
        action: 'standard.create',
        entityType: 'standard',
        entityId: standard.id,
        after: data,
      });
      ok(reply, standard);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.put('/api/standards/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const repos = getServices().repos;
      const existing = repos.standards.get(id);
      if (!existing) throw Object.assign(new Error('标准不存在'), { statusCode: 404, code: 9004 });
      const b = (req.body ?? {}) as Record<string, unknown>;
      const standard = repos.standards.upsert({
        id,
        code: b.code ? String(b.code) : existing.code,
        name: b.name ? String(b.name) : existing.name,
        version: b.version ? String(b.version) : existing.version,
        description: b.description !== undefined ? (b.description ? String(b.description) : undefined) : existing.description,
      });
      ok(reply, standard);
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.delete('/api/standards/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const repos = getServices().repos;
      const clauseCount = repos.clauses.countForStandard(id);
      if (clauseCount > 0) {
        throw Object.assign(new Error(`该标准下还有 ${clauseCount} 条条款，不能删除`), { statusCode: 409, code: 9005 });
      }
      const deleted = repos.standards.delete(id);
      if (!deleted) throw Object.assign(new Error('标准不存在'), { statusCode: 404, code: 9004 });
      ok(reply, { id, deleted: true });
    } catch (e) {
      handleError(reply, e);
    }
  });
}
