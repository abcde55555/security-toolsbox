import type {
  AgentEventType,
  AgentPhase,
  AgentSessionStatus,
  CommandRunStatus,
  ComplianceLevel,
  EvidenceType,
  ExecutionStatus,
  FailureStrategy,
  FieldFormat,
  FormFieldType,
  HealthStatus,
  InteractionMode,
  MatcherType,
  NotificationStatus,
  NotificationType,
  OnMatchAction,
  ProjectMode,
  ReportFormat,
  ReportGrade,
  Severity,
  SkillStatus,
  StepRunStatus,
  StepType,
  ToolCategory,
  ToolType,
  UserRole,
  VerdictReviewStatus,
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

export interface ToolCommand {
  id: string;
  name: string;
  description?: string;
  commandTemplate: string;
  params: FormField[];
  rawParams?: string[];
  outputTips?: string;
  relatedClauses?: string[];
  timeoutMs?: number;
  workingDir?: string;
  envVars?: Record<string, string>;
  requiresRoot?: boolean;
  platforms?: Array<'linux' | 'darwin' | 'win32'>;
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
  stream?: 'stdout' | 'stderr';
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
  /** Category key; built-in keys are in TOOL_CATEGORIES, custom keys allowed. */
  category: string;
  path?: string;
  envVars?: Record<string, string>;
  setupCommand?: string;
  healthCheck?: HealthCheckConfig;
  formFields: FormField[];
  clauses: ModuleClauseDecl[];
  commands?: ToolCommand[];
  referenceCount: number;
  healthStatus: HealthStatus;
  healthMessage?: string;
  healthCheckedAt?: string;
  builtin: boolean;
  upgradePending?: boolean;
  revision: number;
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

/**
 * How a single step's execution result maps to a pass/fail signal for its
 * clause. Module tools return their own verdicts; command tools use these
 * rules against their exit code / output.
 */
export type StepVerdictRule =
  | {
      kind: 'module';
      /** Module returns multiple verdicts; use the one whose clauseId matches. */
      mapClauseId?: string;
    }
  | {
      kind: 'command';
      passOnExitCode?: number;
      passOnOutputContains?: string;
      passOnOutputRegex?: string;
      failOnExitCode?: number;
      failOnOutputContains?: string;
      failOnOutputRegex?: string;
      severity?: Severity;
    };

/** How the steps under a clause combine into the clause verdict. */
export type ClauseAggregation =
  | {
      /** Independent/parallel checks; combine by a voting strategy. */
      mode: 'cross_check';
      strategy: 'all_pass' | 'any_pass' | 'any_fail' | 'majority';
      /** Fallback severity when a step fails but produces no specific one. */
      severity?: Severity;
    }
  | {
      /**
       * Sequential chain: steps run in dependsOn order, outputs flow between
       * them. A single final condition evaluates the combined results. If an
       * upstream step fails, dependents are skipped and the clause fails.
       */
      mode: 'chain';
      finalVerdict: FinalVerdictRule;
    };

/** Simple, visual final-verdict condition for a chain (P1; expressions later). */
export interface FinalVerdictRule {
  /** All these conditions must hold for the clause to pass. */
  passAll?: FinalCondition[];
  /** Any of these fails the clause. */
  failAny?: FinalCondition[];
  severity?: Severity;
  reason?: string;
}

export type FinalCondition =
  | { type: 'exit_code'; step: string; op: 'eq' | 'ne'; value: number }
  | { type: 'output_contains'; step: string; value: string; negate?: boolean }
  | { type: 'output_regex'; step: string; value: string; negate?: boolean };

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
  /**
   * for_each_json 展开源：取该**项目变量**（数组或 JSON 数组字符串）逐项展开，
   * 每项注入实例变量 item（元素）与 index（0 起序号）。v0.5 起真实生效。
   */
  expandSource?: string;
  /** cartesian 展开：参与笛卡尔积的项目变量名列表，元素同时以变量名与 item.<名> 暴露。 */
  expandDims?: string[];
  ephemeral?: boolean;
  position: number;
  /** Clause this step contributes to. NULL in ad-hoc mode. */
  clauseId?: string | null;
  /** How this step's result is judged for its clause (compliance mode). */
  verdictRule?: StepVerdictRule | null;
  /**
   * Steps with the same non-empty groupKey under a clause share one execution
   * (cached result), so a tool whose output feeds multiple checks runs once.
   */
  groupKey?: string | null;
}

/** A clause selected for coverage in a compliance-mode template. */
export interface TemplateClauseBinding {
  clauseId: string;
  enabled: boolean;
  position: number;
  aggregation: ClauseAggregation;
}

export type TemplateMode = 'ad-hoc' | 'compliance';

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
  /** ad-hoc: free-form tool list; compliance: steps are grouped under clauses. */
  mode: TemplateMode;
  variables: TemplateVariable[];
  concurrencyLimit: number;
  steps: TemplateStep[];
  toolRefs: TemplateToolRef[];
  /** Clauses selected for coverage (compliance mode). Aggregation per clause. */
  clauseBindings: TemplateClauseBinding[];
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
  // Agent 扩展
  stepType?: StepType;
  phase?: AgentPhase;
  functionModule?: string;
  instruction?: string;
  expectedOutcome?: string;
  artifacts?: string[];
  agentSessionId?: string;
}

