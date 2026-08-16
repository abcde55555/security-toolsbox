import { getDb } from './database.js';
import { getRepositories } from '../repositories/index.js';
import { SEED_CLAUSES, STANDARD_VERSION } from './clauseSeed.js';
import { seedCommandTools } from './commandToolSeed.js';
import { nowIso } from '@en18031/shared';
import { logger } from '../logger.js';

export async function runSeed(): Promise<void> {
  const db = getDb();
  const repos = getRepositories();

  const now = nowIso();
  const workspaceExists = db.prepare('SELECT id FROM workspaces WHERE id = ?').get('default');
  if (!workspaceExists) {
    db.prepare('INSERT INTO workspaces (id, name, slug, status, createdAt) VALUES (?,?,?,?,?)').run(
      'default',
      '默认工作空间',
      'default',
      'active',
      now,
    );
    logger.info('workspace default created');
  }

  const adminExists = db.prepare("SELECT id FROM users WHERE id = 'local-admin'").get();
  if (!adminExists) {
    db.prepare(
      `INSERT INTO users (id, workspaceId, username, email, passwordHash, role, status, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run('local-admin', 'default', 'Admin', null, null, 'admin', 'active', now, now);
  }

  for (const clause of SEED_CLAUSES) {
    repos.clauses.upsert(clause);
  }
  logger.info({ count: SEED_CLAUSES.length }, 'clauses seeded');

  try {
    // @ts-ignore - built-in modules package is a workspace sibling
    const mod = await import('@en18031/modules');
    const modules = (mod.builtInModules ?? []) as Array<{ config: import('@en18031/shared').ModuleConfig }>;
    for (const m of modules) {
      const cfg = m.config;
      const existing = repos.tools.getById(cfg.id, true);
      const toolData = {
        id: cfg.id,
        workspaceId: 'default',
        name: cfg.name,
        type: cfg.type,
        interactionMode: cfg.interactionMode,
        version: cfg.version,
        sdkVersion: cfg.sdkVersion,
        author: cfg.author,
        description: cfg.description,
        tags: cfg.tags,
        category: cfg.category,
        path: cfg.path,
        envVars: cfg.envVars,
        healthCheck: cfg.healthCheck,
        formFields: cfg.formFields,
        clauses: cfg.clauses,
        builtin: true,
      };
      if (existing) {
        repos.tools.update(cfg.id, toolData);
      } else {
        repos.tools.create(toolData);
      }
      logger.info({ tool: cfg.id }, 'built-in module registered');
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'built-in modules not registered (package may not be built yet)');
  }

  await seedCommandTools(repos);

  logger.info('seed complete');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed()
    .then(() => {
      logger.info('seed done');
      process.exit(0);
    })
    .catch((e) => {
      logger.error(e);
      process.exit(1);
    });
}
