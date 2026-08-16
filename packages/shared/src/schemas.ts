import { z } from 'zod';
import type { FormField } from './types.js';
import {
  COMMAND_RUN_STATUSES,
  COMPLIANCE_LEVELS,
  EVIDENCE_TYPES,
  EXECUTION_STATUSES,
  FAILURE_STRATEGIES,
  FIELD_FORMATS,
  FORM_FIELD_TYPES,
  HEALTH_STATUSES,
  INTERACTION_MODES,
  MATCHER_TYPES,
  ON_MATCH_ACTIONS,
  REPORT_FORMATS,
  SEVERITIES,
  TOOL_CATEGORIES,
  TOOL_TYPES,
  USER_ROLES,
  VERSION_LOCK_MODES,
} from './enums.js';

export const ipV4Regex =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const cidrRegex =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\/(3[0-2]|[12]?\d)$/;
export const portRangeRegex =
  /^(\d{1,5}(-\d{1,5})?)(,\d{1,5}(-\d{1,5})?)*$/;

export function isValidIp(s: string): boolean {
  return ipV4Regex.test(s);
}
export function isValidCidr(s: string): boolean {
  return cidrRegex.test(s);
}
export function isValidPortRange(s: string): boolean {
  if (!portRangeRegex.test(s)) return false;
  return s.split(',').every((part) => {
    const [a, b] = part.split('-').map(Number);
    if (a < 1 || a > 65535) return false;
    if (b !== undefined) {
      if (b < 1 || b > 65535 || b < a) return false;
    }
    return true;
  });
}
export function isValidHostname(s: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    s,
  );
}

export function validateFieldFormat(format: string | undefined, value: unknown): string | null {
  if (format === undefined || format === 'plain' || value === undefined || value === null || value === '') {
    return null;
  }
  const str = String(value);
  switch (format) {
    case 'ip':
      return isValidIp(str) ? null : '不是合法的 IPv4 地址';
    case 'cidr':
      return isValidCidr(str) ? null : '不是合法的 CIDR (x.x.x.x/n)';
    case 'port-range':
      return isValidPortRange(str) ? null : '不是合法的端口范围 (如 1-65535 或 22,80,443)';
    case 'hostname':
      return isValidHostname(str) ? null : '不是合法的主机名';
    case 'path':
      return str.length > 0 ? null : '路径不能为空';
    default:
      return null;
  }
}

export const severitySchema = z.enum(SEVERITIES);
export const executionStatusSchema = z.enum(EXECUTION_STATUSES);
export const healthStatusSchema = z.enum(HEALTH_STATUSES);
export const complianceLevelSchema = z.enum(COMPLIANCE_LEVELS);
export const toolTypeSchema = z.enum(TOOL_TYPES);
export const interactionModeSchema = z.enum(INTERACTION_MODES);
export const versionLockSchema = z.enum(VERSION_LOCK_MODES);
export const failureStrategySchema = z.enum(FAILURE_STRATEGIES);
export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export const formFieldTypeSchema = z.enum(FORM_FIELD_TYPES);
export const fieldFormatSchema = z.enum(FIELD_FORMATS);
export const matcherTypeSchema = z.enum(MATCHER_TYPES);
export const onMatchSchema = z.enum(ON_MATCH_ACTIONS);
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export const userRoleSchema = z.enum(USER_ROLES);
export const toolCategorySchema = z.enum(TOOL_CATEGORIES);

const selectOptionSchema = z.union([z.string(), z.object({ label: z.string(), value: z.string() })]);

type FormFieldShape = {
  id: string;
  label: string;
  type: (typeof FORM_FIELD_TYPES)[number];
  placeholder?: string;
  required?: boolean;
  value?: unknown;
  description?: string;
  regex?: string;
  format?: (typeof FIELD_FORMATS)[number];
  min?: number;
  max?: number;
  options?: Array<string | { label: string; value: string }>;
  accept?: string;
  maxSizeMb?: number;
  steps?: Array<{ title: string; fields: FormFieldShape[] }>;
};

export const formFieldSchema: z.ZodType<FormFieldShape> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string(),
    type: formFieldTypeSchema,
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    value: z.unknown().optional(),
    description: z.string().optional(),
    regex: z.string().optional(),
    format: fieldFormatSchema.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(selectOptionSchema).optional(),
    accept: z.string().optional(),
    maxSizeMb: z.number().optional(),
    steps: z
      .array(z.object({ title: z.string(), fields: z.array(formFieldSchema) }))
      .optional(),
  }),
);

