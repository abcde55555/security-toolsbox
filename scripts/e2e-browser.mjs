/**
 * 真实浏览器 E2E 验收：playwright-core + 系统 chromium，直连已构建的
 * 单进程服务（静态前端 + API 同源）。
 * 运行：node scripts/e2e-browser.mjs  （服务需已在 :3100 就绪）
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3100';
const SHOTS = '/tmp/e2e-shots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(15000);

try {
  // ---------- A. 项目列表页渲染 ----------
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  const hasLayout = await page.getByRole('banner').or(page.locator('.ant-layout-header')).count();
  ok('A1 布局与导航渲染', hasLayout > 0);
  await page.screenshot({ path: `${SHOTS}/01-projects.png` });

  // ---------- B. 知识库：新建笔记 → 列表出现（真实闭环） ----------
  await page.click('text=知识库');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("新建笔记")');
  await page.waitForSelector('.ant-modal-content', { timeout: 8000 });
  await page.fill('input[placeholder*="BLE 手环"]', `E2E验收笔记-${Date.now() % 100000}`);
  await page.fill('textarea', '1. 连接设备\n2. 发送 AT+MODE=2\n3. 观察蓝灯快闪即进入测试模式');
  await page.waitForTimeout(300);
  const saveBtn = page.locator('.ant-modal-footer button.ant-btn-primary').first();
  await saveBtn.click({ force: true });
  await page.waitForTimeout(1000);
  const noteInList = await page.locator('td:has-text("E2E验收笔记"), .ant-list-item:has-text("E2E验收笔记")').count();
  ok('B1 新建经验笔记并出现在列表', noteInList > 0);
  await page.screenshot({ path: `${SHOTS}/02-knowledge-note.png` });

  // Skill 库 tab 渲染
  await page.click('.ant-tabs-tab:has-text("技能库")');
  await page.waitForTimeout(500);
  const skillTab = await page.locator('text=/技能|Skill|暂无/').count();
  ok('B2 Skill 库页签可切换渲染', skillTab > 0);

  // ---------- C. Agent 向导：空选条款引导（本轮新 UX） ----------
  await page.goto(`${BASE}/agent/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // 第 0 步选择标准 → 直接下一步
  const stdRadio = page.locator('.ant-radio-button-wrapper, .ant-select-selector').first();
  if (await stdRadio.count()) {
    await stdRadio.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  let nextBtn = page.locator('button:has-text("下一步")');
  if (await nextBtn.isDisabled().catch(() => true)) {
    // 标准可能是 Select：打开下拉选第一项
    await page.locator('.ant-select-selector').first().click();
    await page.locator('.ant-select-item-option').first().click();
    await page.waitForTimeout(200);
  }
  await nextBtn.click();
  await page.waitForTimeout(600);
  const guidance = await page.locator('text=当前未选择任何条款').count();
  ok('C1 空选条款出现引导文案', guidance > 0);
  nextBtn = page.locator('button:has-text("下一步")');
  const enabled = await nextBtn.isEnabled();
  ok('C2 空选时「下一步」可用（交给 Agent 对话确认范围）', enabled);
  await page.screenshot({ path: `${SHOTS}/03-wizard-guidance.png` });

  // ---------- D. mock 会话详情交互 ----------
  await page.goto(`${BASE}/agent/mock-session?mock=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const timeline = await page.locator('.ant-timeline, .ant-steps, [class*=phase]').count();
  ok('D1 会话详情时间线渲染', timeline > 0);
  await page.screenshot({ path: `${SHOTS}/04-agent-session-mock.png` });

  // ---------- E. 设置页渲染 ----------
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const settingsBody = await page.locator('text=/AI 供应商|供应商|Provider/i').count();
  ok('E1 设置页 AI 供应商区块渲染', settingsBody > 0);
  await page.screenshot({ path: `${SHOTS}/05-settings.png` });

  // ---------- F. API 契约抽查 ----------
  const r404 = await page.evaluate(async () => {
    const r = await fetch('/api/agent/sessions/not-exist/clauses/X/retry', { method: 'POST' });
    return { status: r.status, body: await r.json() };
  });
  ok(
    'F1 retryClause 对不存在会话返回规范 envelope',
    r404.status === 404 && typeof r404.body?.code === 'number',
    `status=${r404.status} code=${r404.body?.code}`,
  );
  const rEv = await page.evaluate(async () => {
    const r = await fetch('/api/agent/sessions/not-exist/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileRefs: ['uploads/x.png'] }),
    });
    return { status: r.status, body: await r.json() };
  });
  ok('F2 evidence 上送对不存在会话返回 404', rEv.status === 404, `code=${rEv.body?.code}`);

  // ---------- G. 通知铃铛存在 ----------
  const bell = await page.locator('.ant-badge, [class*=bell], button:has([class*="bell"])').count();
  ok('G1 顶栏通知铃铛存在', bell > 0);
} catch (e) {
  ok('脚本异常中断', false, e instanceof Error ? e.message.slice(0, 200) : String(e));
  await page.screenshot({ path: `${SHOTS}/99-error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n==== 结果: ${results.length - failed.length}/${results.length} 通过 ====`);
process.exit(failed.length ? 1 : 0);
