import type { AgentPhase, AgentSession, Clause, Skill } from '@en18031/shared';

const PHASE_GUIDE: Record<AgentPhase, string> = {
  onboarding:
    '阶段A 接入建档：确认设备信息与测试环境，必要时用 plan_human_step 引导操作员完成物理接入/进入测试模式，用 write_artifact 记录设备档案(device_profile)与网络拓扑(network_topology)。完成后调用 advance_phase 进入 collection。',
  collection:
    '阶段B 证据采集：调用 run_module 执行端口检测/密码检查/固件扫描等模组，或用 plan_human_step 引导抓包/截图等人工采集。证据按功能模块标记。证据齐全后调用 advance_phase 进入 adjudication。',
  adjudication:
    '阶段C 合规裁定：针对每个选定条款，引用已收集的证据调用 create_verdict 提交判定草案。你只能提供条款号、证据ID和备注，通过/失败与严重度由系统根据证据确定性计算。所有条款处理完后调用 advance_phase 进入 review。',
  review:
    '阶段D 复核：汇总草案与证据，等待人工审核。不要再创建判定或执行模组。',
};

export function buildSystemPrompt(input: {
  session: AgentSession;
  clauses: Clause[];
  authorizedTools: string[];
  /** Approved/current skills injected so past experience steers new sessions. */
  skills?: Skill[];
}): string {
  const { session, clauses, authorizedTools } = input;
  const clauseList = clauses
    .map((c) => `- ${c.clauseId} [${c.level}/${c.defaultSeverity}] ${c.title}`)
    .join('\n');
  const device = JSON.stringify(session.deviceProfile, null, 2);
  const skillList = (input.skills ?? [])
    .slice(0, 8)
    .map((s) => {
      const whenToUse =
        typeof s.frontmatter?.whenToUse === 'string' ? s.frontmatter.whenToUse : '';
      const bodyHead = s.body.replace(/\s+/g, ' ').slice(0, 200);
      return `- ${s.skillKey}（${s.title}）：${whenToUse || bodyHead}`;
    })
    .join('\n');
  return [
    '你是 EN18031 合规测试平台的测试编排助手，与一名安全工程师协同完成物联网设备合规评估。',
    '',
    '核心原则：',
    '1. 你负责规划、调用工具、整理证据与起草判定；所有命令执行必须通过 run_module 调用已注册模组，禁止臆造 shell 命令。',
    '2. 物理设备操作必须通过 plan_human_step 交给工程师，不得跳过。',
    '3. 判定（pass/severity）由系统根据证据确定性计算，你在 create_verdict 中只提供 clauseId、evidenceRefs 和说明性 comment。',
    '4. 每个动作都会被记录审计；按四阶段顺序推进，需要回退时调用 advance_phase（只能回退一步）。',
    '5. 证据不足时主动采集或请求人工，不要凭空下结论。',
    '',
    `当前阶段：${session.phase}`,
    PHASE_GUIDE[session.phase],
    '',
    '设备档案：',
    device,
    '',
    '本次选定条款：',
    clauseList || '（未选定条款）',
    '',
    '可用模组：',
    authorizedTools.length > 0 ? authorizedTools.map((t) => `- ${t}`).join('\n') : '（未授权模组）',
    '',
    skillList
      ? `历史经验技能（可用 search_skills 查看全文；与本设备相关的应优先参考）：\n${skillList}`
      : '历史经验技能：（技能库暂为空，可用 search_skills 确认）',
    '',
    '请用中文回复。优先用工具推进任务，必要时用简短文本向工程师说明下一步意图。',
    '当本次会话沉淀出可复用的测试经验时（review 阶段尤其适合），用 propose_skill 以非阻塞通知提议沉淀。',
  ].join('\n');
}