export const moduleClauseDeclSchema = z.object({
  clauseId: z.string().min(1),
  title: z.string(),
  severity: severitySchema,
});

export const healthCheckConfigSchema = z.object({
  command: z.string(),
  timeoutMs: z.number().optional(),
});

export const moduleConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  sdkVersion: z.string().default('^1.0.0'),
  type: toolTypeSchema,
  interactionMode: interactionModeSchema,
  author: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  category: toolCategorySchema,
  healthCheck: healthCheckConfigSchema.optional(),
  formFields: z.array(formFieldSchema),
  clauses: z.array(moduleClauseDeclSchema),
  path: z.string().optional(),
  envVars: z.record(z.string()).optional(),
});

export const commandRunStatusSchema = z.enum(COMMAND_RUN_STATUSES);

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;
function placeholdersOf(tpl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

export const toolCommandSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    commandTemplate: z.string().min(1),
    params: z.array(formFieldSchema),
    rawParams: z.array(z.string().min(1)).optional(),
    outputTips: z.string().optional(),
    relatedClauses: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    workingDir: z.string().optional(),
    envVars: z.record(z.string()).optional(),
    requiresRoot: z.boolean().optional(),
    platforms: z.array(z.enum(['linux', 'darwin', 'win32'])).optional(),
  })
  .superRefine((cmd, ctx) => {
    const ids = new Set<string>();
    const dupes = new Set<string>();
    for (const p of cmd.params) {
      if (ids.has(p.id)) dupes.add(p.id);
      ids.add(p.id);
    }
    dupes.forEach((id) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `参数 id 重复: ${id}`,
        path: ['params'],
      });
    });
    const placeholders = placeholdersOf(cmd.commandTemplate);
    for (const ph of placeholders) {
      if (!ids.has(ph)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `占位符 {{${ph}}} 没有对应的参数定义`,
          path: ['commandTemplate'],
        });
      }
    }
    const raw = cmd.rawParams ?? [];
    for (const r of raw) {
      if (!ids.has(r)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `rawParams 中的 "${r}" 不是已定义的参数 id`,
          path: ['rawParams'],
        });
      }
    }
  });

export const toolCommandsSchema = z.array(toolCommandSchema);

export const customToolCreateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  type: toolTypeSchema.default('custom'),
  interactionMode: interactionModeSchema.default('cmd'),
  version: z.string().min(1).default('1.0.0'),
  category: toolCategorySchema.default('other'),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  path: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  setupCommand: z.string().max(2000).optional(),
  healthCheck: healthCheckConfigSchema.optional(),
  commands: toolCommandsSchema.default([]),
});

export const customToolUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  category: toolCategorySchema.optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  path: z.string().nullable().optional(),
  envVars: z.record(z.string()).nullable().optional(),
  setupCommand: z.string().max(2000).nullable().optional(),
  healthCheck: healthCheckConfigSchema.nullable().optional(),
  commands: toolCommandsSchema.optional(),
});

export const commandRunStartSchema = z.object({
  params: z.record(z.unknown()).default({}),
  projectId: z.string().optional(),
  clauseId: z.string().optional(),
  note: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const commandRunAttachSchema = z.object({
  projectId: z.string().min(1),
  clauseId: z.string().optional(),
  note: z.string().optional(),
});

export function validateFormValues(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.id];
    const isEmpty =
      v === undefined ||
      v === null ||
      v === '' ||
      (Array.isArray(v) && v.length === 0);
    if (f.required && isEmpty) {
      errors[f.id] = '此项必填';
      continue;
    }
    if (isEmpty) continue;
    if (typeof v === 'string' || typeof v === 'number') {
      const fmtErr = validateFieldFormat(f.format, v);
      if (fmtErr) {
        errors[f.id] = fmtErr;
        continue;
      }
    }
    if (f.regex && typeof v === 'string') {
      try {
        if (!new RegExp(f.regex).test(v)) {
          errors[f.id] = `格式不匹配 /${f.regex}/`;
          continue;
        }
      } catch {
        errors[f.id] = '参数正则无效';
        continue;
      }
    }
    if (typeof v === 'number' || (typeof v === 'string' && f.type === 'number' && v !== '')) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isNaN(n)) {
        if (f.min !== undefined && n < f.min) errors[f.id] = `不能小于 ${f.min}`;
        if (f.max !== undefined && n > f.max) errors[f.id] = `不能大于 ${f.max}`;
      }
    }
  }
  return errors;
}

