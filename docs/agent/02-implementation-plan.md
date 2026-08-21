# Agent 人机协同测试平台 · 实施方案

> **文档版本**：v1.0
> **产出日期**：2026-08-21
> **上游依据**：`01-feasibility.md`（v0.3）、`dsh-integration-feasibility.md`、`Agent-Upgrade-Plan.md`
> **适用读者**：Tech Lead、后端/前端/测试工程师
> **读完能做什么**：按本文的阶段/任务直接拆 Jira/排期，每个任务有文件、验收标准、依赖。

---

## 0. 实施总原则

1. **一期不依赖 dsh**：用 DeepSeek OpenAI 兼容 API + 平台自有 Agent 循环。`AiProvider` 抽象预留二期换 dsh/本地模型。
2. **确定性与生成式分离**：工具执行、条款判定、报告定级走确定性引擎；AI 只做规划、成文、建议。定级（grade）永远由代码算。
3. **AI 不碰裸 shell、不跳过人工步骤**：命令只走模组/已注册工具；人工步骤 Promise 只能由人 resolve。
4. **可回放、可审计**：所有工具调用/模型响应/人工动作/阶段切换写 append-only `agent_events` + `audit_logs`。
5. **渐进交付**：P0 铺数据底座（无 AI 也能跑），P1 跑通端到端主链路，P2/P3 放开能力。每个阶段独立可验证。
6. **P1 验收目标**：一个真实设备（Z6s，skill 种子）+ 一个条款族（GEC 网络外部接口），Agent 动态给 A/B 步骤 → 人工完成 → C 判定 → 审核 → 出报告，并主动给出沉淀通知。

---

## 1. 总体阶段与里程碑

| 阶段 | 目标 | 人日 | 关键验收 |
|---|---|---|---|
| **P0** | 数据底座 + 证据上传 + 类型/API 契约；前端骨架 | 8-12 | 迁移在空/老库通过；老报告不回归；mock 事件能渲染会话页骨架 |
| **P1** | Agent 人机协同端到端主链路 | 25-30 | Z6s + GEC 端到端；AI 建议通知；知识闭环 |
| **P2** | 能力放开（案例反哺、向量检索、设备工具、模板沉淀） | 1-2 月 | 多模块并行、审批对接、会话完善 |
| **P3** | dsh SDK 子进程接入（探索性诊断） | dsh 1.0 后 | 子进程隔离、双写、版本锁 |

P0/P1 是本次实施范围，P2/P3 仅备忘。

---

## 2. P0：数据与底座（后端 + 前端 + 测试并行）

### 2.1 后端 P0

#### T-BE-01 数据库迁移 8（agent schema 子集）
- **做什么**：在 `packages/server/src/db/database.ts` 的 `MIGRATIONS` 追加 `id: 8`，用 `run()` 回调 + `addCol` helper（沿用迁移 3/7 风格，幂等）：
  - `step_runs` 加列：`stepType TEXT`、`phase TEXT`、`functionModule TEXT`、`instruction TEXT`、`expectedOutcome TEXT`、`artifacts TEXT DEFAULT '[]'`、`agentSessionId TEXT`（+ index）。**先允许 NULL/默认值**，不影响老数据。
  - `clause_verdicts` 加列：`reviewStatus TEXT NOT NULL DEFAULT 'approved'`、`reviewedBy TEXT`、`reviewedAt TEXT`、`reviewNote TEXT`、`aiGenerated INTEGER NOT NULL DEFAULT 0`。
  - `evidences` 加列：`clauseId TEXT`、`functionModule TEXT`、`sourceStepType TEXT`、`mimeType TEXT`。
  - `projects` 加列：`mode TEXT NOT NULL DEFAULT 'template'`。
  - 新建表：`agent_sessions`、`agent_events`（含 `UNIQUE(sessionId,seq)` + append-only 触发器，复刻迁移 2 的 audit 范式）、`artifacts`。
  - **不建** knowledge_notes/skills/notifications（留 P1）。
  - 阶段边界触发器：`clause_verdicts_phase_guard`——仅当 stepRun 有 agentSessionId 且对应 session.phase≠adjudication 时 ABORT（模板模式放行）。
