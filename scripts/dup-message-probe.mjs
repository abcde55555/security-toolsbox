/**
 * 重复消息回归探针：真实会话发送「你好」→ 等待回复稳定 →
 * 统计 DOM 中 assistant 气泡含「你好」的数量（期望恰好 1）。
 */
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:3100';

// 建会话
const create = await fetch(`${BASE}/api/agent/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ standardVersion: 'EN18031:2019', name: '重复消息探针' }),
}).then((r) => r.json());
const sid = create.data.id;
console.log('session:', sid);

// 启动
await fetch(`${BASE}/api/agent/sessions/${sid}/start`, { method: 'POST' }).then((r) => r.json());

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.goto(`${BASE}/agent/${sid}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 在聊天输入框发送 你好
const input = page.locator('input[placeholder*="Agent"], textarea[placeholder*="Agent"]').first();
await input.fill('你好');
await page.locator('button:has([class*="send"]), button:has-text("发送")').first().click().catch(async () => {
  await input.press('Enter');
});

// 等模型回完（轮询状态到 done 或 90s 超时）
let status = '';
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(5000);
  const st = await page.evaluate(async (s) => {
    const d = await (await fetch(`/api/agent/sessions/${s}`)).json();
    return d.data.status;
  }, sid);
  if (st !== status) { console.log(`[${i * 5}s] ${st}`); status = st; }
  if (['done', 'error', 'aborted', 'waiting_human'].includes(st)) break;
}

await page.waitForTimeout(2000); // 让 socket/回补全部落定

// 精确计数：服务端每条消息的唯一前缀在 DOM 中应恰好出现 1 次
const verdict = await page.evaluate(async (sid) => {
  const evs = (await (await fetch(`/api/agent/sessions/${sid}/events?sinceSeq=0`)).json()).data
    .filter((e) => e.type === 'user_message' || e.type === 'model_message');
  const body = document.body.innerText;
  return evs.map((e) => {
    const needle = (e.content ?? '').slice(0, 14);
    if (!needle) return { needle: '(空)', copies: 0 };
    let copies = 0, idx = 0;
    while ((idx = body.indexOf(needle, idx)) !== -1) { copies++; idx += needle.length; }
    return { needle, copies };
  });
}, sid);
console.log('DOM 出现次数（期望各=1）:', JSON.stringify(verdict, null, 1));
const bad = verdict.filter((v) => v.copies !== 1);
console.log(bad.length === 0 ? '✅ 无重复渲染' : `❌ ${bad.length} 条消息出现叠影`);
await page.screenshot({ path: '/tmp/e2e-shots/11-dup-probe.png' }).catch(() => {});
await browser.close();
process.exit(bad.length === 0 ? 0 : 1);