export const evidenceSchema = z.object({
  type: evidenceTypeSchema,
  content: z.string(),
  severity: severitySchema,
  path: z.string().optional(),
  hash: z.string().optional(),
});

export const verdictOutputSchema = z.object({
  clauseId: z.string().min(1),
  pass: z.boolean(),
  reason: z.string(),
  severity: severitySchema,
  evidenceRefs: z.array(z.number().int().nonnegative()),
});

export const executionErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});

export const executionResultSchema = z.object({
  runId: z.string(),
  projectId: z.string().optional(),
  stepId: z.string().optional(),
  toolId: z.string().optional(),
  moduleId: z.string().optional(),
  status: executionStatusSchema,
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
  startedAt: z.string(),
  finishedAt: z.string(),
  evidence: z.array(evidenceSchema),
  verdicts: z.array(verdictOutputSchema),
  error: executionErrorSchema.optional(),
});

export function validateExecutionResult(raw: unknown): {
  valid: boolean;
  errors: string[];
  data?: z.infer<typeof executionResultSchema>;
} {
  const parsed = executionResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const errors: string[] = [];
  const data = parsed.data;
  data.verdicts.forEach((v, i) => {
    if (v.evidenceRefs.length === 0) {
      errors.push(`verdicts[${i}] (${v.clauseId}): evidenceRefs 不能为空`);
    }
    v.evidenceRefs.forEach((ref) => {
      if (ref >= data.evidence.length) {
        errors.push(`verdicts[${i}] (${v.clauseId}): evidenceRefs[${ref}] 越界 (evidence.length=${data.evidence.length})`);
      }
    });
    if (v.pass && v.severity === 'high') {
      errors.push(`verdicts[${i}] (${v.clauseId}): pass=true 不允许 severity=high`);
    }
  });
  return { valid: errors.length === 0, errors, data };
}

export function sanitizeAndEnforceResult(
  raw: unknown,
  fallbackRunId: string,
): { result: z.infer<typeof executionResultSchema>; warnings: string[] } {
  const warnings: string[] = [];
  let base = raw as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null) base = {};

  const evidence = Array.isArray(base.evidence) ? base.evidence : [];
  const verdicts = Array.isArray(base.verdicts) ? base.verdicts : [];

  const fixedVerdicts = verdicts.map((v: Record<string, unknown>) => {
    const refs = Array.isArray(v.evidenceRefs) ? (v.evidenceRefs as number[]) : [];
    let pass = Boolean(v.pass);
    let severity = (v.severity as string) || 'middle';
    let reason = String(v.reason || '');
    if (refs.length === 0 || refs.some((r) => r >= evidence.length)) {
      warnings.push(`verdict ${v.clauseId}: evidenceRefs 无效，已降级为 fail`);
      pass = false;
      severity = 'high';
      reason = reason || '判定缺失证据';
    }
    if (pass && severity === 'high') {
      warnings.push(`verdict ${v.clauseId}: pass=true+severity=high 已改为 middle`);
      severity = 'middle';
    }
    return {
      clauseId: String(v.clauseId || 'unknown'),
      pass,
      reason,
      severity: severity as 'high' | 'middle' | 'low',
      evidenceRefs: refs.filter((r) => r < evidence.length),
    };
  });

  const result = {
    runId: String(base.runId || fallbackRunId),
    projectId: base.projectId as string | undefined,
    stepId: base.stepId as string | undefined,
    toolId: base.toolId as string | undefined,
    moduleId: base.moduleId as string | undefined,
    status: (base.status as string) || 'crash',
    exitCode: typeof base.exitCode === 'number' ? base.exitCode : 1,
    stdout: String(base.stdout ?? ''),
    stderr: String(base.stderr ?? ''),
    durationMs: typeof base.durationMs === 'number' ? base.durationMs : 0,
    startedAt: String(base.startedAt || new Date().toISOString()),
    finishedAt: String(base.finishedAt || new Date().toISOString()),
    evidence,
    verdicts: fixedVerdicts,
    error: base.error as z.infer<typeof executionErrorSchema> | undefined,
  } as z.infer<typeof executionResultSchema>;

  if (!EXECUTION_STATUSES.includes(result.status as (typeof EXECUTION_STATUSES)[number])) {
    warnings.push(`非法 status=${result.status}，已降级为 crash`);
    result.status = 'crash';
  }
  return { result, warnings };
}