- **验收**：
  - 全新 `createInMemoryDb()` 和从 v7 升级的库都迁移成功；`runMigrations` 跑两次不报错（幂等）。
  - 老 `clause_verdicts` 回填 `reviewStatus='approved'`，`ReportService.generateReport` 结果不变（加 reviewStatus 过滤见 T-BE-04）。
  - 直接 SQL 往非 adjudication 阶段的 agent step 插 verdict 被触发器拒绝。
  - `agent_events` 的 UPDATE/DELETE 抛 ABORT。

#### T-BE-02 证据/文件上传接口
- **做什么**：`POST /api/agent/sessions/:id/evidence`（multipart，落 `filesDir/evidence/`，算 sha256，返回 `{fileRef,mimeType,size,hash}`）；复用 `routes/upload.ts` 的 multipart 配置；附件大小/类型校验。
- **文件**：`routes/agent.ts`（先建骨架）、`repositories/resultRepository.ts`（`insertEvidence` 扩展字段）。
- **验收**：能上传图片/pcap/日志并回显；超限/非法类型返回 400。

#### T-BE-03 Artifacts CRUD
- **做什么**：`ArtifactRepository`（type/content/fileRefs/functionModule/agentSessionId）+ `GET/POST /api/agent/sessions/:id/artifacts`。
- **验收**：A 阶段写设备档案/拓扑能存取；按 session 列出。

#### T-BE-04 报告 reviewStatus 过滤
- **做什么**：`ReportService.generateReport`/`getReportDetail`/`exportExcel` 所有 verdict 查询加 `WHERE reviewStatus='approved'`；`pending_review/rejected/skipped` 不算 pass。
- **验收**：老数据（默认 approved）定级不变；插一条 pending verdict 不进定级。

#### T-BE-05 GEC 种子条款补全
- **做什么**：在 `clauseSeed.ts` 补 GEC 族缺的"物理外部接口/可选接口可配置/输入方法弹性"等条款（clauseId 续 `5.3-6/7/8`，tags 标 `GEC`），支撑 P1 验收。
- **验收**：`listClauses` 能返回 GEC 完整判定项。

### 2.2 前端 P0

#### T-FE-01 类型与 API 契约
- **做什么**：`packages/shared/src/types.ts` 加 `AgentSession/AgentEvent/StepRun(扩展)/ClauseVerdict(扩展)/Artifact/Evidence(扩展)` 等类型；`api/endpoints.ts` 加 Agent/Notification/Knowledge/Skill 全部方法签名（先返回类型就位，后端可 mock 联调）。
- **验收**：`tsc --noEmit` 通过；不运行时崩溃。

#### T-FE-02 证据上传组件 EvidenceUploader
- **做什么**：`components/agent/EvidenceUploader.tsx`，多文件 + functionModule 标签选择 + 进度 + 图片预览/文件图标，产出 `{fileRef,mimeType,functionModule,label}[]`。后续人工卡片/证据挂载都复用。
- **验收**：上传成功回填、失败提示、图片可预览。

#### T-FE-03 常量与工具
- **做什么**：`utils/ui.ts` 加 `phaseMeta`（A/B/C/D 标签+颜色+图标）、`stepTypeMeta`、`functionModuleOptions`（网络/蓝牙/蜂窝/OTA/聊天/定位…）、`agentStatusColor/Text`、`reviewStatusColor/Text`、`notificationTypeMeta`。
- **验收**：后续组件直接用。

#### T-FE-04 Socket 事件层
- **做什么**：`api/socket.ts` 加 `subscribeAgentSession(sessionId, handlers)` 和 `subscribeNotifications(handlers)`；`hooks/useAgentEvents.ts` 按 `seq` 有序追加 + 断线重连补拉（`AgentApi.events(sinceSeq)`）；`hooks/useNotifications.ts`。
- **验收**：mock 事件能按序到达；断线后补齐不重复。