export interface Standard {
  /** Stable identifier used as `clauses.standardVersion`, e.g. "EN18031:2019". */
  id: string;
  /** Short code, e.g. "EN18031". */
  code: string;
  name: string;
  version: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
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
  /** Applicable EN parts, e.g. ["-1","-2","-3"]. Empty = all. */
  applicableParts?: string[];
}

/** A clause with its direct children resolved, for tree rendering. */
export interface ClauseNode extends Clause {
  children?: ClauseNode[];
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
  // Agent 审核扩展
  reviewStatus?: VerdictReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  aiGenerated?: boolean;
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
  /** AI narrative (conclusion/risks/remediation) generated with narrativeModel; absent until ready. */
  narrative?: string;
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

export interface CommandRun {
  id: string;
  workspaceId: string;
  toolId: string;
  toolName: string;
  commandId: string;
  commandName: string;
  projectId?: string | null;
  clauseId?: string | null;
  note?: string;
  params: Record<string, unknown>;
  resolvedCommand: string;
  status: CommandRunStatus;
  exitCode?: number;
  durationMs?: number;
  stdoutFileRef?: string;
  stderrFileRef?: string;
  stdoutPreview?: string;
  error?: ExecutionError;
  createdBy: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommandRunDetail extends CommandRun {
  stdout: string;
  stderr: string;
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

// ===== Agent / AI =====

export interface AgentSession {
  id: string;
  projectId: string;
  projectRunId?: string;
  deviceProfile: Record<string, unknown>;
  selectedClauses: string[];
  authorizedTools: string[];
  phase: AgentPhase;
  status: AgentSessionStatus;
  planningModel?: string;
  narrativeModel?: string;
  currentStepId?: string;
  rollbackCount: number;
  lastError?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface AgentEvent {
  id: string;
  sessionId: string;
  seq: number;
  type: AgentEventType;
  role?: string;
  content?: string;
  contentFileRef?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: string;
  stepRunId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  createdAt: string;
}

export interface Artifact {
  id: string;
  projectId: string;
  projectRunId?: string;
  agentSessionId?: string;
  type: 'device_profile' | 'network_topology' | 'onboarding_result' | 'other';
  title?: string;
  content?: string;
  fileRefs: string[];
  functionModule?: string;
  createdBy: string;
  createdAt: string;
}

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  attachments: string[];
  sourceType: 'manual' | 'url' | 'case';
  sourceUrl?: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  skillKey: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  sourceNoteIds: string[];
  sourceCaseIds: string[];
  version: number;
  isCurrent: boolean;
  status: SkillStatus;
  author: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  reason?: string;
  payload: Record<string, unknown>;
  sessionId?: string;
  projectId?: string;
  status: NotificationStatus;
  readAt?: string;
  snoozedUntil?: string;
  actedAt?: string;
  createdBy: string;
  createdAt: string;
}

// ===== Settings / AI Providers =====

/** A configurable LLM provider (OpenAI-compatible endpoint). */
export interface AiProviderConfig {
  id: string;
  /** Display name, e.g. "DeepSeek", "OpenAI", "本地 vLLM". */
  name: string;
  /**
   * Protocol. 'openai' covers DeepSeek, OpenAI, vLLM, Ollama (/v1),
   * Moonshot, Together, etc. 'anthropic' reserved for future.
   */
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  /** Secret key. Never returned in full by the API; masked. */
  apiKey?: string;
  /** Model used for planning / complex reasoning. */
  planningModel: string;
  /** Model used for short tasks (report narrative, skill compile). */
  narrativeModel: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** Max retries on 429/5xx. */
  maxRetries: number;
  /**
   * 每次请求的默认 max_tokens（可选）。推理型模型（reasoning_content 计入预算）
   * 需要给大（建议 ≥8000），否则思考耗尽预算导致空正文。
   */
  maxTokens?: number;
  /** Whether this provider is the active one. */
  isActive: boolean;
  /** Whether the key passes a format/length sanity check (not an auth test). */
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating/updating a provider; apiKey optional on update. */
export type AiProviderInput = Omit<AiProviderConfig, 'id' | 'hasKey' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  /** On update, omit to keep the existing key. */
  apiKey?: string;
};
