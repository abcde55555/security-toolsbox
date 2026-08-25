/**
 * 真实 Agent 全链路验收 + 任务一 WS 实测：
 * 打开会话详情页（真实加房）→ 页面内触发 start → 监听 WebSocket 帧，
 * 统计 agent:* 实时事件；随后轮询会话状态直至终态/超时。
 */
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:3100';
const sessionId = process.argv[2];
if (!sessionId) { console.error('usage: node scripts/live-agent-e2e.mjs <sessionId>'); process.exit(1); }

const counts = new Map();
const samples = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('websocket', (ws) => {
  console.log(`[WS] 连接: ${ws.url()}`);
  ws.on('framereceived', (data) => {
    const payload = typeof data === 'string' ? data : String(data?.payload ?? data ?? '');
    const m = /42\["(agent:[a-z_]+)"/.exec(payload);
    if (m) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      if (samples.length < 6) samples.push(payload.slice(0, 160));
    }
  });
});

await page.goto(`${BASE}/agent/${sessionId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 页面内触发启动（同源）
const startRes = await page.evaluate(async (sid) => {
  const r = await fetch(`/api/agent/sessions/${sid}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { code: (await r.json()).code };
}, sessionId);
console.log(`[启动] code=${startRes.code}`);

// 监听 6 分钟
for (let i = 0; i < 36; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(async (sid) => {
    const d = await (await fetch(`/api/agent/sessions/${sid}`)).json();
    return { status: d.data.status, phase: d.data.phase, currentStep: d.data.currentStepId ?? null };
  }, sessionId);
  process.stdout.write(`[${i * 10}s] status=${st.status} phase=${st.phase}\n`);
  if (['done', 'error', 'aborted'].includes(st.status)) break;
}

console.log('\n==== WS 实时事件统计（任务一实测） ====');
if (counts.size === 0) console.log('❌ 未收到任何 agent:* 实时帧');
else for (const [k, v] of counts) console.log(`✅ ${k} ×${v}`);
console.log('样本:', samples.slice(0, 3));

await page.screenshot({ path: '/tmp/e2e-shots/10-live-agent.png' }).catch(() => {});
await browser.close();

const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(total > 0 ? `\nWS 实测通过：共 ${total} 帧实时事件` : '\nWS 实测失败');
process.exit(total > 0 ? 0 : 1);