#### T-FE-05 会话页骨架 + 阶段时间线（mock 驱动）
- **做什么**：`pages/AgentSessions.tsx`（列表）、`pages/AgentSessionDetail.tsx`（布局：顶部 PhaseHeader + 左 2/3 时间线 + 右 1/3 侧栏 + 底部输入位）、`components/agent/PhaseTimeline.tsx`。用 mock agent_events 渲染步骤节点与阶段分组。
- **验收**：能渲染静态/流式时间线；阶段高亮；图标按 stepType 区分。

> 前端建议引入 **React Query** 管理服务端状态（列表/CRUD/缓存失效），实时事件流用 `useReducer`；老页面不动，渐进接入。

### 2.3 测试/数据 P0

- T-QA-01：扩展 `__tests__/migration.test.ts`——迁移 8 在空库/老库幂等、触发器有效、老 verdict approved 回填。
- T-QA-02：`ReportService` reviewStatus 过滤单测（approved 计入、pending 不计、老数据不变）。
- T-QA-03：EvidenceUploader 与 artifacts 接口的集成测试（内存库 + 临时目录）。

### 2.4 P0 验收门禁
- v7→v8 升级 + 回滚演练（additive 列保留无害，手动 down SQL 见附录）。
- 全部现有测试绿。
- mock 数据能驱动会话页骨架渲染出四阶段时间线 + 工具卡片 + 人工卡片样式。

---

## 3. P1：Agent 人机协同端到端

### 3.1 后端 P1 任务（依赖顺序）

#### T-BE-10 AiProvider 抽象 + DeepSeek 适配
- **文件**：`src/agent/ai/types.ts`、`deepseekProvider.ts`、`provider.ts`、`generationLogger.ts`、`config.ts`（加 `ai`/`agent` 段）、`package.json` 加 `openai`。
- **做什么**：
  - `AiProvider.chat({messages, tools, toolChoice, responseFormat, thinking, stream, signal})` 支持流式/非流式。
  - `DeepSeekProvider` 用 OpenAI SDK（baseURL `https://api.deepseek.com`），模型 planning=`deepseek-v4-pro`+thinking、narrative=`deepseek-v4-flash`。
  - 超时/AbortSignal、429/5xx 重试（最多 2 次，指数退避）、错误分类 `AiError(code)`。
  - 每次调用写 `ai_generations`（feature/provider/model/tokens/latency/status）+ audit。
  - `AI_ENABLED=false` 或无 key 时 `getAiProvider()` 抛 `ai_disabled`，不影响主服务。
- **验收**：mock fetch 单测覆盖 tool_calls、流式 delta、超时、重试、token 落库；无 key 启动正常。

#### T-BE-11 迁移 9：knowledge/skill/notification 表 + 种子
- **做什么**：建 `knowledge_notes`、`skills`（skillKey+version 唯一、isCurrent）、`notifications`；`src/db/agentSeed.ts` 把 Z6s 调试经验作为**手写 approved 的 seed skill**（离线可用，也是 SkillCompiler 的 golden file）+ 一条 knowledge_note；`seed.ts` 调用。
- **验收**：`seedAgentKnowledge` 幂等；seed skill 能被关键词检索；结构与 AI 编译产物一致。

#### T-BE-12 阶段状态机（phaseMachine）
- **文件**：`src/agent/phaseMachine.ts`（纯函数）。
- **做什么**：合法迁移 A→B→C→D；回退 C→B/B→A；非法跳转拒绝；`assertCanCreateVerdict(session)`；回退计数。
- **验收**：所有合法/非法路径单测；与 DB 触发器形成双保险。

#### T-BE-13 Agent 执行适配（复用 Orchestrator）
- **文件**：`src/agent/agentExecutor.ts`；扩展 `OrchestratorService.runAgentStep()`、`retryClauseSteps()`。
- **做什么**：
  - `runAgentStep` 建 step_run → 调 `ExecutionEngine.runModule/runCommand` → stdout/stderr 落 `filesDir/evidence/`、onProgress 透传 socket、cancelToken → 回写 evidence/verdict。重构现有 `persistResult` 为共享方法。
  - agent 会话创建一条 `project_runs`（mode=agent-guided，挂系统 agent 模板），所有 agent step 挂其下，复用报告/证据/重跑查询。
