#!/usr/bin/env node
// End-to-end smoke test: template -> project -> run -> verdicts -> report -> excel.
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3000';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const health = await (await fetch(BASE + '/api/health')).json();
  console.log('health:', health.data.status);

  const tools = await api('GET', '/api/tools?pageSize=50');
  const portTool = tools.find((t) => t.id === 'en18031-port-check');
  if (!portTool) throw new Error('en18031-port-check tool not found - run seed first');
  console.log('tool health:', portTool.id, portTool.healthStatus);

  const tpl = await api('POST', '/api/templates', {
    name: `SMOKE 端口合规模板 ${Date.now()}`,
    description: '冒烟测试自动创建',
    variables: [],
    concurrencyLimit: 1,
    toolRefs: [
      { toolId: portTool.id, toolVersionLock: 'follow', selectedCommands: 'all' },
    ],
    steps: [
      {
        stepId: 'port-scan',
        title: '端口合规扫描',
        toolId: portTool.id,
        toolVersion: portTool.version,
        params: {
          targetIp: '127.0.0.1',
          portRange: '22,80,443',
          scanType: 'sT',
          timeoutMs: 60000,
          includeServiceVersion: true,
        },
        dependsOn: [],
        onFailure: 'continue',
      },
    ],
  });
  console.log('template created:', tpl.id, tpl.name);

  const project = await api('POST', '/api/projects', {
    name: `SMOKE 项目 ${Date.now()}`,
    description: '冒烟测试',
    templateId: tpl.id,
    standardVersion: 'EN18031:2019',
    targetComplianceLevel: 'L2',
    variables: {},
  });
  console.log('project created:', project.id, project.name);

  const run = await api('POST', `/api/projects/${project.id}/runs`, {});
  console.log('run started:', run.id);

  const terminal = new Set(['success', 'fail', 'partial', 'cancelled', 'timeout', 'crash']);
  let runState;
  for (let i = 0; i < 120; i++) {
    runState = await api('GET', `/api/projects/${project.id}/runs/${run.id}`);
    process.stdout.write(`\r  run status: ${runState.status} ${runState.progressPercent ?? 0}%   `);
    if (terminal.has(runState.status)) break;
    await sleep(1500);
  }
  console.log('\nrun finished:', runState.status);

  const steps = await api('GET', `/api/projects/${project.id}/runs/${run.id}/steps`);
  for (const s of steps) {
    const detail = await api('GET', `/api/projects/${project.id}/runs/${run.id}/steps/${s.id}`);
    console.log(`  step ${s.stepId}: ${s.status} exit=${s.exitCode} evidence=${detail.evidences.length} verdicts=${detail.verdicts?.length ?? 0}`);
    for (const v of (detail.verdicts ?? [])) {
      console.log(`    - ${v.clauseId}: ${v.pass ? 'PASS' : 'FAIL'} (${v.severity}) ${v.reason}`);
    }
  }

  const report = await api('POST', `/api/projects/${project.id}/reports`, { runId: run.id });
  console.log('report:', report.id, report.grade, 'applicable=', report.summary.applicable, 'pass=', report.summary.pass, 'fail=', report.summary.fail);

  const exported = await api('POST', `/api/projects/${project.id}/reports/${report.id}/export`, {});
  console.log('excel exported:', exported.fileName);

  console.log('\nSMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
