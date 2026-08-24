import type { Repositories } from '../repositories/index.js';
import type { AiProvider } from '../agent/ai/types.js';

/**
 * Build an AiProvider from the currently active settings row.
 * `prefer: 'narrative'` uses the narrative model when configured, falling
 * back to the planning model. Returns null when no provider/key is set —
 * callers must degrade gracefully (AI features are optional by design).
 */
export async function createActiveAiProvider(
  repos: Repositories,
  prefer: 'narrative' | 'planning' = 'planning',
): Promise<{ provider: AiProvider; model: string } | null> {
  const row = repos.settings.getActiveProvider();
  if (!row?.apiKey) return null;
  const model = prefer === 'narrative' ? row.narrativeModel || row.planningModel : row.planningModel;
  const { DeepSeekProvider } = await import('../agent/ai/deepseekProvider.js');
  return {
    provider: new DeepSeekProvider({
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      timeoutMs: row.timeoutMs,
      maxRetries: row.maxRetries,
      defaultModel: model,
      protocol: row.protocol,
    }),
    model,
  };
}