- **验收**：agent 步骤执行、流式输出、取消杀进程树、落盘与现有编排一致。

#### T-BE-14 工具桥 + 各 handler
- **文件**：`src/agent/toolBridge.ts` + `toolHandlers/{clauses,skills,artifacts,evidence,modules,humanStep,verdict,flow}.ts`、`humanStepCoordinator.ts`。
- **做什么**：白名单工具 schema（见 §5）；`plan_human_step` 返回 pending Promise，由 T-BE-16 路由 resolve；`create_verdict` 经 phaseMachine 校验，**pass/severity 调 `verdictEvaluator` 确定性计算**，AI 只给 clauseId/evidenceRefs/comment；高危/裸命令不在 schema 中。
- **验收**：每个 handler 单测；模型返回未授权工具被拒；参数非法回结构化错误让模型自纠。

#### T-BE-15 规划循环 + AgentService + 实时事件
- **文件**：`src/agent/plannerLoop.ts`、`agentService.ts`、`prompts.ts`、`routes/agent.ts`、`index.ts`（注册 socket 房间 `agent:${id}`）。
- **做什么**：
  - 系统 prompt 注入四阶段/当前 phase/设备档案/已选条款/skill 摘要/证据摘要/工具 schema/约束。
  - 循环：chat（stream）→ 文本写 `model_message`（折叠展示）→ tool_calls 派发 → 结果回灌；每步写 `agent_events`（seq 单调）+ socket 推送（见 §6 事件清单）。
  - `create/start/resume/abort/listEvents/listSteps/completeHumanStep/advance/rollback` 等门面；人工步骤超时由 coordinator 处理。
- **验收**：mock provider 下会话能 A→C 产出 step/evidence/pending verdict；abort 杀子进程；人工完成后循环继续；事件 seq 连续可回放。

#### T-BE-16 审核流 + 按条款局部重跑
- **文件**：`src/agent/reviewService.ts`。
- **做什么**：approve（写 reviewedBy/At）、reject（理由必填 → `Orchestrator.retryClauseSteps` 只重跑该 clauseId 绑定的 agent steps，新 verdict 仍 pending）、request-evidence（C→B 回退，需 confirm + rollbackCount 限次）。全部写 audit。
- **验收**：approve 后进报告；reject 只影响该条款；超限回退被拒。

#### T-BE-17 知识闭环 API
- **文件**：`routes/knowledge.ts`、`routes/skills.ts`、`src/agent/skillService.ts`。
- **做什么**：note CRUD + 附件；`POST /knowledge/compile-skill`（调 flash 模型产出 frontmatter+分节 body，返回草稿不直接 approved）；skill 列表/版本/审批/回滚；关键词检索（brand/model/platform/deviceType/module，LIKE 实现）。
- **验收**：写 Z6s 笔记 → 编译出结构化 skill 草稿 → 审核入库 → 新会话按"展锐/Z6s"检索命中。

#### T-BE-18 AI 主动通知（基础两类）
- **文件**：`src/agent/notificationService.ts`、`routes/notifications.ts`。
- **做什么**：在工具调用结束/阶段切换节点 `setImmediate` 异步评估（失败不阻断主流程）；P1 只产 `tool_sediment`（某命令稳定执行≥2 次）、`skill_sediment`（遇到未识别设备型号）；写 notifications + socket 推 `notification:new`；accept 返回**预填 action payload**（不现场写库）。
- **验收**：通知非阻塞；accept 返回跳转目标；dismiss/snooze 状态正确。

#### T-BE-19 报告 AI 叙述
- **文件**：`src/agent/reportAiService.ts`。
- **做什么**：基于代码算好的 grade/byChapter/failBySeverity，用 flash 生成摘要 + 逐条整改建议，存 `report_ai_sections`；导出标注"AI 生成仅供参考"；数字不被模型覆盖。
- **验收**：可单独刷新；去掉 AI 段报告数字不变。

### 3.2 前端 P1 任务（依赖 T-FE-* 与后端契约）

