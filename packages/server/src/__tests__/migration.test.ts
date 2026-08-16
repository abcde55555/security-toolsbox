import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createInMemoryDb, runMigrations } from '../db/database.js';
import { createInMemoryRepositories } from '../repositories/index.js';
import { createCancelToken } from '../engine/cancelToken.js';
import './helpers.js';

describe('cancelToken', () => {
  it('isRequested reflects cancellation after spread (regression)', async () => {
    const token = createCancelToken();
    const copied = { ...token };
    expect(copied.isRequested).toBe(false);
    token.cancel();
    expect(token.isRequested).toBe(true);
    await expect(token.promise).resolves.toBeUndefined();
  });
});

describe('migration 3', () => {
  it('adds commands column and command_runs table with indexes', () => {
    const db = createInMemoryDb();
    const toolCols = (db.prepare('PRAGMA table_info(tools)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(toolCols).toContain('commands');

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toContain('command_runs');

    const indexes = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='command_runs'")
      .all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain('idx_cmd_runs_tool_created');
    expect(indexes).toContain('idx_cmd_runs_project_created');
    expect(indexes).toContain('idx_cmd_runs_status');
    db.close();
  });

  it('is idempotent: PRAGMA guard prevents duplicate commands column', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT, appliedAt TEXT)');
    db.exec(`CREATE TABLE tools (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, interactionMode TEXT, version TEXT,
      tags TEXT DEFAULT '[]', category TEXT DEFAULT 'other', formFields TEXT DEFAULT '[]',
      clauses TEXT DEFAULT '[]', builtin INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT
    )`);
    db.prepare('INSERT INTO _migrations (id, name, appliedAt) VALUES (?,?,?)').run(1, 'initial_schema', new Date().toISOString());
    db.prepare('INSERT INTO _migrations (id, name, appliedAt) VALUES (?,?,?)').run(2, 'audit_log_append_only_triggers', new Date().toISOString());

    runMigrations(db);
    runMigrations(db);

    const cols = (db.prepare('PRAGMA table_info(tools)').all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === 'commands')).toHaveLength(1);
    db.close();
  });

  it('toolRepository preserves commands on partial update', () => {
    const { repos, close } = createInMemoryRepositories();
    const tool = repos.tools.create({
      name: 't',
      type: 'custom',
      interactionMode: 'cmd',
      version: '1.0.0',
      category: 'other',
      commands: [
        {
          id: 'ping',
          name: 'ping',
          commandTemplate: 'ping {{target}}',
          params: [{ id: 'target', label: 't', type: 'text' }],
        },
      ],
    });
    expect(tool.commands).toHaveLength(1);

    const updated = repos.tools.update(tool.id, { name: 'renamed' })!;
    expect(updated.name).toBe('renamed');
    expect(updated.commands).toHaveLength(1);
    expect(updated.commands![0].id).toBe('ping');
    close();
  });
});
