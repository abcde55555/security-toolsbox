export const EXECUTION_STATUSES = [
  'success',
  'fail',
  'timeout',
  'crash',
  'partial',
  'cancelled',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const STEP_RUN_STATUSES = [
  'pending',
  'scheduled',
  'running',
  'success',
  'fail',
  'fail_abort_triggered',
  'skipped',
  'timeout',
  'cancelled',
  'partial',
] as const;
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];

export const PROJECT_RUN_STATUSES = [
  'pending',
  'running',
  'success',
  'fail',
  'partial',
  'cancelled',
  'aborted',
] as const;
export type ProjectRunStatus = (typeof PROJECT_RUN_STATUSES)[number];

export const PROJECT_STATUSES = [
  'draft',
  'running',
  'success',
  'fail',
  'partial',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const HEALTH_STATUSES = ['green', 'yellow', 'red', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const TOOL_TYPES = ['module', 'custom'] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const INTERACTION_MODES = ['form', 'cmd'] as const;
export type InteractionMode = (typeof INTERACTION_MODES)[number];

export const VERSION_LOCK_MODES = ['locked', 'follow'] as const;
export type VersionLockMode = (typeof VERSION_LOCK_MODES)[number];

export const FAILURE_STRATEGIES = ['abort', 'continue', 'retry'] as const;
export type FailureStrategy = (typeof FAILURE_STRATEGIES)[number];

export const COMPLIANCE_LEVELS = ['L1', 'L2', 'L3'] as const;
export type ComplianceLevel = (typeof COMPLIANCE_LEVELS)[number];

export const SEVERITIES = ['high', 'middle', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const USER_ROLES = ['admin', 'template_manager', 'auditor', 'anonymous'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EVIDENCE_TYPES = [
  'stdout_line',
  'assertion',
  'validation_error',
  'file_pointer',
  'screenshot',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const FORM_FIELD_TYPES = [
  'text',
  'number',
  'textarea',
  'select',
  'checkbox',
  'multiselect',
  'file',
  'stepper',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FIELD_FORMATS = [
  'plain',
  'ip',
  'cidr',
  'port-range',
  'hostname',
  'path',
] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

export const MATCHER_TYPES = ['regex', 'contains', 'js-expression'] as const;
export type MatcherType = (typeof MATCHER_TYPES)[number];

export const ON_MATCH_ACTIONS = ['verdict-pass', 'verdict-fail', 'evidence-only'] as const;
export type OnMatchAction = (typeof ON_MATCH_ACTIONS)[number];

export const REPORT_FORMATS = ['pdf', 'excel', 'snapshot'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const REPORT_GRADES = ['PASS', 'CONDITIONAL_PASS', 'FAIL', 'INCOMPLETE'] as const;
export type ReportGrade = (typeof REPORT_GRADES)[number];

export const COMMAND_RUN_STATUSES = [
  'pending',
  'running',
  'success',
  'fail',
  'timeout',
  'crash',
  'cancelled',
] as const;
export type CommandRunStatus = (typeof COMMAND_RUN_STATUSES)[number];

export const TOOL_CATEGORIES = [
  'network-compliance',
  'crypto-compliance',
  'credential-compliance',
  'firmware-analysis',
  'authentication',
  'reconnaissance',
  'device-interaction',
  'other',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

// ---- Agent / AI 相关 ----

export const AGENT_PHASES = ['onboarding', 'collection', 'adjudication', 'review'] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export const AGENT_SESSION_STATUSES = [
  'planning',
  'running',
  'waiting_human',
  'waiting_confirm',
  'review',
  'done',
  'aborted',
  'error',
] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export const STEP_TYPES = ['tool_exec', 'human_instruction', 'evidence_attach', 'analysis'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const VERDICT_REVIEW_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'skipped',
] as const;
export type VerdictReviewStatus = (typeof VERDICT_REVIEW_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'tool_sediment',
  'skill_sediment',
  'evidence_gap',
  'template_save',
  'config_fix',
  'review_hint',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = ['unread', 'read', 'accepted', 'dismissed', 'snoozed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const AGENT_EVENT_TYPES = [
  'model_message',
  'tool_call',
  'tool_result',
  'human_step',
  'phase_change',
  'verdict_draft',
  'notification',
  'error',
  'user_message',
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const SKILL_STATUSES = ['draft', 'approved', 'archived'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const PROJECT_MODES = ['template', 'agent_guided'] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];
