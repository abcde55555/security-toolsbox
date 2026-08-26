// helpers 必须最先导入：它把 DB_PATH/STORAGE_LOCAL_DIR 指到临时目录，
// 之后任何触发 config.ts 求值的导入都会拿到测试专用路径。
import './helpers.js';
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createInMemoryRepositories, type Repositories } from '../repositories/index.js';
import { buildWorkbench, deriveNextSuggestion } from '../services/workbenchService.js';
import { projectRoutes } from '../routes/projects.js';
import { getServices } from '../services/index.js';
import type { TemplateVariable } from '@en18031/shared';
import { nowIso } from '@en18031/shared';

// ---- 数据构造辅助（全部走现有 repo 写入接口） ----

function makeProject(repos: Repositories, name: string, opts: { templateId?: string; variables?: Record<string, unknown> } = {}) {
  return repos.projects.create({
    name,
    templateId: opts.templateId ?? 'ghost-template', // 无对应模板行 → R6/R7 跳过
    templateVersionSnapshot: 1,
    standardVersion: 'EN18031:2019',
    targetComplianceLevel: 'L1',
    variables: opts.variables ?? {},
    createdBy: 'tester',
  });
}

/** 建一个带必填变量与一个步骤的真实模板；varsFilled=false 时项目留空必填变量。 */
function makeTemplateProject(repos: Repositories, name: string, opts: { fillVars?: boolean; withToolStep?: boolean } = {}) {
  const variables: TemplateVariable[] = [
    { name: 'target_ip', label: '目标 IP', type: 'ip', required: true },
  ];
  const steps = opts.withToolStep
    ? [
        {
          stepId: 's1',
          title: '扫描',
          toolId: 'no-such-tool',
          toolVersion: '1.0.0',
          params: {},
          dependsOn: [],
          onFailure: 'continue' as const,
          position: 0,
        },
      ]
    : [];
  const tpl = repos.templates.create({ name: `${name}-tpl`, variables, steps, createdBy: 'tester' });
  const project = makeProject(repos, name, {
    templateId: tpl.id,
    variables: opts.fillVars === false ? {} : { target_ip: '10.0.0.1' },
  });
  return { tpl, project };
}

function makeSessionWithRun(repos: Repositories, projectId: string) {
  const session = repos.agent.createSession({ projectId, createdBy: 'tester' });
  const run = repos.projects.createRun({
    projectId,
    startedBy: 'tester',
    snapshotVariables: {},
    triggerMode: 'agent',
  });
  repos.agent.setProjectRunId(session.id, run.id);
  return { session, run };
}

function addHumanStep(
  repos: Repositories,
  opts: { sessionId: string; projectRunId: string; instruction?: string },
) {
  const step = repos.projects.createAgentStepRun({
    projectRunId: opts.projectRunId,
    stepId: `human-${opts.instruction ?? 'step'}`,
    stepSnapshot: {},
    stepType: 'human_instruction',
    phase: 'collection',
    agentSessionId: opts.sessionId,
    instruction: opts.instruction ?? '请插入 U 盘并拍照',
  });
  repos.projects.updateStepRun(step.id, { status: 'running', startedAt: nowIso() });
  return step;
}

function addVerdictDraft(
  repos: Repositories,
  opts: { projectId: string; projectRunId: string; stepRunId: string; clauseId?: string },
) {
  return repos.results.insertVerdict({
    stepRunId: opts.stepRunId,
    projectRunId: opts.projectRunId,
    projectId: opts.projectId,
    clauseId: opts.clauseId ?? 'GEC-1',
    pass: true,
    severity: 'low',
    reason: 'AI 判定草案，等待人工确认',
    evidenceRefs: [],
    verdictGroup: `agent:test:${opts.clauseId ?? 'GEC-1'}`,
    reviewStatus: 'pending_review',
    aiGenerated: true,
  });
}

const EMPTY_SUMMARY = {
  applicable: 0,
  pass: 0,
  fail: 0,
  notCovered: 0,
  conditional: 0,
  byChapter: {},
  failBySeverity: { high: 0, middle: 0, low: 0 },
};

