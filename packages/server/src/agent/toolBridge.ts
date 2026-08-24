import type { ToolSchema } from './ai/types.js';
import type { AgentToolContext, ToolResult } from './agentContext.js';
import { listClauses } from './toolHandlers/clauses.js';
import { writeArtifact, readArtifact } from './toolHandlers/artifacts.js';
import { runModule } from './toolHandlers/modules.js';
import { planHumanStep } from './toolHandlers/humanStep.js';
import { createVerdict } from './toolHandlers/verdict.js';
import { advancePhase } from './toolHandlers/flow.js';

/**
 * White-listed agent tools. The model may only call these; raw shell is never
 * exposed. Each schema is JSON Schema for function-calling.
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'list_clauses',
      description: '列出本次会话选定的待测试条款（编号、标题、测试方法、默认严重度）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_artifact',
      description: '保存阶段工件，如设备档案、网络拓扑、接入结果。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['device_profile', 'network_topology', 'onboarding_result', 'other'] },
          title: { type: 'string' },
          content: { type: 'string', description: '工件正文（Markdown/文本/JSON 字符串）' },
          fileRefs: { type: 'array', items: { type: 'string' } },
          functionModule: { type: 'string' },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_artifact',
      description: '读取本会话已保存的工件（可按 type 过滤）。',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['device_profile', 'network_topology', 'onboarding_result', 'other'] } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_module',
      description: '执行已注册的内置模组（结构化输出），如端口检测、密码检查、固件扫描。会流式返回进度并落库证据。',
      parameters: {
        type: 'object',
        properties: {
          moduleId: { type: 'string' },
          params: { type: 'object', additionalProperties: true },
          title: { type: 'string' },
          functionModule: { type: 'string', description: '功能模块标签，如 network/bluetooth/ota' },
          clauseId: { type: 'string', description: '若该证据直接服务于某条款，填写条款号' },
        },
        required: ['moduleId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_human_step',
      description: '规划一个需要人工在物理设备上操作的步骤（如接线、进入配对模式、抓包）。调用后会阻塞，直到操作员在界面上标记完成并上传证据。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          instruction: { type: 'string', description: '清晰的操作说明（Markdown）' },
          expectedOutcome: { type: 'string', description: '期望观察到的结果/判定标准' },
          referenceCommand: { type: 'string', description: '可选参考命令，仅供操作员参考，不会自动执行' },
          evidenceReq: {
            type: 'object',
            properties: {
              required: { type: 'boolean' },
              functionModule: { type: 'string' },
              accept: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_verdict',
      description:
        '在裁定阶段提交某条款的判定草案。只能引用已收集的证据ID；通过/失败与严重度由系统根据证据确定性计算，AI 仅可补充 comment。草案需人工审核通过后才进入合规定级。',
      parameters: {
        type: 'object',
        properties: {
          clauseId: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          comment: { type: 'string', description: 'AI 对判定理由的补充说明（仅供参考）' },
        },
        required: ['clauseId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'advance_phase',
      description: '推进或回退阶段。合法顺序：onboarding→collection→adjudication→review；可回退一步（adjudication→collection、collection→onboarding）。',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['onboarding', 'collection', 'adjudication', 'review'] },
          reason: { type: 'string' },
        },
        required: ['target'],
        additionalProperties: false,
      },
    },
  },
];

type Handler = (ctx: AgentToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

const HANDLERS: Record<string, Handler> = {
  list_clauses: (ctx) => listClauses(ctx),
  write_artifact: (ctx, args) => writeArtifact(ctx, args as never),
  read_artifact: (ctx, args) => readArtifact(ctx, args as never),
  run_module: (ctx, args) => runModule(ctx, args as never),
  plan_human_step: (ctx, args) => planHumanStep(ctx, args as never),
  create_verdict: (ctx, args) => createVerdict(ctx, args as never),
  advance_phase: (ctx, args) => advancePhase(ctx, args as never),
};

export function isAuthorizedTool(name: string, authorizedTools: string[]): boolean {
  // authorizedTools is an allow-list of module/tool ids; run_module additionally
  // gated by it. The flow/artifact/clause/verdict/human tools are core and always allowed.
  if (name !== 'run_module') return Object.prototype.hasOwnProperty.call(HANDLERS, name);
  return true; // module-level gating happens inside runModule via moduleLoader
}

export function getToolSchema(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find((t) => t.function.name === name);
}

export async function dispatchTool(
  ctx: AgentToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) {
    return { content: `错误: 未授权或未知的工具 "${name}"`, isError: true };
  }
  // Basic schema validation: required fields present.
  const schema = getToolSchema(name);
  if (schema) {
    const required = (schema.function.parameters as { required?: string[] }).required ?? [];
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length > 0) {
      return { content: `错误: 工具 ${name} 缺少必填参数: ${missing.join(', ')}`, isError: true };
    }
  }
  return handler(ctx, args);
}
