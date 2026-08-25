/**
 * 会话自动驱动器：等待 AI 规划循环推进；遇到人机步骤自动以合理说明完成；
 * 终态后汇总判定与工件。用于真实模型验收（推理模型单调用 30-90s）。
 */
const BASE = 'http://127.0.0.1:3100';
const sid = process.argv[2];
if (!sid) { console.error('usage: node scripts/drive-session.mjs <sessionId>'); process.exit(1); }

const api = async (path, init) => (await fetch(BASE + path, init)).json();
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

let round = 0;
const started = Date.now();
while (Date.now() - started < 12 * 60 * 1000) {
  round++;
  const s = (await api(`/api/agent/sessions/${sid}`)).data;
  process.stdout.write(`[r${round}] ${s.status}/${s.phase}\n`);
  if (['done', 'error', 'aborted'].includes(s.status)) {
    console.log('终态:', s.status, s.lastError ?? '');
    break;
  }
  if (s.status === 'waiting_human') {
    const steps = (await api(`/api/agent/sessions/${sid}/steps`)).data ?? [];
    const pending = steps.find((x) => x.stepType === 'human_instruction' && ['running', 'pending'].includes(x.status));
    if (pending) {
      const r = await post(`/api/agent/sessions/${sid}/human-steps/${pending.id}/complete`, {
        note: '工程师已按要求完成本项操作，结果符合预期，请继续。',
      });
      console.log(`  完成人机步骤 ${pending.id.slice(0, 8)} → code=${r.code}`);
    } else if (round % 3 === 0) {
      await post(`/api/agent/sessions/${sid}/messages`, { content: '请继续当前阶段的采集与判定工作；若信息足够请进入 adjudication 给出条款 5.1 / 5.1-1 的判定草稿。' });
      console.log('  已发送催进消息');
    }
  }
  await new Promise((r) => setTimeout(r, 20000));
}

// 汇总
const s = (await api(`/api/agent/sessions/${sid}`)).data;
console.log('\n==== 汇总 ====');
console.log('最终状态:', s.status, '| 阶段:', s.phase);
const projId = s.projectId;
const pv = await api(`/api/agent/projects/${projId}/pending-verdicts`).catch(() => ({ data: [] }));
const verdicts = pv.data ?? [];
console.log('待审判定:', verdicts.length);
for (const v of verdicts.slice(0, 8)) console.log(`  [${v.clauseId}] pass=${v.pass} sev=${v.severity} | ${(v.reason ?? '').slice(0, 70)}`);
