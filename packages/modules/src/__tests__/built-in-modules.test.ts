import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { moduleConfigSchema } from '@en18031/shared';

import { builtInModules } from '../index.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('builtInModules', () => {
  it('导出 4 个内置模组，顺序固定', () => {
    expect(builtInModules.map((m) => m.config.id)).toEqual([
      'en18031-port-check',
      'en18031-crypto-check',
      'en18031-default-cred-check',
      'en18031-firmware-secret-scan',
    ]);
  });

  it('每个模组的 config 都能通过 moduleConfigSchema 校验', () => {
    for (const m of builtInModules) {
      const parsed = moduleConfigSchema.safeParse(m.config);
      expect(parsed.success, `${m.config.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('每个模组 config 无运行时副作用且可 JSON 序列化', () => {
    for (const m of builtInModules) {
      expect(JSON.parse(JSON.stringify(m.config))).toEqual(m.config);
    }
  });

  it('id / 声明条款唯一且非空，sdkVersion 一致', () => {
    const ids = new Set<string>();
    for (const m of builtInModules) {
      expect(ids.has(m.config.id)).toBe(false);
      ids.add(m.config.id);
      expect(m.config.sdkVersion).toBe('^1.0.0');
      expect(m.config.type).toBe('module');
      expect(m.config.interactionMode).toBe('form');
      expect(m.config.tags.length).toBeGreaterThan(0);
      expect(m.config.clauses.length).toBeGreaterThan(0);
      const clauseIds = m.config.clauses.map((c) => c.clauseId);
      expect(new Set(clauseIds).size).toBe(clauseIds.length);
      expect(typeof m.execute).toBe('function');
    }
  });

  it('模组代码不得直接引入 child_process', async () => {
    const dirs = (await readdir(SRC_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('en18031-'))
      .map((d) => join(SRC_DIR, d.name));
    expect(dirs.length).toBe(4);
    for (const dir of dirs) {
      for (const file of ['index.ts', 'module.config.ts']) {
        const code = await readFile(join(dir, file), 'utf8');
        expect(code).not.toMatch(/child_process/);
        expect(code).not.toMatch(/require\(/);
      }
    }
  });

  it('每个模组目录都有 README.md', async () => {
    for (const m of builtInModules) {
      const readme = await readFile(join(SRC_DIR, m.config.id, 'README.md'), 'utf8');
      expect(readme).toContain(m.config.id);
      for (const c of m.config.clauses) {
        expect(readme).toContain(c.clauseId);
      }
    }
  });
});