| 任务 | 组件 | 要点 |
|---|---|---|
| T-FE-10 新建会话向导 | `pages/AgentNewSession.tsx` | 选项目/设备档案 + 条款树（复用 ClausesApi.tree，章节全选）+ 授权工具 → create → 跳详情 |
| T-FE-11 会话页 + 时间线 | `pages/AgentSessionDetail.tsx`、`PhaseHeader`、`useAgentSession`(useReducer+socket) | 接真实事件；A/B/C/D 分组；当前阶段高亮；运行中 loading |
| T-FE-12 工具调用卡片 | `components/agent/ToolCallCard.tsx` | 工具名/入参(折叠 JSON)/输出(复用 Terminal，按 toolCall 收 stdout chunk，结束用 tool_result 对账)/退出码/耗时/证据链接；失败可重试 |
| T-FE-13 人工步骤卡片 | `components/agent/HumanStepCard.tsx` | 琥珀色边框+脉冲；instruction(Markdown)+expectedOutcome+参考命令+EvidenceUploader；"完成并继续"/"我遇到问题"；waiting_human 时置顶+标题闪烁；强制证据时禁用按钮 |
| T-FE-14 证据附件 + 工件侧栏 | `EvidenceAttachCard`、`ArtifactPanel` | 功能模块标签；B 证据 clauseId=null；C 证据可被 verdict 引用并点击定位；图片 antd Image 预览 |
| T-FE-15 判定审核面板 | `VerdictReviewPanel`、`RetryClauseModal` | pending 列表（条款+pass/fail+reason+证据 chips）；通过/拒绝(必填理由)/补采(二次确认)；未审核角标计数 |
| T-FE-16 AI 对话折叠 + 输入 | `AiTranscriptCollapse`、`AgentChatInput` | 模型文本折叠展示（不掺工具调用）；随时发消息打断/补充 |
| T-FE-17 通知中心 | `components/notifications/{Bell,List,Handler}` | 顶栏 Badge；按类型图标/颜色；接受→NotificationHandler 路由到预填表单（tool→ToolEditorDrawer、skill→SkillCompilePreview、evidence→展开上传、template→ComplianceTemplateEditor） |
| T-FE-18 知识库页 | `pages/Knowledge.tsx`、`components/knowledge/{NoteEditor,SkillCompilePreview,SkillList,SkillVersionDrawer}` | Markdown+附件+标签；"AI 编译 skill"预览（frontmatter 可编辑+分节正文）；版本/回滚 |
| T-FE-19 会话列表 + 回看 | `pages/AgentSessions.tsx` | 分页/筛选/实时状态；已完成会话只读回看 + "基于此案例新建会话" |
| T-FE-20 导航/路由整合 + 项目入口 | `App.tsx`、`ProjectDetail.tsx` | 加"Agent 测试""知识库"导航；铃铛全局可见；项目页加"Agent 引导测试"入口（mode=agent-guided） |
| T-FE-21 报告 AI 叙述 + 附录 | `components/project/ReportTab.tsx` | "AI 整改建议"区（标注仅供参考）+ A/B 过程附录（折叠，从会话拉取） |

### 3.3 测试 P1

- **单测**：AiProvider(mock)、toolBridge 各 handler、phaseMachine、通知生成、skill 编译、review 状态机、按条款重跑、阶段边界（非 C 写 verdict 被拒）。
- **集成测试**：`agentFlow.integration.test.ts` 用内存 repos + FakeAiProvider 脚本化驱动完整四阶段（A 人工→B nmap/证据→C verdict→D 审核），断言：session done、events 按 seq 连续、B 证据 clauseId=null 且有 functionModule、verdict 默认 pending、approve 后 grade 正确、通知产生、双写审计。
- **E2E 脚本**（`scripts/e2e-agent-gec.mjs`，CI 用 mock DeepSeek + fixture，真设备演示换真 API）：8 步验收（见 §0 第 6 点 / feasibility §10），全绿即 P1 通过。

---

## 4. 数据模型（最终形态）

