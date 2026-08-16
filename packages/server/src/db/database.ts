import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function createInMemoryDb(): Database.Database {
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  return mem;
}

const MIGRATIONS: {
  id: number;
  name: string;
  sql: string;
  run?: (db: Database.Database) => void;
}[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      passwordHash TEXT,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      lastLoginAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      interactionMode TEXT NOT NULL,
      version TEXT NOT NULL,
      sdkVersion TEXT,
      author TEXT,
      description TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'other',
      path TEXT,
      envVars TEXT,
      healthCheck TEXT,
      formFields TEXT NOT NULL DEFAULT '[]',
      clauses TEXT NOT NULL DEFAULT '[]',
      referenceCount INTEGER NOT NULL DEFAULT 0,
      healthStatus TEXT NOT NULL DEFAULT 'unknown',
      healthMessage TEXT,
      healthCheckedAt TEXT,
      builtin INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      schemaVersion TEXT NOT NULL DEFAULT 'v1',
      variables TEXT NOT NULL DEFAULT '[]',
      concurrencyLimit INTEGER NOT NULL DEFAULT 2,
      parentTemplateId TEXT,
      inheritParent INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS template_tools (
      id TEXT PRIMARY KEY,
      templateId TEXT NOT NULL,
      toolId TEXT NOT NULL,
      toolVersionLock TEXT NOT NULL DEFAULT 'follow',
      toolVersionSnapshot TEXT,
      selectedCommands TEXT,
      stepParams TEXT,
      upgradePending INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      UNIQUE(templateId, toolId)
    );

    CREATE TABLE IF NOT EXISTS template_steps (
      id TEXT PRIMARY KEY,
      templateId TEXT NOT NULL,
      stepId TEXT NOT NULL,
      title TEXT NOT NULL,
      toolId TEXT NOT NULL,
      toolVersion TEXT NOT NULL DEFAULT 'latest',
      interactionModeOverride TEXT,
      params TEXT NOT NULL DEFAULT '{}',
      selectedCommands TEXT,
      dependsOn TEXT NOT NULL DEFAULT '[]',
      onFailure TEXT NOT NULL DEFAULT 'continue',
      retry INTEGER NOT NULL DEFAULT 0,
      retryBackoffMs INTEGER NOT NULL DEFAULT 2000,
      timeoutMs INTEGER,
      exportVars TEXT,
      weight REAL NOT NULL DEFAULT 1,
      expandMode TEXT NOT NULL DEFAULT 'cartesian',
      ephemeral INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(templateId, stepId)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      description TEXT,
      templateId TEXT NOT NULL,
      templateVersionSnapshot INTEGER NOT NULL,
      standardVersion TEXT NOT NULL,
      targetComplianceLevel TEXT NOT NULL,
      variables TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      finishedAt TEXT,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS project_runs (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      startedAt TEXT,
      finishedAt TEXT,
      startedBy TEXT NOT NULL,
      progressPercent REAL NOT NULL DEFAULT 0,
      eta TEXT,
      triggerMode TEXT NOT NULL DEFAULT 'manual',
      cancelRequested INTEGER NOT NULL DEFAULT 0,
      snapshotVariables TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS step_runs (
      id TEXT PRIMARY KEY,
      projectRunId TEXT NOT NULL,
      stepId TEXT NOT NULL,
      stepSnapshot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      startedAt TEXT,
      finishedAt TEXT,
      retryOf TEXT,
      exitCode INTEGER,
      stdoutFileRef TEXT,
      stderrFileRef TEXT,
      durationMs INTEGER,
      error TEXT,
      evidenceCount INTEGER NOT NULL DEFAULT 0,
      verdictCount INTEGER NOT NULL DEFAULT 0,
      percent REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS evidences (
      id TEXT PRIMARY KEY,
      stepRunId TEXT NOT NULL,
      projectRunId TEXT NOT NULL,
      projectId TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      fileRef TEXT,
      hash TEXT,
      severity TEXT NOT NULL DEFAULT 'low',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clause_verdicts (
      id TEXT PRIMARY KEY,
      stepRunId TEXT NOT NULL,
      projectRunId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      clauseId TEXT NOT NULL,
      pass INTEGER NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidenceRefs TEXT NOT NULL DEFAULT '[]',
      overridden INTEGER NOT NULL DEFAULT 0,
      overrideReason TEXT,
      verdictGroup TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clauses (
      clauseId TEXT NOT NULL,
      standardVersion TEXT NOT NULL,
      chapter TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL,
      testingMethod TEXT,
      defaultSeverity TEXT NOT NULL DEFAULT 'middle',
      parentId TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (standardVersion, clauseId)
    );

    CREATE TABLE IF NOT EXISTS clause_mapping_rules (
      id TEXT PRIMARY KEY,
      toolId TEXT NOT NULL,
      commandId TEXT,
      clauseId TEXT NOT NULL,
      matcherType TEXT NOT NULL,
      pattern TEXT NOT NULL,
      onMatch TEXT NOT NULL,
      severityOverride TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL DEFAULT 'default',
      userId TEXT NOT NULL,
      action TEXT NOT NULL,
      entityType TEXT NOT NULL,
      entityId TEXT NOT NULL,
      before TEXT,
      after TEXT,
      ip TEXT,
      userAgent TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      projectRunId TEXT,
      format TEXT NOT NULL,
      fileRef TEXT,
      hash TEXT,
      grade TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '{}',
      generatedBy TEXT NOT NULL,
      generatedAt TEXT NOT NULL,
      isLatest INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_tools_workspace ON tools(workspaceId, deletedAt);
    CREATE INDEX IF NOT EXISTS idx_tools_health ON tools(healthStatus);
    CREATE INDEX IF NOT EXISTS idx_templates_workspace ON templates(workspaceId, deletedAt);
    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspaceId, deletedAt);
    CREATE INDEX IF NOT EXISTS idx_project_runs_project ON project_runs(projectId);
    CREATE INDEX IF NOT EXISTS idx_step_runs_run ON step_runs(projectRunId);
    CREATE INDEX IF NOT EXISTS idx_evidences_run ON evidences(projectRunId);
    CREATE INDEX IF NOT EXISTS idx_verdicts_project ON clause_verdicts(projectId);
    CREATE INDEX IF NOT EXISTS idx_verdicts_run ON clause_verdicts(projectRunId);
    CREATE INDEX IF NOT EXISTS idx_clauses_std ON clauses(standardVersion, level);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(createdAt);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entityType, entityId);
    CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(projectId, isLatest);
    `,
  },
  {
    id: 2,
    name: 'audit_log_append_only_triggers',
    sql: `
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit_logs is append-only: UPDATE is forbidden');
    END;
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'audit_logs is append-only: DELETE is forbidden');
    END;
    `,
  },
  {
    id: 3,
    name: 'command_runs_and_tool_commands',
    sql: `
    CREATE TABLE IF NOT EXISTS command_runs (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL DEFAULT 'default',
      toolId TEXT NOT NULL,
      toolName TEXT NOT NULL,
      commandId TEXT NOT NULL,
      commandName TEXT NOT NULL,
      projectId TEXT,
      clauseId TEXT,
      note TEXT,
      params TEXT NOT NULL DEFAULT '{}',
      resolvedCommand TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      exitCode INTEGER,
      durationMs INTEGER,
      stdoutFileRef TEXT,
      stderrFileRef TEXT,
      stdoutPreview TEXT,
      error TEXT,
      createdBy TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      finishedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cmd_runs_tool_created ON command_runs(toolId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_cmd_runs_project_created ON command_runs(projectId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_cmd_runs_status ON command_runs(status);
    `,
    run(database) {
      const cols = (database.prepare('PRAGMA table_info(tools)').all() as { name: string }[]).map(
        (c) => c.name,
      );
      if (!cols.includes('commands')) {
        database.exec("ALTER TABLE tools ADD COLUMN commands TEXT NOT NULL DEFAULT '[]'");
      }
    },
  },
  {
    id: 4,
    name: 'tool_setup_command',
    sql: ``,
    run(database) {
      const cols = (database.prepare('PRAGMA table_info(tools)').all() as { name: string }[]).map(
        (c) => c.name,
      );
      if (!cols.includes('setupCommand')) {
        database.exec('ALTER TABLE tools ADD COLUMN setupCommand TEXT');
      }
    },
  },
];

export function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT NOT NULL
    );
  `);
  const applied = new Set<number>(
    (database.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (!applied.has(m.id)) {
      const tx = database.transaction(() => {
        database.exec(m.sql);
        m.run?.(database);
        database
          .prepare('INSERT INTO _migrations (id, name, appliedAt) VALUES (?, ?, ?)')
          .run(m.id, m.name, new Date().toISOString());
      });
      tx();
      logger.info({ migration: m.name }, 'migration applied');
    }
  }
}
