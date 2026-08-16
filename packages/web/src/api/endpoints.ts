import { api, requestPaged } from './client';
import type {
  Tool,
  Template,
  Project,
  ProjectRun,
  StepRun,
  Clause,
  ClauseMappingRule,
  Report,
  AuditLog,
} from '@en18031/shared';

export interface StepRunDetail extends StepRun {
  evidences: Array<{ id: string; type: string; content: string; severity: string; fileRef?: string; hash?: string; createdAt: string }>;
  verdicts: Array<{ id: string; clauseId: string; pass: boolean; severity: string; reason: string; evidenceRefs: string[]; overridden: boolean }>;
  stdout: string;
  stderr: string;
}

export interface ReportDetail {
  report: Report;
  project: Project;
  clauses: Array<Clause & { verdict: { id: string; pass: boolean; severity: string; reason: string; overridden: boolean } | null; evidences: unknown[] }>;
}

export const ToolsApi = {
  list: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    const qs = q.toString();
    return requestPaged<Tool>(`GET`, `/tools${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => api.get<Tool>(`/tools/${id}`),
  create: (body: Partial<Tool>) => api.post<Tool>('/tools', body),
  update: (id: string, body: Partial<Tool>) => api.put<Tool>(`/tools/${id}`, body),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/tools/${id}`),
  healthCheck: (id: string) => api.post<{ id: string; healthStatus: string }>(`/tools/${id}/health-check`),
  references: (id: string) => api.get<unknown[]>(`/tools/${id}/references`),
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
};

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
};

export const ClausesApi = {
  list: (standardVersion = 'EN18031:2019', level?: string) =>
    api.get<Clause[]>(`/clauses?standardVersion=${standardVersion}${level ? `&level=${level}` : ''}`),
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
};