describe('workbench nextSuggestion：§4.3 八级优先级分支', () => {
  it('R8 兜底：无模板/无 run/无会话 → agent_or_config', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-R8');
      const wb = buildWorkbench(repos, p.id);
      expect(wb.sessions).toHaveLength(0);
      expect(wb.humanTodos).toHaveLength(0);
      expect(wb.verdictDrafts).toHaveLength(0);
      expect(wb.evidenceCount).toBe(0);
      expect(wb.latestReport).toBeNull();
      expect(wb.latestRun).toBeNull();
      expect(wb.nextSuggestion.priority).toBe(8);
      expect(wb.nextSuggestion.action).toBe('agent_or_config');
    } finally {
      close();
    }
  });

  it('R7 无 run 且预检就绪 → start_run', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const { project } = makeTemplateProject(repos, 'WB-R7'); // 必填变量已填
      const wb = buildWorkbench(repos, project.id);
      expect(wb.nextSuggestion.priority).toBe(7);
      expect(wb.nextSuggestion.action).toBe('start_run');
      expect(wb.nextSuggestion.templateId).toBeTruthy();
    } finally {
      close();
    }
  });

  it('R6 预检有缺口 → fix_preflight（缺变量 / 工具缺口都计数）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      // 缺必填变量
      const a = makeTemplateProject(repos, 'WB-R6a', { fillVars: false });
      const wba = buildWorkbench(repos, a.project.id);
      expect(wba.nextSuggestion.priority).toBe(6);
      expect(wba.nextSuggestion.action).toBe('fix_preflight');
      expect(wba.nextSuggestion.missingVariables).toContain('target_ip');
      expect(wba.nextSuggestion.gapCount).toBeGreaterThanOrEqual(1);

      // 变量已填但步骤引用的工具缺失
      const b = makeTemplateProject(repos, 'WB-R6b', { withToolStep: true });
      const wbb = buildWorkbench(repos, b.project.id);
      expect(wbb.nextSuggestion.action).toBe('fix_preflight');
      expect(wbb.nextSuggestion.missingVariables).toEqual([]);
      expect(wbb.nextSuggestion.gapCount).toBe(1);
    } finally {
      close();
    }
  });

  it('R1a 模板编排存在非终态 run → monitor_run（含 runId 与百分比）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const { project } = makeTemplateProject(repos, 'WB-R1a');
      const run = repos.projects.createRun({
        projectId: project.id,
        startedBy: 'tester',
        snapshotVariables: {},
      });
      repos.projects.updateRun(run.id, { progressPercent: 40 });

      const wb = buildWorkbench(repos, project.id);
      expect(wb.nextSuggestion.priority).toBe(1);
      expect(wb.nextSuggestion.action).toBe('monitor_run');
      expect(wb.nextSuggestion.runId).toBe(run.id);
      expect(wb.nextSuggestion.percent).toBe(40);
      expect(wb.nextSuggestion.title).toContain('40%');
    } finally {
      close();
    }
  });

  it('R1b agent 会话活跃 → monitor_run 定位会话；waiting_human 让位 R2（agent run 不算运行中）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      // 活跃 planning 会话：其 run 行也是非终态，但建议应指向会话
      const p1 = makeProject(repos, 'WB-R1b');
      const s1 = makeSessionWithRun(repos, p1.id);
      const wb1 = buildWorkbench(repos, p1.id);
      expect(wb1.latestRun?.status).toBe('running'); // run 行确实非终态
      expect(wb1.nextSuggestion.priority).toBe(1);
      expect(wb1.nextSuggestion.action).toBe('monitor_run');
      expect(wb1.nextSuggestion.sessionId).toBe(s1.session.id);
      expect(wb1.nextSuggestion.runId).toBeUndefined();

      // waiting_human + 待办：run 行非终态但不算“运行中”，让位 R2
      const p2 = makeProject(repos, 'WB-R2-precedence');
      const s2 = makeSessionWithRun(repos, p2.id);
      repos.agent.updateStatus(s2.session.id, 'waiting_human');
      addHumanStep(repos, { sessionId: s2.session.id, projectRunId: s2.run.id });
      const wb2 = buildWorkbench(repos, p2.id);
      expect(wb2.humanTodos).toHaveLength(1);
      expect(wb2.sessions[0].pendingHumanStepCount).toBe(1);
      expect(wb2.nextSuggestion.priority).toBe(2);
      expect(wb2.nextSuggestion.action).toBe('handle_human_todos');
      expect(wb2.nextSuggestion.sessionId).toBe(s2.session.id);
      expect(wb2.nextSuggestion.todoStepRunId).toBe(wb2.humanTodos[0].stepRunId);
    } finally {
      close();
    }
  });

  it('R3 有判定草案且无更高优先级事项 → review_verdicts（先于生成报告）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-R3');
      const { session, run } = makeSessionWithRun(repos, p.id);
      repos.agent.finish(session.id, 'done');
      repos.agent.updatePhase(session.id, 'adjudication'); // schema 触发器要求判定产生于 adjudication 阶段
      repos.projects.updateRun(run.id, { status: 'success', finishedAt: nowIso() }); // 收尾 run，排除 R1/R4 干扰
      const step = repos.projects.createAgentStepRun({
        projectRunId: run.id,
        stepId: 'adjudicate-1',
        stepSnapshot: {},
        stepType: 'analysis',
        phase: 'adjudication',
        agentSessionId: session.id,
      });
      addVerdictDraft(repos, { projectId: p.id, projectRunId: run.id, stepRunId: step.id });

      const wb = buildWorkbench(repos, p.id);
      expect(wb.verdictDrafts).toHaveLength(1);
      expect(wb.nextSuggestion.priority).toBe(3);
      expect(wb.nextSuggestion.action).toBe('review_verdicts');
      expect(wb.nextSuggestion.verdictCount).toBe(1);
      expect(wb.nextSuggestion.verdictId).toBe(wb.verdictDrafts[0].id);
    } finally {
      close();
    }
  });

  it('R4 报告缺失或过期 → generate_report；报告新鲜则落到兜底（R5 服务端不产出）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-R4');
      const run = repos.projects.createRun({
        projectId: p.id,
        startedBy: 'tester',
        snapshotVariables: {},
      });
      const finishedAt = new Date(Date.now() - 60_000).toISOString();
      repos.projects.updateRun(run.id, { status: 'success', finishedAt });

      // 缺报告
      const wbMissing = buildWorkbench(repos, p.id);
      expect(wbMissing.nextSuggestion.priority).toBe(4);
      expect(wbMissing.nextSuggestion.action).toBe('generate_report');
      expect(wbMissing.nextSuggestion.reportId).toBeUndefined();

      // 过期报告（generatedAt 早于 run 收尾时间）
      repos.reports.save({ projectId: p.id, format: 'snapshot', grade: 'FAIL', summary: EMPTY_SUMMARY, generatedBy: 'tester' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (repos.reports as any).db as import('better-sqlite3').Database;
      db.prepare("UPDATE reports SET generatedAt=? WHERE projectId=?").run(
        new Date(Date.now() - 120_000).toISOString(),
        p.id,
      );
      const wbStale = buildWorkbench(repos, p.id);
      expect(wbStale.nextSuggestion.action).toBe('generate_report');

      // 新鲜报告（generatedAt 晚于 run 收尾）→ 跳过 R4；R5 无导出标记不产出 → 兜底 R8
      db.prepare("UPDATE reports SET generatedAt=? WHERE projectId=?").run(nowIso(), p.id);
      const wbFresh = buildWorkbench(repos, p.id);
      expect(wbFresh.latestReport).not.toBeNull();
      expect(wbFresh.nextSuggestion.action).not.toBe('generate_report');
      expect(wbFresh.nextSuggestion.action).not.toBe('export_report');
      expect(wbFresh.nextSuggestion.priority).toBe(8);
    } finally {
      close();
    }
  });

  it('deriveNextSuggestion 纯函数：R5 export_report 永不由服务端返回', () => {
    const s = deriveNextSuggestion({
      runs: [],
      sessions: [],
      humanTodos: [],
      verdictDrafts: [],
      latestReport: { id: 'r1', generatedAt: nowIso() },
      preflightGaps: null,
      templateId: null,
    });
    expect(s.action).not.toBe('export_report');
    expect(s.priority).toBe(8);
  });
});

