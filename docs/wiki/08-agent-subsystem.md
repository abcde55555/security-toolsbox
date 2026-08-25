# 08 · Agent 智能体子系统（agent/）

> 位置：`packages/server/src/agent/` · 设计文档：`docs/agent/02-implementation-plan.md`、`Agent-Upgrade-Plan.md`
> 定位：以「人机协同」方式驱动 EN18031 评估的 AI 会话系统。核心设计红线：**确定性执行与生成式决策分离** —— AI 负责规划与叙述，工具调用走白名单，判定结果由代码计算，物理操作只能由人完成。

## 1. 组件总览

| 文件 | 导出 | 职责 |
| --- | --- | --- |
| agentService.ts | `class AgentService` | 会话生命周期门面：创建/启动/中止、人工步骤完成、消息注入、事件回放、判定审核；持有运行句柄表 |
| plannerLoop.ts | `runPlannerLoop(...): RunSessionHandle` | LLM ↔ 工具规划循环本体 |
| phaseMachine.ts | `canTransition / assertTransition / assertCanCreateVerdict / isTerminal / phaseIndex` | 四阶段状态机纯函数守卫 |
| humanStepCoordinator.ts | `class HumanStepCoordinator` | 人工步骤 Promise 挂起/恢复注册表（内存） |
| toolBridge.ts | `TOOL_SCHEMAS / dispatchTool / isAuthorizedTool / getToolSchema` | 工具白名单 Schema + 分发器 |
| prompts.ts | `buildSystemPrompt`（内部 PHASE_GUIDE） | 系统提示词拼装 |
| ai/types.ts | `AiProvider / AiError` 等 | Provider 抽象契约 |
| ai/deepseekProvider.ts | `DeepSeekProvider / createDeepSeekProvider` | 双协议(openai/anthropic) HTTP Provider |
| ai/scriptedProvider.ts | `ScriptedAiProvider` | 确定性脚本 Provider（测试/无 AI 环境） |
| toolHandlers/*.ts | flow/humanStep/clauses/artifacts/modules/verdict/common | 七类工具实现 |

## 2. 阶段机（phaseMachine）

```
onboarding(0) ──前进──▶ collection(1) ──前进──▶ adjudication(2) ──前进──▶ review(3, 终态)
      ◀──回退(仅一步)──        ◀──回退(仅一步)──
```

- 合法前向：`onboarding→collection→adjudication→review`；合法回退：仅相邻一步（collection→onboarding、adjudication→collection），review 不可回退。
- `assertTransition(from,to)`：同阶段 409「已在阶段…」；跨级跳跃 409「非法阶段迁移: X -> Y（仅允许顺序前进或回退一步）」；回退返回 `{isRollback:true}` 并使 `incrementRollback()` 计数 + 审计 `agent.phase_rollback`（前进为 `agent.phase_advance`）。
- `assertCanCreateVerdict(phase)`：**仅 adjudication 可提交判定**。双保险：DB 触发器 `clause_verdicts_phase_guard` 在引擎层再次拒绝（见 [05](./05-server-foundation.md) §3.1）。
- 阶段推进由模型显式调用 `advance_phase` 工具驱动。

## 3. 会话生命周期（AgentService）

- **createSession**：projectId 缺省时自动建「一次性项目」（templateId='agent'）；同时创建专属 project_run（triggerMode='agent'），会话所有 step_run 挂在其下。模型快照三级解析：入参 > settings 活动 Provider > config.ai.* —— 会话内固化模型。
- **start**：运行中重复启动 409；终态 409；`resolveProvider()` 每次重建 Provider（设置页改动免重启生效），无可用 Provider 抛 503 提示配置 Key；组装 `AgentLoopDeps{repos, engine, moduleLoader, bus, provider, coordinator, signal, userId, maxIterations, humanStepTimeoutMs}` 后 `runPlannerLoop()` 得到 `RunSessionHandle{sessionId, promise, abort}` 存入 running 表。
- **abort**：有句柄则 `handle.abort()`（AbortController 链）；空闲挂起态则 `coordinator.abortAll()` + finish(id,'aborted')；广播 `agent:done {status:'aborted'}`。
- **sendMessage**：落库 user_message 事件；状态为 planning/waiting_confirm 时自动续跑循环。
- **retryClause（v0.3 人工退回补采）**：校验条款在范围内、会话非运行中（运行中 409，避免与在途循环内存状态打架）；phase∈{adjudication,review} 时 updatePhase 回 collection + incrementRollback + 广播 `agent:phase {isRollback:true}`；done/error 重开为 planning；注入「【人工退回补采】条款 X…」指令后 `start()` 带消息重启循环。单测见 agentRetryClause.test.ts。
- **attachEvidence（v0.3 人工补充证据）**：复用/创建会话级合成步骤（stepId=`manual-evidence-<sessionId前8位>`，stepType='evidence_attach'）以满足 evidences.stepRunId NOT NULL；按扩展名判 screenshot/file_pointer 落行并逐条广播 `agent:evidence_attached`。配套修复：mapEvidence 此前丢弃 Agent 扩展列（clauseId/functionModule/sourceStepType/mimeType），读回即丢——已补全。
- **WS 加房实测（v0.5）**：agent 房间握手 query 修复后以真实会话抓帧验证——6 分钟窗口收到 33 帧 / 9 类 agent:* 事件（session/message/tool_call/tool_result/step_started/artifact_written/human_step_requested/human_step_completed/phase），实时链路不再依赖轮询兜底。run 房间字段核对结论：前后端本就一致（{runId} ↔ payload.runId），无需改动。
- whenIdle(sessionId)：等待该会话规划循环落定（测试与优雅关停用）。

会话状态机（AGENT_SESSION_STATUSES）：`planning → running → waiting_human → waiting_confirm → review → done`，终态 aborted/error。

## 4. 规划循环（plannerLoop）

```mermaid
flowchart TB
    S[初始化: status=running<br/>解析条款+buildSystemPrompt→messages[0]] --> W{iterations < maxIterations=50?}
    W -->|否| END2[finish + error 提示未达 review]
    W -->|是| R{phase==review?}
    R -->|是| DONE[finish 'done' + agent:done]
    R -->|否| CHAT["provider.chat(messages,{tools:TOOL_SCHEMAS,<br/>toolChoice:'auto', model:planningModel})"]
    CHAT -->|失败| ERR[status=error + agent:error + agent:done]
    CHAT -->|成功| TC{有 tool_calls?}
    TC -->|无| NUDGE["注入中文催进消息：<br/>阶段完成请 advance_phase…"] --> W
    TC -->|有| LOOP["逐个 executeToolCall:<br/>解析参数→dispatchTool→结果 role='tool' 压栈"] --> REFRESH[每轮整体替换 messages[0] 同步阶段] --> W
```

关键工程细节：
- **AI 调用失败不上抛**：转成错误事件收尾（status=error）；**工具执行异常也不上抛**：转成 tool 消息让模型自愈；
- 回给模型的 tool 内容超 8000 字符截断；广播的 `agent:tool_result` output 截断 4000 字符；
- 参数 JSON 解析失败记 `toolStatus:'invalid_args'`；
- 无工具调用时注入催进提示（防模型空转）；
- 收尾兜底 catch 保证任何异常都会把会话置为终态并广播 `agent:done`。

## 5. 人机协作步骤（HumanStepCoordinator）

数据结构：`pending = Map<stepRunId, {resolve, reject, timer}>`。

1. **挂起**：`plan_human_step` 处理器创建 stepType='human_instruction' 的 stepRun → 会话置 waiting_human → 广播 `agent:human_step_requested` → `await coordinator.wait(...)` —— 该 await 位于 executeToolCall 内，**整个规划循环天然阻塞**。
2. **恢复**：REST `POST .../human-steps/:stepRunId/complete {note?, fileRefs?}` → 校验归属 → resolve；随后处理器把每个 fileRef 落成 file_pointer 类型证据（guessMime 推断 MIME）、广播 `agent:evidence_attached` × N 与 `agent:human_step_completed`，完成结果作为 tool 消息交还模型继续循环。非等待态 complete 返回 409。
3. **超时**：`humanStepTimeoutMs`（默认 30 分钟），timer unref 不阻进程退出；超时 → stepRun 置 timeout(`HUMAN_STEP_TIMEOUT`)、会话置 error、广播 `agent:error '人工步骤超时，已归档'`。
4. **局限**：单实例内存 Map，不支持多进程；重启丢 pending（超时归档即防悬挂设计）。

## 6. AI Provider 抽象

### ai/types.ts 契约

```ts
interface AiProvider {
  readonly name: string;
  chat(messages, options?): Promise<ChatResult>;
  streamChat(messages, onChunk:(c:StreamChunk)=>void, options?): Promise<ChatResult>;
}
// ChatMessage{role,content?,toolCalls?,toolCallId?} / ToolSchema(OpenAI function 格式)
// ChatResult{message,usage?,model,finishReason?,latencyMs?} / AiError{code∈9类,status?}
```

### deepseekProvider —— 双协议 HTTP Provider

虽名为 DeepSeek，实为协议无关实现（构造参数 `protocol: 'openai'|'anthropic'`）：

| 维度 | openai 兼容协议 | anthropic 协议 |
| --- | --- | --- |
| 端点 | `{baseUrl}/chat/completions` | `{baseUrl}/v1/messages` |
| 覆盖厂商 | DeepSeek/OpenAI/vLLM/Ollama(/v1)/Moonshot/Together… | Claude 及兼容网关 |
| 消息转换 | 直映射 role/content/tool_calls/tool_call_id | system 抽顶层；tool→user 的 tool_result block；toolCalls→tool_use block |
| 认证头 | `Authorization: Bearer` | Bearer + `x-api-key` + anthropic-version/beta 头 |

- 配置优先级：settings 表活动 Provider > 环境变量基线（动态 import 打破循环依赖）；`AI_ENABLED=false 且无 apiKey` 时不可用；
- 错误分类 classifyError：401/403→auth、429→rate_limit、400→invalid_request、≥500→upstream；
- `fetchWithRetry` 对 429/5xx/网络错误做最多 maxRetries 次 `500*2^attempt` 指数退避；
- 流式与非流式均已实现，当前循环使用非流式 chat()。

### scriptedProvider —— 确定性脚本

按序消费 `ScriptedResponse[]`（content 或 toolCalls），耗尽后返回固定文本；记录 calls/callCount/lastMessages 供测试断言。经 `AgentService.useScriptedProvider` 注入，用于单测与无 AI 环境跑通全流程。

## 7. 工具系统（toolBridge + toolHandlers）

`TOOL_SCHEMAS` 以 OpenAI function 格式静态声明 **9 个工具**，每轮随请求下发 —— **模型永远看不到裸 shell**。`dispatchTool` 负责：未知工具报错、required 必填校验、分发 handler。

| 工具 | 关键参数 | 行为摘要 |
| --- | --- | --- |
| `list_clauses` | — | 解析 selectedClauses 返回条款清单（clauseId/chapter/title/level/testingMethod） |
| `write_artifact` | type(device_profile/network_topology/onboarding_result/other)、title、content、fileRefs、functionModule | 创建 stepType=evidence_attach 步骤 + artifact 落库，广播 `agent:artifact_written`，审计 |
| `read_artifact` | type? | 按 session 列出工件（可按类型过滤） |
| `run_module` | moduleId、params、title、functionModule、clauseId | **复用确定性执行引擎**：moduleLoader 取模块 → createCancelToken 挂会话 signal → engine.runModule（onProgress 的 logLine/percent 转 `agent:tool_output`/`agent:progress`）→ 输出写 evidence 目录日志 → evidence 逐条入库 → 返回 status/stdout 尾 4000 字/evidenceRefs 等 |
| `plan_human_step` | instruction(必填)、title、expectedOutcome、referenceCommand、evidenceReq | 人机协作挂起（§5） |
| `create_verdict` | clauseId、evidenceRefs、comment | **确定性判定核心**（§7.1） |
| `advance_phase` | target(四阶段枚举)、reason | assertTransition 校验后 changePhase（持久化+广播+审计），非法迁移转为 isError 反馈模型 |
| `search_skills` | keyword? | **检索沉淀经验**（P1）：当前版本技能按 key/title/body LIKE 检索，过滤 archived，取前 10 条返回 skillKey/title/status/whenToUse/body 前 1200 字 |
| `propose_skill` | title(必填)、summary、body、sourceNoteIds? | **非阻塞沉淀建议**（P1）：不直接写技能库，而是创建 `skill_sediment` 通知（payload 携带草稿）+ 广播 `notification:new`，人工在铃铛点「采纳为技能」后才落地 draft 技能 |

> 会话级沉淀钩子：plannerLoop 自然完成且 finalStatus='done' 时，若本次 run 存在已通过判定，自动发一条
> `template_save` 通知（含 sessionId/projectRunId/approvedVerdicts 计数），提示工程师沉淀为技能或模板。

### 7.1 create_verdict：AI 只起草，代码裁决

1. `assertCanCreateVerdict(session.phase)`（仅 adjudication，应用层 + DB 触发器双保险）；
2. clauseId 必须在 selectedClauses 内且条款存在；
3. 证据归属校验：evidenceRefs 必须都属于本项目 run，不符列出缺失 id 报错；
4. **pass/severity 由代码计算**：证据含 validation_error → pass=false；severity 取所引证据最劣者（SEV_RANK high>middle>low），缺省回落条款 defaultSeverity；AI 的 comment 仅拼入 reason（"AI 备注: …"），**绝不影响结论**；
5. 写入 verdict：`verdictGroup="agent:${sessionId}:${clauseId}"`、`reviewStatus:'pending_review'`、`aiGenerated:true`；触发器拒绝则 stepRun fail(`VERDICT_REJECTED`);
6. 只有 approved（人工审核通过）的判定才进入合规定级（ReportService 过滤 reviewStatus）。

## 8. 系统提示词设计（prompts.ts）

`buildSystemPrompt({session, clauses, authorizedTools})` 六段拼装：
1. 角色定位（合规测试编排助手，与安全工程师协同）；
2. 五条核心原则（只经 run_module 用已注册模组禁止臆造 shell / 物理操作必须 plan_human_step / pass 由系统算 / 全动作审计且回退仅一步 / 证据不足主动采集不许凭空下结论）;
3. 动态阶段指令 PHASE_GUIDE[phase]（A 写档案工件、B run_module/plan_human_step 采集、C 逐条 create_verdict、D 只汇总等审核）；
4. 设备档案 JSON；5. 选定条款清单；6. 可用模组列表；
7. **历史经验技能**（P1）：`skills.list({status:'approved'})` 前 8 条以「key（标题）：whenToUse」摘要注入，
   并指示模型用 search_skills 查全文、review 阶段用 propose_skill 提议沉淀 —— **案例反哺规划的入口**；
8. 中文回复指令。

工程要点：**每轮迭代整体替换 messages[0]**，使"当前阶段"随 changePhase 实时更新而对话历史连续。

## 9. 对外接口

### REST（routes/agent.ts，全部 preHandler: requireRole('auditor')）

| 方法 路径 | 用途 |
| --- | --- |
| POST `/api/agent/sessions` | 创建会话（projectId 与 standardVersion 至少其一） |
| GET `/api/agent/sessions` | 分页列表（projectId/limit/offset） |
| GET `/api/agent/sessions/:id` | 详情 |
| POST `/api/agent/sessions/:id/start` | 启动/续跑（body {message?}） |
| POST `/api/agent/sessions/:id/abort` | 中止 |
| POST `/api/agent/sessions/:id/messages` | 注入用户消息（planning/waiting_confirm 自动续跑） |
| GET `/api/agent/sessions/:id/events?sinceSeq=N` | 事件增量回放（断线补偿） |
| GET `/api/agent/sessions/:id/steps` | 会话全部 stepRun |
| POST `/api/agent/sessions/:id/human-steps/:stepRunId/complete` | 完成人工步骤 |
| GET `/api/agent/projects/:projectId/pending-verdicts` | 待审判定列表 |
| POST `/api/agent/verdicts/:verdictId/approve` / `reject` | 审核（reject 需 reason） |
| POST `/api/agent/artifacts` / GET `/api/agent/artifacts?sessionId=\|&projectId=` | 工件直建/查询 |

> 已知留白：前端 endpoints.ts 引用的 resume/advance/rollback/retry/review 等端点在后端尚未实现（P2 规划项）；文件上传现走通用 `POST /api/upload`。

### Socket.IO 事件（17 个，房间 `agent:{sessionId}`）

`agent:session` / `agent:phase{from,to,isRollback}` / `agent:step_started` / `agent:tool_call` / `agent:tool_output` / `agent:tool_result{exitCode,durationMs,output,evidenceRefs}` / `agent:human_step_requested` / `agent:human_step_completed` / `agent:evidence_attached` / `agent:artifact_written` / `agent:verdict_drafted` / `agent:verdict_updated`（approve/reject 发出，全局广播）/ `agent:message` / `agent:progress` / `agent:error` / `agent:done{status}` / `agent:waiting_confirm`（预留，服务端暂无发射点）。

## 10. 持久化、可回放与审计

- `agent_events` append-only（触发器禁改删）+ `UNIQUE(sessionId,seq)` + 事务内 MAX(seq)+1 分配 —— 构成**不可变有序事件流**，支持 sinceSeq 断线续传回放；
- 所有关键动作双写 audit_logs（动作名 agent.session_create / agent.message / agent.abort / agent.phase_advance / agent.phase_rollback / agent.human_step_complete / agent.verdict_draft / agent.verdict_approve / agent.verdict_reject / agent.artifact_write）。

## 11. 一次典型会话的事件序列

```
POST /sessions → POST /start
  ├─ agent:session(running) 
  ├─ agent:message ← 模型叙述（onboarding）
  ├─ agent:tool_call(write_artifact) → agent:artifact_written
  ├─ agent:phase(onboarding→collection)
  ├─ agent:tool_call(run_module) → agent:step_started → agent:progress/tool_output×N → agent:tool_result(evidenceRefs)
  ├─ agent:human_step_requested → [人工操作] → POST human-steps/:id/complete
  │     └─ agent:evidence_attached×N → agent:human_step_completed
  ├─ agent:phase(collection→adjudication)
  ├─ agent:verdict_drafted × 条款数（均 pending_review）
  ├─ agent:phase(adjudication→review)
  └─ agent:done(status:'done')
→ 人在 pending-verdicts 上 approve/reject → agent:verdict_updated → approved 判定进入报告定级
```