> 迁移拆两个：**迁移 8**（P0：session/event/artifact + 各表字段扩展 + 触发器），**迁移 9**（P1：knowledge_notes/skills/notifications + seed）。SQLite 约定：JSON 存 TEXT、布尔 INTEGER 0/1、时间 TEXT(ISO)、主键 TEXT UUID。

### 4.1 扩展现有表

```sql
-- step_runs
stepType TEXT; phase TEXT; functionModule TEXT; instruction TEXT;
expectedOutcome TEXT; artifacts TEXT DEFAULT '[]'; agentSessionId TEXT;
CREATE INDEX idx_step_runs_agent_session ON step_runs(agentSessionId);

-- clause_verdicts（回填 approved 是关键兼容决策）
reviewStatus TEXT NOT NULL DEFAULT 'approved';
reviewedBy TEXT; reviewedAt TEXT; reviewNote TEXT; aiGenerated INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_verdicts_review ON clause_verdicts(reviewStatus);

-- evidences
clauseId TEXT; functionModule TEXT; sourceStepType TEXT; mimeType TEXT;

-- projects
mode TEXT NOT NULL DEFAULT 'template';
```

### 4.2 新表（要点）

- **agent_sessions**：`id, projectId, projectRunId, deviceProfile(json), selectedClauses(json), authorizedTools(json), phase(CHECK), status(CHECK), planningModel, narrativeModel, currentStepId, rollbackCount, tokenUsage(json), createdBy, 时间戳`。
- **agent_events**（append-only）：`id, sessionId, seq UNIQUE, type(CHECK: model_message/tool_call/tool_result/human_step/phase_change/verdict_draft/notification/error/user_message), role, content, contentFileRef(大字段落文件), toolName, toolArgs(json), toolStatus, stepRunId, model, tokens, latencyMs, createdAt` + 禁止 UPDATE/DELETE 触发器。
- **artifacts**：`id, projectId, projectRunId, agentSessionId, type(device_profile/network_topology/onboarding_result/other), title, content, fileRefs(json), functionModule, createdBy, createdAt`。
- **knowledge_notes**：`id, title, content(md), tags(json), attachments(json), sourceType(manual/url/case), sourceUrl, author, 时间戳, deletedAt`。
- **skills**：`id, skillKey, title, frontmatter(json: brands/models/platforms/deviceTypes/functionModules/clauses/summary), body(md 分节), sourceNoteIds(json), sourceCaseIds(json), version, isCurrent, status(draft/approved/archived), author/approver, 时间戳, deletedAt`，`UNIQUE(skillKey,version)`。
- **notifications**：`id, userId, type(tool_sediment/skill_sediment/evidence_gap/template_save/config_fix/review_hint), title, message, reason, payload(json 预填数据), sessionId, projectId, status(unread/read/accepted/dismissed/snoozed), snoozedUntil, createdBy, actedAt/By, createdAt`。
- **ai_generations**（审计）：`id, sessionId, stepRunId, feature, provider, model, prompt/completion/totalTokens, latencyMs, status, error, createdBy, createdAt`。
- **report_ai_sections**：`reportId PK, summary, remediation(json), model, createdAt`。

CHECK 约束：phase/status/reviewStatus/stepType/notification.type 的枚举值（一期值稳定，建议加，兜住应用层 bug）。

### 4.3 阶段边界触发器

```sql
CREATE TRIGGER clause_verdicts_phase_guard
BEFORE INSERT ON clause_verdicts
WHEN EXISTS (SELECT 1 FROM step_runs sr WHERE sr.id = NEW.stepRunId AND sr.agentSessionId IS NOT NULL)
 AND NOT EXISTS (SELECT 1 FROM step_runs sr JOIN agent_sessions s ON s.id=sr.agentSessionId
                 WHERE sr.id=NEW.stepRunId AND s.phase='adjudication')
BEGIN SELECT RAISE(ABORT,'verdict only in adjudication phase'); END;
```
模板模式（agentSessionId 为 NULL）放行，避免老编排被误杀。无证据 verdict 不适合 SQL 触发器（JSON 长度跨版本不一致），放应用层置 skipped。

---

## 5. Agent 工具清单（白名单）

