import type { Database } from 'better-sqlite3';
import type { AiProviderConfig } from '@en18031/shared';
import { nowIso, uuid } from '@en18031/shared';
import { parseJson, toJson } from './json.js';

const PROVIDERS_KEY = 'ai.providers';
const ACTIVE_KEY = 'ai.activeProviderId';

/** Mask a secret for display: keep first 4 + last 4 chars. */
export function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(8, key.length - 8))}${key.slice(-4)}`;
}

export class SettingRepository {
  constructor(private db: Database) {}

  private getRaw(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setRaw(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      )
      .run(key, value, nowIso());
  }

  listProviders(): AiProviderConfig[] {
    return parseJson<AiProviderConfig[]>(this.getRaw(PROVIDERS_KEY), []);
  }

  /** Internal: full records including stored apiKey. For building the runtime. */
  listProvidersWithKeys(): AiProviderConfig[] {
    return this.listProviders();
  }

  getActiveProviderId(): string | undefined {
    return this.getRaw(ACTIVE_KEY) || undefined;
  }

  getActiveProvider(): AiProviderConfig | undefined {
    const id = this.getActiveProviderId();
    if (!id) return undefined;
    return this.listProviders().find((p) => p.id === id && p.isActive);
  }

  upsertProvider(input: Omit<AiProviderConfig, 'hasKey' | 'createdAt' | 'updatedAt' | 'id'> & {
    id?: string;
    apiKey?: string;
  }): AiProviderConfig {
    const providers = this.listProviders();
    const now = nowIso();
    let record: AiProviderConfig;

    if (input.id && providers.some((p) => p.id === input.id)) {
      const existing = providers.find((p) => p.id === input.id)!;
      record = {
        ...existing,
        ...input,
        apiKey: input.apiKey && input.apiKey.trim() ? input.apiKey : existing.apiKey,
        hasKey: Boolean((input.apiKey && input.apiKey.trim()) || existing.apiKey),
        updatedAt: now,
      };
    } else {
      record = {
        id: input.id ?? uuid(),
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        apiKey: input.apiKey || undefined,
        planningModel: input.planningModel,
        narrativeModel: input.narrativeModel,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        isActive: input.isActive,
        hasKey: Boolean(input.apiKey && input.apiKey.trim()),
        createdAt: now,
        updatedAt: now,
      };
    }

    // Enforce single active provider.
    if (record.isActive) {
      for (const p of providers) p.isActive = p.id === record.id;
    }
    const next = providers.some((p) => p.id === record.id)
      ? providers.map((p) => (p.id === record.id ? record : p))
      : [...providers, record];
    this.setRaw(PROVIDERS_KEY, toJson(next));
    if (record.isActive) this.setRaw(ACTIVE_KEY, record.id);
    return this.stripKey(record);
  }

  deleteProvider(id: string): void {
    const providers = this.listProviders().filter((p) => p.id !== id);
    this.setRaw(PROVIDERS_KEY, toJson(providers));
    if (this.getActiveProviderId() === id) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(ACTIVE_KEY);
    }
  }

  setActive(id: string): AiProviderConfig | undefined {
    const provider = this.listProviders().find((p) => p.id === id);
    if (!provider) return undefined;
    this.upsertProvider({ ...provider, isActive: true });
    return this.getActiveProvider();
  }

  /** Return a copy without the secret, for API responses. */
  stripKey(p: AiProviderConfig): AiProviderConfig {
    const { apiKey, ...rest } = p;
    return { ...rest, apiKey: undefined } as AiProviderConfig;
  }
}
