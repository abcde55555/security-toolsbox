import type {
  ComplianceLevel,
  EvidenceType,
  ExecutionStatus,
  FailureStrategy,
  FieldFormat,
  FormFieldType,
  HealthStatus,
  InteractionMode,
  MatcherType,
  OnMatchAction,
  ReportFormat,
  ReportGrade,
  Severity,
  StepRunStatus,
  ToolCategory,
  ToolType,
  UserRole,
  VersionLockMode,
} from './enums.js';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  meta?: { paging?: Paging };
}

export interface ApiError {
  code: number;
  message: string;
  details?: unknown;
}

export interface Paging {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  placeholder?: string;
  required?: boolean;
  value?: unknown;
  description?: string;
  regex?: string;
  format?: FieldFormat;
  min?: number;
  max?: number;
  options?: Array<string | SelectOption>;
  accept?: string;
  maxSizeMb?: number;
  steps?: Array<{ title: string; fields: FormField[] }>;
}

export interface HealthCheckConfig {
  command: string;
  timeoutMs?: number;
}

export interface ModuleClauseDecl {
  clauseId: string;
  title: string;
  severity: Severity;
}

export interface ModuleConfig {
  id: string;
  name: string;
  version: string;
  sdkVersion: string;
  type: ToolType;
  interactionMode: InteractionMode;
  author?: string;
  description?: string;
  tags: string[];
  category: ToolCategory;
  healthCheck?: HealthCheckConfig;
  formFields: FormField[];
  clauses: ModuleClauseDecl[];
  path?: string;
  envVars?: Record<string, string>;
}

export interface Evidence {
  type: EvidenceType;
  content: string;
  severity: Severity;
  path?: string;
  hash?: string;
}

export interface ClauseVerdictOutput {
  clauseId: string;
  pass: boolean;
  reason: string;
  severity: Severity;
  evidenceRefs: number[];
}

export interface ExecutionError {
  code: string;
  message: string;
  stack?: string;
}

export interface ExecutionResult {
  runId: string;
  projectId?: string;
  stepId?: string;
  toolId?: string;
  moduleId?: string;
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  evidence: Evidence[];
  verdicts: ClauseVerdictOutput[];
  error?: ExecutionError;
}

export interface CommandProgress {
  percent?: number;
  message?: string;
  logLine?: string;
}

export interface CancelToken {
  promise: Promise<void>;
  isRequested: boolean;
}

export interface ModuleExecuteContext {
  projectId: string;
  stepId: string;
  userId: string;
  variables: Record<string, unknown>;
  onProgress: (p: CommandProgress) => void;
  cancelToken: CancelToken;
  engine: {
    runCommand: (
      command: string,
      opts?: {
        timeoutMs?: number;
        cwd?: string;
        env?: Record<string, string>;
        onProgress?: (p: CommandProgress) => void;
        cancelToken?: CancelToken;
      },
    ) => Promise<{
      status: ExecutionStatus;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }>;
  };
}

export interface BaseModule {
  readonly config: ModuleConfig;
  execute(params: Record<string, unknown>, context: ModuleExecuteContext): Promise<ExecutionResult>;
}

