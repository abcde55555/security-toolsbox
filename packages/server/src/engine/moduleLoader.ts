import type { BaseModule, ModuleConfig } from '@en18031/shared';
import { moduleConfigSchema } from '@en18031/shared';
import { logger } from '../logger.js';

export class ModuleLoader {
  private modules = new Map<string, BaseModule>();

  async loadBuiltins(): Promise<void> {
    try {
      // @ts-ignore workspace sibling package
      const mod = await import('@en18031/modules');
      const list = (mod.builtInModules ?? []) as BaseModule[];
      for (const m of list) {
        this.register(m);
      }
      logger.info({ count: list.length }, 'built-in modules loaded');
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'failed to load built-in modules');
    }
  }

  register(module: BaseModule): void {
    const parsed = moduleConfigSchema.safeParse(module.config);
    if (!parsed.success) {
      logger.error(
        { id: module.config?.id, errors: parsed.error.issues },
        'module config invalid, refused to load',
      );
      throw new Error(`Invalid module config: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    if (typeof module.execute !== 'function') {
      throw new Error(`Module ${module.config.id} does not implement execute()`);
    }
    this.modules.set(module.config.id, module);
  }

  get(id: string): BaseModule | undefined {
    return this.modules.get(id);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  list(): BaseModule[] {
    return [...this.modules.values()];
  }

  listConfigs(): ModuleConfig[] {
    return this.list().map((m) => m.config);
  }
}
