import type { FastifyPluginAsync } from 'fastify';
import type { AiProviderInput } from '@en18031/shared';
import { getServices } from '../services/index.js';
import { maskKey } from '../repositories/settingRepository.js';
import { requireRole } from './helpers.js';

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const repos = () => getServices().repos;

  app.get('/api/settings/ai/providers', { preHandler: requireRole('auditor') }, async () => {
    const r = repos();
    const providers = r.settings.listProviders().map((p) => r.settings.stripKey(p));
    return { code: 0, message: 'ok', data: { providers, activeId: r.settings.getActiveProviderId() } };
  });

  app.post<{ Body: AiProviderInput }>('/api/settings/ai/providers', { preHandler: requireRole('admin') }, async (req, reply) => {
    const input = (req.body ?? {}) as AiProviderInput;
    const r = repos();
    if (!input.name?.trim() || !input.baseUrl?.trim()) {
      reply.code(400).send({ code: 9003, message: '名称和 baseUrl 必填' });
      return;
    }
    try { new URL(input.baseUrl); } catch {
      reply.code(400).send({ code: 9003, message: 'baseUrl 不是合法 URL' });
      return;
    }
    if (!input.planningModel?.trim() || !input.narrativeModel?.trim()) {
      reply.code(400).send({ code: 9003, message: '规划模型和成文模型必填' });
      return;
    }
    const isUpdate = Boolean(input.id);
    if (!isUpdate && !input.apiKey?.trim()) {
      reply.code(400).send({ code: 9003, message: '新建供应商必须填写 API Key' });
      return;
    }
    const saved = r.settings.upsertProvider({
      ...input,
      isActive: input.isActive ?? !r.settings.listProviders().some((p) => p.isActive),
    });
    return { code: 0, message: 'ok', data: r.settings.stripKey(saved) };
  });

  app.post<{ Params: { id: string } }>(
    '/api/settings/ai/providers/:id/activate',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const active = repos().settings.setActive(req.params.id);
      if (!active) {
        reply.code(404).send({ code: 9004, message: '供应商不存在' });
        return;
      }
      return { code: 0, message: 'ok', data: repos().settings.stripKey(active) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/settings/ai/providers/:id',
    { preHandler: requireRole('admin') },
    async (req) => {
      repos().settings.deleteProvider(req.params.id);
      return { code: 0, message: 'ok' };
    },
  );

  app.post<{ Body: { id?: string } }>(
    '/api/settings/ai/providers/test',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const r = repos();
      const provider = req.body?.id
        ? r.settings.listProviders().find((p) => p.id === req.body!.id)
        : r.settings.getActiveProvider();
      if (!provider?.apiKey) {
        reply.code(400).send({ code: 9003, message: '未配置 API Key' });
        return;
      }
      try {
        const { DeepSeekProvider } = await import('../agent/ai/deepseekProvider.js');
        const p = new DeepSeekProvider({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          timeoutMs: provider.timeoutMs,
          maxRetries: 0,
          defaultModel: provider.planningModel,
          protocol: provider.protocol,
        });
        const t0 = Date.now();
        const result = await p.chat(
          [
            { role: 'system', content: 'Reply with exactly the word OK.' },
            { role: 'user', content: 'ping' },
          ],
          { model: provider.planningModel, timeoutMs: provider.timeoutMs },
        );
        return {
          code: 0,
          message: 'ok',
          data: {
            ok: true,
            latencyMs: Date.now() - t0,
            model: result.model,
            sample: (result.message.content ?? '').slice(0, 80),
            maskedKey: maskKey(provider.apiKey),
          },
        };
      } catch (err) {
        const e = err as { code?: string; status?: number; cause?: unknown; message?: string };
        const base = e?.message?.trim() || '连接失败';
        const detail = e?.status != null && !base.includes(String(e.status)) ? `${base} (HTTP ${e.status})` : base;
        req.log.error(
          { err, protocol: provider.protocol, baseUrl: provider.baseUrl, model: provider.planningModel },
          'AI provider test failed',
        );
        reply.code(502).send({
          code: 9003,
          message: detail,
          data: { ok: false, status: e?.status, kind: e?.code },
        });
      }
    },
  );
};