export interface Tool {
  id: string;
  workspaceId: string;
  name: string;
  type: ToolType;
  interactionMode: InteractionMode;
  version: string;
  sdkVersion?: string;
  author?: string;
  description?: string;
  tags: string[];
  category: ToolCategory;
  path?: string;
  envVars?: Record<string, string>;
  healthCheck?: HealthCheckConfig;
  formFields: FormField[];
  clauses: ModuleClauseDecl[];
  referenceCount: number;
  healthStatus: HealthStatus;
  healthMessage?: string;
  healthCheckedAt?: string;
  builtin: boolean;
  upgradePending?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface TemplateVariable {
  name: string;
  label: string;
  type: 'text' | 'number' | 'ip' | 'cidr' | 'list';
  required: boolean;
  default?: unknown;
  format?: FieldFormat;
}

export interface ExportVarRule {
  type: 'jsonpath' | 'regex' | 'field' | 'file';
  [key: string]: unknown;
}

export interface TemplateStep {
  stepId: string;
  title: string;
  toolId: string;
  toolVersion: string;
  interactionModeOverride?: InteractionMode;
  params: Record<string, unknown>;
  selectedCommands?: string[] | 'all';
  dependsOn: string[];
  onFailure: FailureStrategy;
  retry?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
  exportVars?: Record<string, ExportVarRule>;
  weight?: number;
  expandMode?: 'cartesian' | 'for_each_json';
  ephemeral?: boolean;
  position: number;
}

export interface TemplateToolRef {
  toolId: string;
  toolVersionLock: VersionLockMode;
  toolVersionSnapshot?: string;
  selectedCommands?: string[];
  stepParams?: Record<string, unknown>;
  upgradePending?: boolean;
}

export interface Template {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  schemaVersion: string;
  variables: TemplateVariable[];
  concurrencyLimit: number;
  steps: TemplateStep[];
  toolRefs: TemplateToolRef[];
  parentTemplateId?: string;
  inheritParent?: boolean;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  templateId: string;
  templateVersionSnapshot: number;
  standardVersion: string;
  targetComplianceLevel: ComplianceLevel;
  variables: Record<string, unknown>;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  deletedAt?: string;
}

export interface ProjectRun {
  id: string;
  projectId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  startedBy: string;
  progressPercent: number;
  eta?: string;
  triggerMode: string;
  cancelRequested: boolean;
  snapshotVariables: Record<string, unknown>;
}

export interface StepRun {
  id: string;
  projectRunId: string;
  stepId: string;
  stepSnapshot: TemplateStep;
  status: StepRunStatus;
  startedAt?: string;
  finishedAt?: string;
  retryOf?: string;
  exitCode?: number;
  stdoutFileRef?: string;
  stderrFileRef?: string;
  durationMs?: number;
  error?: ExecutionError;
  evidenceCount: number;
  verdictCount: number;
  percent: number;
}

export interface Clause {
  clauseId: string;
  standardVersion: string;
  chapter: string;
  title: string;
  description: string;
  level: ComplianceLevel;
  testingMethod?: string;
  defaultSeverity: Severity;
  parentId?: string;
  tags: string[];
}

export interface ClauseMappingRule {
  id: string;
  toolId: string;
  commandId?: string;
  clauseId: string;
  matcherType: MatcherType;
  pattern: string;
  onMatch: OnMatchAction;
  severityOverride?: Severity;
  priority: number;
}

export interface ClauseVerdict {
  id: string;
  stepRunId: string;
  projectRunId: string;
  projectId: string;
  clauseId: string;
  pass: boolean;
  severity: Severity;
  reason: string;
  evidenceRefs: string[];
  overridden: boolean;
  overrideReason?: string;
  verdictGroup: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface ReportSummary {
  applicable: number;
  pass: number;
  fail: number;
  notCovered: number;
  conditional: number;
  byChapter: Record<string, { total: number; pass: number; fail: number; notCovered: number }>;
  failBySeverity: { high: number; middle: number; low: number };
}

export interface Report {
  id: string;
  projectId: string;
  projectRunId?: string;
  format: ReportFormat;
  fileRef?: string;
  hash?: string;
  grade: ReportGrade;
  summary: ReportSummary;
  generatedBy: string;
  generatedAt: string;
  isLatest: boolean;
}

export interface User {
  id: string;
  workspaceId: string;
  username: string;
  email?: string;
  role: UserRole;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  workspaceId: string;
}

export const ERROR_CODES = {
  OK: 0,
  UNAUTHORIZED: 9001,
  FORBIDDEN: 9002,
  VALIDATION_FAILED: 9003,
  NOT_FOUND: 9004,
  CONFLICT: 9005,
  TOOL_REFERENCED: 1001,
  TEMPLATE_IN_USE: 2001,
  PROJECT_VARIABLES_MISSING: 3001,
  ORCHESTRATION_CYCLE: 4001,
  ORCHESTRATION_INVALID_STEP: 4002,
  TOOL_UNHEALTHY: 4003,
  CLAUSE_INVALID: 5001,
  REPORT_GENERATION_FAILED: 6001,
  INTERNAL: 9999,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
