import { api, requestPaged } from './client';
import type {
  Tool,
  Template,
  Project,
  ProjectRun,
  StepRun,
  Clause,
  ClauseNode,
  ClauseMappingRule,
  Standard,
  Report,
  AuditLog,
} from '@en18031/shared';

export interface StepRunDetail extends StepRun {
  evidences: Array<{ id: string; type: string; content: string; severity: string; fileRef?: string; hash?: string; createdAt: string }>;
  verdicts: Array<{ id: string; clauseId: string; pass: boolean; severity: string; reason: string; evidenceRefs: string[]; overridden: boolean; overrideReason?: string }>;
  stdout: string;
  stderr: string;
}

export interface ReportDetail {
  report: Report;
  project: Project;
  clauses: Array<Clause & { verdict: { id: string; pass: boolean; severity: string; reason: string; overridden: boolean } | null; evidences: unknown[] }>;
}

export const StandardsApi = {
  list: () => api.get<Standard[]>('/standards'),
  create: (body: unknown) => api.post<Standard>('/standards', body),
  update: (id: string, body: unknown) => api.put<Standard>(`/standards/${id}`, body),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/standards/${id}`),
};

export interface ToolCategoryInfo {
  key: string;
  label: string;
  sortOrder: number;
  builtin: boolean;
}

export const CategoriesApi = {
  list: () => api.get<ToolCategoryInfo[]>('/tool-categories'),
  create: (body: { key?: string; label: string }) => api.post<ToolCategoryInfo>('/tool-categories', body),
  update: (key: string, label: string) => api.put<ToolCategoryInfo>(`/tool-categories/${key}`, { label }),
  remove: (key: string) =>
    api.del<{ deleted: boolean; reassigned: number }>(`/tool-categories/${encodeURIComponent(key)}`),
  reorder: (key: string, dir: -1 | 1) =>
    api.post<ToolCategoryInfo[]>(`/tool-categories/${encodeURIComponent(key)}/reorder`, { dir }),
};

export const ToolsApi = {
  list: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    const qs = q.toString();
    return requestPaged<Tool>(`GET`, `/tools${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => api.get<Tool>(`/tools/${id}`),
  create: (body: Record<string, unknown>) => api.post<Tool>('/tools', body),
  update: (id: string, body: Record<string, unknown>) => api.put<Tool>(`/tools/${id}`, body),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/tools/${id}`),
  healthCheck: (id: string) => api.post<{ id: string; healthStatus: string }>(`/tools/${id}/health-check`),
  references: (id: string) => api.get<unknown[]>(`/tools/${id}/references`),
  verdictCapabilities: (id: string) =>
    api.get<{
      toolId: string;
      interactionMode: string;
      clauses: Array<{ clauseId: string; title: string; severity: string }>;
    }>(`/tools/${id}/verdict-capabilities`),
  testCommand: (body: {
    commandTemplate: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
    toolId?: string;
  }) =>
    api.post<{
      command: string;
      exitCode: number | null;
      status: string;
      stdout: string;
      stderr: string;
      durationMs: number;
      matchedRules: Array<{ clauseId: string; pattern: string; matcherType: string; onMatch: string }>;
    }>('/test-command', body),
};

export const TemplatesApi = {
  list: () => api.get<Template[]>('/templates'),
  get: (id: string) => api.get<Template>(`/templates/${id}`),
  create: (body: unknown) => api.post<Template>('/templates', body),
  update: (id: string, body: unknown) => api.put<Template>(`/templates/${id}`, body),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/templates/${id}`),
  clone: (id: string, newName: string, inheritParent = false) =>
    api.post<Template>(`/templates/${id}/clone`, { newName, inheritParent }),
  confirmUpgrade: (id: string, toolId: string, lock: boolean) =>
    api.post<Template>(`/templates/${id}/confirm-upgrade`, { toolId, lock }),
  coverage: (id: string, standardVersion?: string) =>
    api.get<TemplateCoverage>(
      `/templates/${id}/coverage${standardVersion ? `?standardVersion=${encodeURIComponent(standardVersion)}` : ''}`,
    ),
};