| 工具 | 作用 | 回落的现有底座 |
|---|---|---|
| `list_clauses` / `get_clause` | 读条款 | `repos.clauses` |
| `search_skills({brand,model,platform,deviceType,module,q})` | 检索 skill | `SkillService.search` |
| `write_artifact(type,title,content,fileRefs?)` / `read_artifact(type?)` | A/B 工件 | ArtifactService |
| `attach_evidence(functionModule,label,fileRef?)` | 登记/引导上传证据 | 建 evidence_attach stepRun |
| `read_evidence(functionModule?,clauseId?)` | 读已收集证据摘要 | `repos.results` |
| `run_module(moduleId,params)` | 执行内置模组（结构化输出） | **OrchestratorService.runAgentStep → ExecutionEngine.runModule**，onProgress 透传 socket |
| `plan_human_step(title,instruction,expectedOutcome,referenceCommand?,evidenceReq?)` | 人工硬件操作（阻塞） | HumanStepCoordinator.wait |
| `create_verdict(clauseId,evidenceRefs,comment)` | 提交判定草案 | phaseMachine 校验 + **verdictEvaluator 确定性算 pass/severity**，AI comment 仅补充 reason；默认 pending_review |
| `advance_phase(target)` / `request_rollback(targetPhase,reason)` | 流程控制 | phaseMachine；rollback 置 waiting_confirm 等人确认 |

**永不暴露**：`CommandExecutor.runCommand` 裸 shell。命令能力只经模组/已注册命令工具，高危走审批。

---

## 6. WebSocket 事件契约

房间：`agent:${sessionId}`、`user:${userId}`。所有事件带 `seq`（会话内单调）。

| 事件 | payload | 前端处理 |
|---|---|---|
| `agent:session` | status, phase, currentStepId | 更新 PhaseHeader/状态 |
| `agent:phase` | from, to | 时间线插分隔 |
| `agent:step_started` | stepRunId, stepType, phase, title, seq | 追加节点（running） |
| `agent:tool_call` | stepRunId, toolCallId, tool, args | 建/更新 ToolCallCard（展开入参） |
| `agent:tool_output` | stepRunId, toolCallId, stream, chunk | append 到该卡片 Terminal |
| `agent:tool_result` | stepRunId, toolCallId, status, exitCode, durationMs, output?, evidenceRefs, artifactRefs | 对账完整输出、状态/耗时/关联证据 |
| `agent:human_step_requested` | stepRunId, instruction, expectedOutcome, referenceCommand, evidenceReq | 弹 HumanStepCard，置 waiting_human，滚动定位 |
| `agent:human_step_completed` | stepRunId, fileRefs | 卡片收起为已完成 |
| `agent:evidence_attached` | evidence | ArtifactPanel 追加 |
| `agent:artifact_written` | artifact | 工件侧栏追加 |
| `agent:verdict_drafted` | verdict | 审核面板追加 pending |
| `agent:verdict_updated` | id, reviewStatus, reviewNote | 更新状态 |
| `agent:message` | role, content | AI 对话折叠区追加（用户消息回显） |
| `agent:waiting_confirm` | request{targetPhase,reason} | 回退确认弹窗 |
| `agent:progress` | stepRunId, percent, message | 进度条 |
| `agent:error` | message, stepRunId? | 错误条 |
| `agent:done` | status | 停止轮询、刷报告 |
| `notification:new` | notification | 通知中心追加 + 角标 +1 |

**可靠性**：首屏 `GET /events?sinceSeq=` 拉历史；socket 断线重连补缺口；`tool_result` 到达后用完整 output 重置 Terminal buffer（防 chunk 丢/乱序，复用现有 `toLines` 对账逻辑）；3s 轮询 session 状态兜底。

---

## 7. 关键交互细节

