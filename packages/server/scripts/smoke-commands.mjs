#!/usr/bin/env node
// Smoke test for the command-manual workbench:
// create a custom ping tool -> run a command -> poll to terminal -> attach to project.
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
const TERMINAL = new Set(['success', 'fail', 'timeout', 'crash', 'cancelled']);

async function main() {
  const health = await (await fetch(BASE + '/api/health')).json();
  console.log('health:', health.data.status);

  const id = `smoke-ping-${Date.now()}`;
  const tool = await api('POST', '/api/tools', {
    id,
    name: `冒烟 Ping ${Date.now()}`,
    type: 'custom',
    interactionMode: 'cmd',
    version: '1.0.0',
    category: 'network-compliance',
    tags: ['smoke'],
    commands: [
      {
        id: 'ping',
        name: 'Ping',
        commandTemplate: 'ping -c {{count}} {{target}}',
        timeoutMs: 30000,
        outputTips: '看 packets transmitted / received',
        params: [
          { id: 'count', label: '次数', type: 'number', required: true, value: 1, min: 1, max: 5 },
          { id: 'target', label: '目标', type: 'text', required: true, value: '127.0.0.1' },
        ],
      },
    ],
  });
  console.log('tool created:', tool.id, 'commands=', tool.commands.length);

  const { runId } = await api('POST', `/api/tools/${tool.id}/commands/ping/run`, {
    params: { count: 1, target: '127.0.0.1' },
  });
  console.log('run started:', runId);

  let run;
  for (let i = 0; i < 40; i++) {
    run = await api('GET', `/api/command-runs/${runId}`);
    process.stdout.write(`\r  status: ${run.status} exit=${run.exitCode ?? '-'}   `);
    if (TERMINAL.has(run.status)) break;
    await sleep(1000);
  }
  console.log('\nrun finished:', run.status);

  if (run.status !== 'success' || run.exitCode !== 0) {
    throw new Error(`expected success/0, got ${run.status}/${run.exitCode}`);
  }
  if (!run.stdout.includes('packets transmitted')) {
    throw new Error('stdout missing "packets transmitted": ' + run.stdout.slice(0, 400));
  }
  console.log('stdout ok:', run.stdout.split('\n')[0]);

  const tpl = await api('POST', '/api/templates', {
    name: `SMOKE 命令挂载模板 ${Date.now()}`,
    variables: [],
    concurrencyLimit: 1,
    toolRefs: [],
    steps: [],
  });
  const project = await api('POST', '/api/projects', {
    name: `SMOKE 命令挂载项目 ${Date.now()}`,
    templateId: tpl.id,
    standardVersion: 'EN18031:2019',
    targetComplianceLevel: 'L2',
    variables: {},
  });

  await api('POST', `/api/command-runs/${runId}/attach`, {
    projectId: project.id,
    note: '冒烟证据',
  });
  const listed = await api('GET', `/api/command-runs?projectId=${project.id}`);
  console.log('attached runs for project:', listed.length);
  if (!listed.some((r) => r.id === runId)) throw new Error('attached run not found by projectId');

  console.log('\nSMOKE COMMANDS OK');
}

main().catch((e) => {
  console.error('SMOKE COMMANDS FAILED:', e.message);
  process.exit(1);
});