describe('GET /api/projects/:id/workbench 路由', () => {
  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(projectRoutes);
    return app;
  }

  it('返回聚合信封结构；项目不存在时 404/9004', async () => {
    const app = await buildApp();
    const repos = getServices().repos;

    const missing = await app.inject({ method: 'GET', url: '/api/projects/no-such-id/workbench' });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.body).code).toBe(9004);

    const p = makeProject(repos, `WB-HTTP-${Date.now()}`);
    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/workbench` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.code).toBe(0);
    expect(body.message).toBe('ok');
    expect(body.data.project.id).toBe(p.id);
    expect(body.data.latestRun).toBeNull();
    expect(Array.isArray(body.data.sessions)).toBe(true);
    expect(Array.isArray(body.data.humanTodos)).toBe(true);
    expect(Array.isArray(body.data.verdictDrafts)).toBe(true);
    expect(typeof body.data.evidenceCount).toBe('number');
    expect(body.data.nextSuggestion.action).toBe('agent_or_config');
    expect(body.data.nextSuggestion.priority).toBe(8);
    await app.close();
  });

  it('同一项目的数据变化会反映在聚合结果中（创建活跃会话后建议切换）', async () => {
    const app = await buildApp();
    const repos = getServices().repos;
    const p = makeProject(repos, `WB-HTTP2-${Date.now()}`);

    const before = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/workbench` })).body,
    );
    expect(before.data.nextSuggestion.action).toBe('agent_or_config');

    const { session } = makeSessionWithRun(repos, p.id); // planning 属于活跃会话
    const after = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/workbench` })).body,
    );
    expect(after.data.sessions.map((s: { id: string }) => s.id)).toContain(session.id);
    expect(after.data.nextSuggestion.action).toBe('monitor_run');
    expect(after.data.nextSuggestion.sessionId).toBe(session.id);
    await app.close();
  });

  it('证据与待办计数随数据增长（evidenceCount / pendingHumanStepCount）', async () => {
    const app = await buildApp();
    const repos = getServices().repos;
    const p = makeProject(repos, `WB-HTTP3-${Date.now()}`);
    const { session, run } = makeSessionWithRun(repos, p.id);
    repos.agent.updateStatus(session.id, 'waiting_human');
    const step = addHumanStep(repos, { sessionId: session.id, projectRunId: run.id });
    for (let i = 0; i < 3; i++) {
      repos.results.insertEvidence({
        stepRunId: step.id,
        projectRunId: run.id,
        projectId: p.id,
        type: 'file_pointer',
        content: `证据 ${i}`,
        severity: 'low',
        sourceStepType: 'evidence_attach',
      });
    }

    const res = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/workbench` });
    const body = JSON.parse(res.body);
    expect(body.data.evidenceCount).toBe(3);
    expect(body.data.humanTodos).toHaveLength(1);
    expect(body.data.nextSuggestion.priority).toBe(2);
    await app.close();
  });
});