1. **人工步骤 vs AI 通知**视觉强区分：人工步骤=琥珀色边框+脉冲+置顶+标题闪烁；通知=蓝色铃铛角标+Popover，不抢焦点、不阻塞。
2. **点通知"接受"只打开预填表单**，人点保存才落库（tool_sediment 打开新建命令工具并预填、skill_sediment 打开 skill 预览、evidence_gap 定位到步骤、template_save 打开合规模板编辑器）。
3. **AI 文本标注**：判定 reason、整改建议、skill 草稿均标"AI 生成，仅供参考"；定级数字标"由系统计算"。
4. **证据先文件后 DB**：上传先写文件（内容哈希命名），事务里写 fileRef；事务回滚的孤儿文件定时 GC。
5. **Markdown 安全**：note/AI 文本用 react-markdown + rehype-sanitize，禁 raw HTML。
6. **高频输出性能**：stdout chunk 用 `useLogBuffer`（cap 截断）+ React.memo，按 stepRunId 拆卡片，避免整时间线重渲染。
7. **可访问性**：人工等待建议桌面通知（Notification API，需授权）。

---

## 8. 风险与对策（实施视角）

| 风险 | 对策 |
|---|---|
| AI 规划跑偏/选工具错误 | 工具白名单 + zod 校验；错误结构化回灌让模型自纠；循环上限；判定 pass 不由模型决定 |
| socket 丢事件 | seq 排序 + 断线补拉 + 轮询对账；tool_result 完整对账 |
| dsh rc 破坏性变更 | 一期完全不依赖；AiProvider 抽象隔离；P3 子进程+版本锁 |
| 人工步骤卡死 | 超时（后端给剩余时间）→ 卡片变灰"已归档，可在会话列表恢复"；会话生命周期管理 |
| 双写不一致 | 平台库单事务写 step+events+audit；通知独立事务失败只记日志；文件先写后引用+GC |
| 成本失控 | 工具清单按章节筛选+Context Caching；planning 用 pro、成文用 flash；token 预算+审计 ai_generations |
| 证据外发合规 | `ai.dataSharing.sendFiles=false`（固件/pcap 不传），只传截断摘要；二期本地模型 |
| 阶段边界被绕过 | 应用层 service 单一入口 + DB 触发器兜底；无证据 verdict 自动 skipped |
| 高危命令误触 | Agent 路径不暴露裸 shell；高危工具审批；命令工具试跑后才沉淀 |
| 角色权限 | 一期即打开 `AuthzService.assertRole`（本地配置版）；审核/跳过/skill 审批按角色禁用按钮+后端强校验 |

---

## 9. 人员与并行建议

- **P0**：后端 1 人（T-BE-01~05）、前端 1 人（T-FE-01~05）、测试 0.5 人（T-QA-*）并行；第 3 天对齐 API 契约（OpenAPI/类型即契约）。
- **P1**：后端按 T-BE-10→11→12→13→14→15→16→17→18→19 串行走（前 4 个可与前端 T-FE-10/11 并行）；前端按 T-FE-10→20 依赖顺序；测试在 P1 后半段进入集成/E2E。
- 每日用内存库 + FakeAiProvider 跑一次端到端脚本，避免最后集成爆炸。

---

## 10. P1 完成判据（DoD）

- [ ] Z6s skill 种子入库，新建 Z6s+GEC 会话时 Agent 能检索到并给出该设备的 A 阶段人工接入步骤。
- [ ] 人工步骤完成（含截图上传）后 B 阶段证据带 functionModule 落库（clauseId=null）。
- [ ] C 阶段 Agent 执行模组/命令并引用 B 证据产出 pending verdict；无证据条款 skipped；非 C 阶段写 verdict 被拒。
- [ ] D 阶段 approve 进定级；reject 一条只重跑该 clauseId 步骤；grade 由代码计算，与人工结论一致。
- [ ] 过程产生 ≥1 条沉淀通知，接受后打开预填表单但不自动入库。
- [ ] 知识库：写笔记→AI 编译 skill 草稿→人审核→新会话检索命中。
- [ ] 所有动作在 agent_events（seq 连续）+ audit_logs 可回放；append-only 表 UPDATE/DELETE 被拒。
- [ ] AI 不可用时主流程（手动编排/执行/报告）不受影响。
- [ ] 单测 + 集成 + E2E（mock）全绿；现有 42 个测试不回归。
