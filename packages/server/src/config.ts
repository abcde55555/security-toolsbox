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
  allowedHosts: string[];
  uploadMaxBytes: number;
  ai: AiConfig;
}

export interface AiConfig {
  enabled: boolean;
  provider: 'deepseek' | 'scripted';
  baseUrl: string;
  apiKey: string;
  planningModel: string;
  narrativeModel: string;
  timeoutMs: number;
  maxRetries: number;
  /** Per-tool-call / step timeout for human steps (ms). */
  humanStepTimeoutMs: number;
  /** Hard cap on planner iterations per session to prevent runaway loops. */
  maxIterations: number;
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
  host: env('HOST', '0.0.0.0'),
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
  allowedHosts: env('ALLOWED_HOSTS', 'localhost,127.0.0.1,::1')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
  uploadMaxBytes: envInt('UPLOAD_MAX_BYTES', 200 * 1024 * 1024),
  ai: {
    enabled: envBool('AI_ENABLED', false),
    provider: (env('AI_PROVIDER', 'deepseek') as 'deepseek' | 'scripted') === 'scripted' ? 'scripted' : 'deepseek',
    baseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    apiKey: env('DEEPSEEK_API_KEY', ''),
    planningModel: env('AI_PLANNING_MODEL', 'deepseek-chat'),
    narrativeModel: env('AI_NARRATIVE_MODEL', 'deepseek-chat'),
    timeoutMs: envInt('AI_TIMEOUT_MS', 60_000),
    maxRetries: envInt('AI_MAX_RETRIES', 2),
    humanStepTimeoutMs: envInt('AGENT_HUMAN_STEP_TIMEOUT_MS', 30 * 60 * 1000),
    maxIterations: envInt('AGENT_MAX_ITERATIONS', 50),
  },
};

for (const dir of [
  path.dirname(config.dbPath),
  config.filesDir,
  config.reportsDir,
  config.logsDir,
  path.join(config.filesDir, 'evidence'),
  path.join(config.filesDir, 'tmp'),
  path.join(config.filesDir, 'cmdruns'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}