export interface TemplateCoverageItem {
  clauseId: string;
  toolId: string;
  toolName: string;
  via: 'module' | 'rule';
  title?: string;
  chapter?: string;
  level?: string;
}
export interface TemplateCoverage {
  templateId: string;
  standardVersion: string;
  total: number;
  coveredCount: number;
  coverage: number;
  covered: TemplateCoverageItem[];
  uncovered: Array<{ clauseId: string; title: string; chapter: string; level: string }>;
}

export const ProjectsApi = {
  list: () => api.get<Project[]>('/projects'),
  get: (id: string) => api.get<Project & { latestRun?: ProjectRun }>(`/projects/${id}`),
  create: (body: unknown) => api.post<Project>('/projects', body),
  update: (id: string, body: unknown) => api.put<Project>(`/projects/${id}`, body),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/projects/${id}`),
  getVariables: (id: string) => api.get<Record<string, unknown>>(`/projects/${id}/variables`),
  setVariables: (id: string, variables: Record<string, unknown>) =>
    api.put<Record<string, unknown>>(`/projects/${id}/variables`, { variables }),
  listRuns: (id: string) => api.get<ProjectRun[]>(`/projects/${id}/runs`),
  getRun: (id: string, runId: string) => api.get<ProjectRun>(`/projects/${id}/runs/${runId}`),
  startRun: (id: string, body: unknown = {}) => api.post<ProjectRun>(`/projects/${id}/runs`, body),
  cancelRun: (id: string, runId: string) =>
    api.post<{ runId: string; cancelRequested: boolean }>(`/projects/${id}/runs/${runId}/cancel`),
  retryStep: (id: string, runId: string, stepRunId: string) =>
    api.post<StepRun>(`/projects/${id}/runs/${runId}/steps/${stepRunId}/retry`),
  listSteps: (id: string, runId: string) => api.get<StepRun[]>(`/projects/${id}/runs/${runId}/steps`),
  getStep: (id: string, runId: string, stepRunId: string) =>
    api.get<StepRunDetail>(`/projects/${id}/runs/${runId}/steps/${stepRunId}`),
  logs: (id: string, params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set('page', params.page ?? '1');
    q.set('pageSize', params.pageSize ?? '100');
    const qs = q.toString();
    return requestPaged<AuditLog>('GET', `/projects/${id}/logs?${qs}`);
  },
  executeModule: (projectId: string, toolId: string, body: unknown) =>
    api.post<{ runId: string; stepRunId: string; status: string }>(
      `/projects/${projectId}/tools/${toolId}/execute-module`,
      body,
    ),
  preflight: (id: string) =>
    api.get<PreflightResult>(`/projects/${id}/preflight`),
};

export interface PreflightTool {
  toolId: string;
  name: string;
  stepId: string;
  available: boolean;
  healthStatus: string;
  message?: string;
  skippable: boolean;
}
export interface PreflightResult {
  ready: boolean;
  variables: { ok: boolean; missing: string[]; empty: string[] };
  tools: PreflightTool[];
  skippedSteps: string[];
  warnings: string[];
}

export const ClausesApi = {
  list: (standardVersion = 'EN18031:2019', level?: string, chapter?: string) => {
    let qs = `?standardVersion=${standardVersion}`;
    if (level) qs += `&level=${level}`;
    if (chapter) qs += `&chapter=${encodeURIComponent(chapter)}`;
    return api.get<Clause[]>(`/clauses${qs}`);
  },
  get: (clauseId: string, standardVersion = 'EN18031:2019') =>
    api.get<Clause>(`/clauses/${clauseId}?standardVersion=${standardVersion}`),
  create: (body: unknown, standardVersion = 'EN18031:2019') =>
    api.post<Clause>(`/clauses?standardVersion=${standardVersion}`, body),
  update: (clauseId: string, body: unknown, standardVersion = 'EN18031:2019') =>
    api.put<Clause>(`/clauses/${clauseId}?standardVersion=${standardVersion}`, body),
  remove: (clauseId: string, standardVersion = 'EN18031:2019') =>
    api.del<{ clauseId: string; deleted: boolean }>(`/clauses/${clauseId}?standardVersion=${standardVersion}`),
  tree: (standardVersion = 'EN18031:2019') =>
    api.get<ClauseNode[]>(`/clauses/tree?standardVersion=${standardVersion}`),
  batchImport: (clauses: unknown[]) => api.post<{ imported: number }>('/clauses/batch-import', clauses),
  mappingRules: (toolId?: string) =>
    api.get<ClauseMappingRule[]>(`/clause-mapping-rules${toolId ? `?toolId=${toolId}` : ''}`),
  createMappingRule: (body: unknown) => api.post<ClauseMappingRule>('/clause-mapping-rules', body),
  deleteMappingRule: (id: string) => api.del<{ id: string; deleted: boolean }>(`/clause-mapping-rules/${id}`),
  overrideVerdict: (id: string, pass: boolean, reason: string) =>
    api.post<{ id: string; pass: boolean; reason: string }>(`/clause-verdicts/${id}/override`, { pass, reason }),
};

export interface CommandRunDetail {
  id: string;
  toolId: string;
  toolName: string;
  commandId: string;
  commandName: string;
  projectId?: string | null;
  clauseId?: string | null;
  note?: string;
  params: Record<string, unknown>;
  resolvedCommand: string;
  status: string;
  exitCode?: number;
  durationMs?: number;
  stdoutPreview?: string;
  stdout: string;
  stderr: string;
  error?: { code: string; message: string; stack?: string };
  createdBy: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
}

export const CommandRunsApi = {
  start: (toolId: string, commandId: string, body: unknown) =>
    api.post<{ runId: string }>(`/tools/${toolId}/commands/${commandId}/run`, body),
  cancel: (runId: string) =>
    api.post<{ runId: string; cancelRequested: boolean }>(`/command-runs/${runId}/cancel`),
  list: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    const qs = q.toString();
    return requestPaged<CommandRunDetail>(`GET`, `/command-runs${qs ? `?${qs}` : ''}`);
  },
  get: (runId: string) => api.get<CommandRunDetail>(`/command-runs/${runId}`),
  attach: (runId: string, body: { projectId: string; clauseId?: string; note?: string }) =>
    api.post<CommandRunDetail>(`/command-runs/${runId}/attach`, body),
};

export const UploadApi = {
  upload: async (file: File, onProgress?: (percent: number) => void): Promise<{ path: string; url?: string; size: number }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.open('POST', '/api/upload');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && json.code === 0) {
            resolve(json.data);
          } else {
            reject(new Error(json.message || `上传失败 (${xhr.status})`));
          }
        } catch {
          reject(new Error(`上传失败 (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      xhr.send(form);
    });
  },
};

export const AuditLogsApi = {
  list: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    const qs = q.toString();
    return requestPaged<AuditLog>('GET', `/audit-logs${qs ? `?${qs}` : ''}`);
  },
};

export const ReportsApi = {
  list: (projectId: string) => api.get<Report[]>(`/projects/${projectId}/reports`),
  latest: (projectId: string) => api.get<Report | null>(`/projects/${projectId}/reports/latest`),
  generate: (projectId: string, runId?: string) =>
    api.post<Report>(`/projects/${projectId}/reports`, { runId }),
  detail: (projectId: string, reportId: string) =>
    api.get<ReportDetail>(`/projects/${projectId}/reports/${reportId}`),
  html: (projectId: string, reportId: string) =>
    `/api/projects/${projectId}/reports/${reportId}/html`,
  exportExcel: async (projectId: string, reportId: string) => {
    const r = await api.post<{ filePath: string; fileName: string }>(
      `/projects/${projectId}/reports/${reportId}/export`,
      {},
    );
    return r;
  },
  downloadUrl: (projectId: string, reportId: string) =>
    `/api/projects/${projectId}/reports/${reportId}/download`,
  jsonUrl: (projectId: string, reportId: string) =>
    `/api/projects/${projectId}/reports/${reportId}/json`,
};
