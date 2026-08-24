import type { FastifyInstance } from 'fastify';
import { getServices } from '../services/index.js';
import { handleError, ok, requireRole } from './helpers.js';
import { notify } from '../services/notificationService.js';

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  /** List current-version skills; ?keyword= filters key/title/body. */
  app.get('/api/skills', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const q = req.query as { keyword?: string };
      ok(reply, getServices().skills.list(q.keyword));
    } catch (e) {
      handleError(reply, e);
    }
  });

  /** Version history of one skillKey (superseded rows included). */
  app.get('/api/skills/:id/versions', { preHandler: requireRole('auditor') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const services = getServices();
      const skill = services.repos.skills.getById(id);
      if (!skill) return handleError(reply, Object.assign(new Error(`技能 '${id}' 不存在`), { code: 9004, httpStatus: 404 }));
      ok(reply, services.repos.skills.listVersions(skill.skillKey));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/skills/:id/approve', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().skills.approve(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  app.post('/api/skills/:id/archive', { preHandler: requireRole('template_manager') }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      ok(reply, getServices().skills.archive(id));
    } catch (e) {
      handleError(reply, e);
    }
  });

  /**
   * Accept a sedimentation proposal coming from an AI notification:
   * compiles the draft carried in the notification payload into a real
   * draft Skill and marks the notification accepted.
   */
  app.post(
    '/api/notifications/:id/accept-skill',
    { preHandler: requireRole('template_manager') },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const services = getServices();
        const notification = services.repos.notifications.getById(id);
        if (!notification) throw Object.assign(new Error(`通知 '${id}' 不存在`), { code: 9004, httpStatus: 404 });
        if (notification.type !== 'skill_sediment') {
          throw Object.assign(new Error('该通知不是技能沉淀建议'), { code: 9003, httpStatus: 400 });
        }
        const payload = notification.payload as {
          title?: string;
          summary?: string;
          body?: string;
          sourceNoteIds?: string[];
        };
        const title = payload.title ?? '未命名技能';
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48);
        const skill = services.repos.skills.create({
          skillKey: slug || `skill-${Date.now()}`,
          title,
          frontmatter: { description: payload.summary ?? '', whenToUse: payload.summary ?? '' },
          body: payload.body || payload.summary || '',
          sourceNoteIds: Array.isArray(payload.sourceNoteIds) ? payload.sourceNoteIds : [],
          status: 'draft',
          author: services.authz.getCurrentUser().id,
        });
        const updated = services.repos.notifications.setStatus(id, 'accepted');
        services.repos.audit.insert({
          userId: services.authz.getCurrentUser().id,
          action: 'skill.accept_proposal',
          entityType: 'skill',
          entityId: skill.id,
          after: { fromNotification: id, skillKey: skill.skillKey },
        });
        ok(reply, { skill, notification: updated });
      } catch (e) {
        handleError(reply, e);
      }
    },
  );
}

/** Re-exported for the agent tool handler: proposal -> notification + bus broadcast. */
export function proposeSkillNotification(input: {
  title: string;
  summary?: string;
  body?: string;
  sourceNoteIds?: string[];
  sessionId?: string;
  projectId?: string;
}) {
  const services = getServices();
  return notify(services.repos, services.bus, {
    type: 'skill_sediment',
    title: input.title,
    message: input.summary ?? '',
    reason: input.summary,
    payload: {
      title: input.title,
      summary: input.summary ?? '',
      body: input.body ?? '',
      sourceNoteIds: input.sourceNoteIds ?? [],
    },
    sessionId: input.sessionId,
    projectId: input.projectId,
    createdBy: services.authz.getCurrentUser().id,
  });
}
