import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  dataDir: string;
  dbPath: string;
  filesDir: string;
  reportsDir: string;
  logsDir: string;
  jwtSecret: string;
  authEnabled: boolean;
  workspaceDefault: string;
  executionConcurrency: number;
  executionTimeoutMs: number;
  logLevel: string;
  webDistDir: string;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  return '';
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

const repoRoot = path.resolve(__dirname, '../../..');
const defaultDataDir = path.join(repoRoot, 'data');

export const config: AppConfig = {
  port: envInt('PORT', 3000),
  host: env('HOST', '127.0.0.1'),
  nodeEnv: env('NODE_ENV', 'development'),
  dataDir: env('DATA_DIR', defaultDataDir),
  dbPath: env('DB_PATH', path.join(defaultDataDir, 'sqlite', 'app.db')),
  filesDir: env('STORAGE_LOCAL_DIR', path.join(defaultDataDir, 'files')),
  reportsDir: env('REPORTS_DIR', path.join(defaultDataDir, 'reports')),
  logsDir: env('LOG_DIR', path.join(defaultDataDir, 'logs')),
  jwtSecret: env('JWT_SECRET', 'dev-insecure-secret-change-me'),
  authEnabled: envBool('AUTH_ENABLED', false),
  workspaceDefault: env('WORKSPACE_ID_DEFAULT', 'default'),
  executionConcurrency: envInt('EXECUTION_CONCURRENCY_DEFAULT', 2),
  executionTimeoutMs: envInt('EXECUTION_TIMEOUT_DEFAULT_MS', 30 * 60 * 1000),
  logLevel: env('LOG_LEVEL', 'info'),
  webDistDir: env('WEB_DIST_DIR', path.resolve(repoRoot, 'packages/web/dist')),
};

for (const dir of [
  path.dirname(config.dbPath),
  config.filesDir,
  config.reportsDir,
  config.logsDir,
  path.join(config.filesDir, 'evidence'),
  path.join(config.filesDir, 'tmp'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}
