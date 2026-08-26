// helpers 必须最先导入：它把 DB_PATH/STORAGE_LOCAL_DIR 指到临时目录，
// 之后任何触发 config.ts 求值的导入都会拿到测试专用路径。
import './helpers.js';
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createInMemoryRepositories, type Repositories } from '../repositories/index.js';
import { buildWorkbench, deriveNextSuggestion } from '../services/workbenchService.js';
import { projectRoutes } from '../routes/projects.js';
import { getServices } from '../services/index.js';
import { nowIso } from '@en18031/shared';

// ---- 数据构造辅助（全部走现有 repo 写入接口） ----

function makeProject(repos: Repositories, name: string) {
  return repos.projects.create({
    name,
    templateId: 'agent',
    templateVersionSnapshot: 1,
    standardVersion: 'EN18031:2019',
    targetComplianceLevel: 'L1',
    variables: {},
    createdBy: 'tester',
  });
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

describe('workbench nextSuggestion 分支', () => {
  it('无会话 → create_session', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-空项目');
      const wb = buildWorkbench(repos, p.id);
      expect(wb.sessions).toHaveLength(0);
      expect(wb.humanTodos).toHaveLength(0);
      expect(wb.verdictDrafts).toHaveLength(0);
      expect(wb.evidenceCount).toBe(0);
      expect(wb.nextSuggestion.action).toBe('create_session');
      expect(wb.latestReport).toBeNull();
      expect(wb.latestRun).toBeNull();
    } finally {
      close();
    }
  });

  it('waiting_human + 未完成人工步骤 → handle_human_todos（含 todo 定位与每会话计数）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-人工待办');
      const { session, run } = makeSessionWithRun(repos, p.id);
      repos.agent.updateStatus(session.id, 'waiting_human');
      addHumanStep(repos, { sessionId: session.id, projectRunId: run.id });

      const wb = buildWorkbench(repos, p.id);
      expect(wb.humanTodos).toHaveLength(1);
      expect(wb.humanTodos[0].sessionId).toBe(session.id);
      expect(wb.sessions[0].status).toBe('waiting_human');
      expect(wb.sessions[0].pendingHumanStepCount).toBe(1);
      expect(wb.nextSuggestion.action).toBe('handle_human_todos');
      expect(wb.nextSuggestion.sessionId).toBe(session.id);
      expect(wb.nextSuggestion.todoStepRunId).toBe(wb.humanTodos[0].stepRunId);
    } finally {
      close();
    }
  });

  it('会话运行中 → follow_session；且优先级高于判定草案审核', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-进行中');
      const { session, run } = makeSessionWithRun(repos, p.id);
      repos.agent.updateStatus(session.id, 'running');
      repos.agent.updatePhase(session.id, 'adjudication'); // schema 触发器要求判定产生于 adjudication 阶段
      const step = repos.projects.createAgentStepRun({
        projectRunId: run.id,
        stepId: 'collect-1',
        stepSnapshot: {},
        stepType: 'tool_exec',
        phase: 'collection',
        agentSessionId: session.id,
      });
      addVerdictDraft(repos, { projectId: p.id, projectRunId: run.id, stepRunId: step.id });

      const wb = buildWorkbench(repos, p.id);
      expect(wb.verdictDrafts).toHaveLength(1); // 草案存在
      expect(wb.nextSuggestion.action).toBe('follow_session');
      expect(wb.nextSuggestion.sessionId).toBe(session.id);
    } finally {
      close();
    }
  });

  it('有判定草案且无进行中会话 → review_verdicts（优先于查看报告）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-待审核');
      const { session, run } = makeSessionWithRun(repos, p.id);
      repos.agent.finish(session.id, 'done');
      repos.agent.updatePhase(session.id, 'adjudication'); // schema 触发器要求判定产生于 adjudication 阶段
      const step = repos.projects.createAgentStepRun({
        projectRunId: run.id,
        stepId: 'adjudicate-1',
        stepSnapshot: {},
        stepType: 'analysis',
        phase: 'adjudication',
        agentSessionId: session.id,
      });
      addVerdictDraft(repos, { projectId: p.id, projectRunId: run.id, stepRunId: step.id });
      // 已有报告也不影响：审核排在查看报告之前
      repos.reports.save({
        projectId: p.id,
        format: 'snapshot',
        grade: 'FAIL',
        summary: EMPTY_SUMMARY,
        generatedBy: 'tester',
      });

      const wb = buildWorkbench(repos, p.id);
      expect(wb.verdictDrafts).toHaveLength(1);
      expect(wb.latestReport).not.toBeNull();
      expect(wb.nextSuggestion.action).toBe('review_verdicts');
      expect(wb.nextSuggestion.verdictId).toBe(wb.verdictDrafts[0].id);
    } finally {
      close();
    }
  });

  it('已完成且有最新报告 → view_report（携带 reportId 与证据计数）', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-已完成');
      const { session, run } = makeSessionWithRun(repos, p.id);
      repos.agent.finish(session.id, 'done');
      const step = repos.projects.createAgentStepRun({
        projectRunId: run.id,
        stepId: 'evidence-1',
        stepSnapshot: {},
        stepType: 'evidence_attach',
        phase: 'collection',
        agentSessionId: session.id,
      });
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
      const report = repos.reports.save({
        projectId: p.id,
        format: 'pdf',
        grade: 'PASS',
        summary: EMPTY_SUMMARY,
        generatedBy: 'tester',
      });

      const wb = buildWorkbench(repos, p.id);
      expect(wb.evidenceCount).toBe(3);
      expect(wb.latestReport?.id).toBe(report.id);
      expect(wb.nextSuggestion.action).toBe('view_report');
      expect(wb.nextSuggestion.reportId).toBe(report.id);
    } finally {
      close();
    }
  });

  it('只剩 aborted 会话且无报告 → 兜底建议新建会话', () => {
    const { repos, close } = createInMemoryRepositories();
    try {
      const p = makeProject(repos, 'WB-已中止');
      const { session } = makeSessionWithRun(repos, p.id);
      repos.agent.finish(session.id, 'aborted');

      const wb = buildWorkbench(repos, p.id);
      expect(wb.nextSuggestion.action).toBe('create_session');
    } finally {
      close();
    }
  });

  it('deriveNextSuggestion 纯函数：waiting_human 优先于 follow_session', () => {
    const s = deriveNextSuggestion({
      sessions: [
        { id: 's-running', status: 'running', phase: 'collection' },
        { id: 's-wait', status: 'waiting_human', phase: 'collection' },
      ],
      humanTodos: [
        {
          stepRunId: 'sr-1',
          sessionId: 's-wait',
          sessionName: 'x',
          instruction: 'y',
          phase: null,
          updatedAt: '',
        },
      ],
      verdictDrafts: [],
      latestReport: null,
    });
    expect(s.action).toBe('handle_human_todos');
    expect(s.sessionId).toBe('s-wait');

    // 无待办但状态为 waiting_human 时也能给出建议（降级只给 sessionId）
    const s2 = deriveNextSuggestion({
      sessions: [{ id: 's-wait2', status: 'waiting_human', phase: 'review' }],
      humanTodos: [],
      verdictDrafts: [],
      latestReport: null,
    });
    expect(s2.action).toBe('handle_human_todos');
    expect(s2.sessionId).toBe('s-wait2');
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
    expect(body.data.nextSuggestion.action).toBe('create_session');
    await app.close();
  });

  it('同一项目的数据变化会反映在聚合结果中（创建会话后建议切换）', async () => {
    const app = await buildApp();
    const repos = getServices().repos;
    const p = makeProject(repos, `WB-HTTP2-${Date.now()}`);

    const before = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/workbench` })).body,
    );
    expect(before.data.nextSuggestion.action).toBe('create_session');

    const { session } = makeSessionWithRun(repos, p.id);
    // planning 状态属于“进行中”
    const after = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/projects/${p.id}/workbench` })).body,
    );
    expect(after.data.sessions.map((s: { id: string }) => s.id)).toContain(session.id);
    expect(after.data.nextSuggestion.action).toBe('follow_session');
    expect(after.data.nextSuggestion.sessionId).toBe(session.id);
    await app.close();
  });
});
