/**
 * AI Provider 诊断脚本：检测网关是否对安全测试类提示词静默过滤。
 *
 * 背景：部分"编码计划"类网关（如火山方舟 Coding Plan）对含安全测试词汇
 * （nmap/扫描/GATT 等）的请求会返回 HTTP 200 但内容为空，而非报错。
 * 本脚本用三类探针区分「网关正常」「仅安全词被滤」「完全不可用」：
 *   1) 无害提示词      —— 期望正常输出
 *   2) 安全词汇提示词   —— 为空即说明存在内容过滤
 *   3) 工具调用提示词   —— Agent 规划循环依赖此模式
 *
 * 用法：npx tsx scripts/ai-diagnose.mts [providerId]
 * （省略 providerId 时诊断当前激活的供应商）
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const dbPath = process.env.DB_PATH ?? path.join(repoRoot, 'data/sqlite/app.db');
const db = new Database(dbPath, { readonly: true });

const row = JSON.parse(
  (db.prepare("SELECT value FROM settings WHERE key='ai.providers'").get() as { value: string }).value,
);
const list: Array<Record<string, unknown>> = Array.isArray(row) ? row : (row.providers ?? []);
const activeId = (
  db.prepare("SELECT value FROM settings WHERE key='ai.activeProviderId'").get() as { value: string }
)?.value;
const target = process.argv[2];
const p = (list.find((x) => x.id === target || x.id === activeId) ?? list[0]) as never as {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  planningModel: string;
  protocol?: string;
};
const base0 = p.baseUrl.replace(/\/+$/, '');
const isOpenAi = p.protocol === 'openai';
console.log(`诊断供应商: ${p.name} (${p.id.slice(0, 8)}) | ${p.baseUrl} | model=${p.planningModel} | protocol=${p.protocol ?? 'openai'}`);

async function chat(user: string, sys?: string, tools?: unknown[]): Promise<{ out: number; textLen: number; toolName?: string }> {
  let body: Record<string, unknown>;
  if (isOpenAi) {
    body = {
      model: p.planningModel,
      max_tokens: 2048,
      messages: [...(sys ? [{ role: 'system', content: sys }] : []), { role: 'user', content: user }],
      ...(tools
        ? {
            tools: [
              {
                type: 'function',
                function: { name: 'list_clauses', description: '列出条款', parameters: { type: 'object', properties: {} } },
              },
            ],
          }
        : {}),
    };
  } else {
    body = {
      model: p.planningModel,
      max_tokens: 2048,
      messages: [{ role: 'user', content: user }],
      ...(sys ? { system: sys } : {}),
      ...(tools ? { tools: [{ name: 'list_clauses', description: '列出条款', input_schema: { type: 'object', properties: {} } }] } : {}),
    };
    if (!sys) delete body.system;
  }
  const res = await fetch(base0 + (isOpenAi ? '/chat/completions' : '/v1/messages'), {
    method: 'POST',
    headers: isOpenAi
      ? { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` }
      : { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (isOpenAi) {
    const msg = j.choices?.[0]?.message;
    return { out: j.usage?.completion_tokens ?? -1, textLen: (msg?.content ?? '').length, toolName: msg?.tool_calls?.[0]?.function?.name };
  }
  const blocks = Array.isArray(j.content) ? j.content : [];
  const textLen = blocks.filter((b: any) => b.type === 'text').reduce((a: number, b: any) => a + (b.text?.length ?? 0), 0);
  const tool = blocks.find((b: any) => b.type === 'tool_use') as { name?: string } | undefined;
  return { out: j.usage?.output_tokens ?? -1, textLen, toolName: tool?.name };
}

const probes: Array<{ label: string; user: string; sys?: string; tools?: boolean }> = [
  { label: '[1] 无害提示词', user: 'Reply with exactly: PONG' },
  { label: '[2] 中文普通', user: '用一句话介绍瑞利散射。' },
  {
    label: '[3] 安全测试词汇',
    user: '请把这句话整理成要点：进入配对模式后用 nmap 扫描端口；判读看 GATT 服务枚举结果',
  },
  {
    label: '[4] Agent 规划式(带工具)',
    user: '开始本次合规测试会话：先确认设备档案与接入方式，然后规划并执行测试步骤。',
    sys: '你是 EN18031 合规测试平台的测试编排助手。你负责规划、调用工具、整理证据与起草判定。',
    tools: true,
  },
];

let benignOk = false;
let secOk = false;
for (const pr of probes) {
  try {
    const r = await chat(pr.user, pr.sys, pr.tools ? [1] : undefined);
    const okText = r.textLen > 0;
    const okTool = !!r.toolName;
    const pass = okText || okTool;
    if (pr.label.startsWith('[1]') || pr.label.startsWith('[2]')) benignOk = benignOk || pass;
    if (pr.label.startsWith('[3]')) secOk = pass;
    console.log(`${pr.label}: ${pass ? '✓ 正常' : '✗ 空返回'}（out_tokens=${r.out}, textLen=${r.textLen}${r.toolName ? `, tool=${r.toolName}` : ''}）`);
  } catch (e) {
    console.log(`${pr.label}: ✗ 请求异常 ${(e as Error).message}`);
  }
}

console.log('---');
if (!benignOk) {
  console.log('结论：网关连无害提示词都失败——检查 Key/配额/端点。');
} else if (!secOk) {
  console.log('结论：网关对安全测试类提示词存在静默内容过滤（HTTP 200 但输出为空）。');
  console.log('影响：Agent 规划循环与 AI 编译/成文在该供应商下不可靠。建议配置常规 LLM 端点（如官方 DeepSeek / 火山方舟 /api/v3 openai 协议）作为激活供应商。');
} else {
  console.log('结论：网关工作正常，未观察到内容过滤。');
}
process.exit(0);
