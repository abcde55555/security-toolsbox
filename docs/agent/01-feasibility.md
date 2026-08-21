# DeepSeek Agent 集成可行性方案（v0.3）

> **文档版本**：v0.3（整合修订稿）
> **产出日期**：2026-08-21
> **状态**：待评审（可在本文件直接加注释/批注）
> **输入依据**：
> - `docs/agent/dsh-integration-feasibility.md`（DeepSeek Harness 源码级调研，dsh-v0.1.0-rc.8）
> - `docs/agent/Agent-Upgrade-Plan.md`（智能体升级改造方案 v1.2）
> - `docs/agent/小天才手表Z6s/`（真实设备测试草稿，验证场景复杂性）
> - 本仓库现有代码与文档
>
> **v0.3 相对 v0.2 的关键变化**：v0.2 假设"动作固定、一键生成静态模板"，读了 Z6s 真实测试笔记后该假设不成立——完整合规测试含大量硬件人工操作与无法预编排的证据收集。本版采纳 Agent-Upgrade-Plan 的"分阶段人机协同"为主线，但**把 dsh 依赖从一期推到二期**，一期用平台自有 Agent 编排 + DeepSeek（OpenAI 兼容）API 实现，降低 rc 版本风险。

---

## 0. 术语

| 术语 | 含义 |
|---|---|
| **阶段（Phase）** | 一次完整测试的四个阶段：A 准备 / B 收集 / C 判定 / D 审核。只有 C 映射 EN18031 条款。 |
| **测试工件（Artifact）** | 阶段 A/B 产物（设备档案、网络拓扑、抓包文件、固件、截图），`clauseId=null`，供阶段 C 引用。 |
| **判定草案** | Agent 分析证据后生成的 `ClauseVerdict`（`pending_review`），人工审核后才生效。 |
| **人工步骤** | Agent 暂停并引导用户在物理设备上操作（短接、装驱动、输暗码、抓包、截图），用户完成后继续。 |
| **dsh** | DeepSeek Harness，开源 agent 运行时（Crc.8 预览版）。本方案二期才考虑接入。 |
| **AiProvider** | 平台自有的模型调用抽象，一期对接 DeepSeek Chat API，二期可换 dsh/其他模型。 |
| **模板 / Test Plan** | 平台已有的 `Template`（条款绑定 + 步骤），在本方案中是**阶段 C 流程固化后的效率选项**，不是主线。 |

---

## 1. 一句话结论

**可行，但要按"人机协同分阶段测试"来做，不能做成"一键生成模板跑到底"。**

- **主线**：用户选定设备 + 法规模块 → Agent 按 A 准备 → B 证据收集 → C 条款判定 → D 审核报告 四个阶段动态规划，自动步骤与人工步骤交替，证据驱动，判定需人工审核；定级与合规则由平台确定性引擎保证。
- **一期不依赖 dsh**：用稳定的 DeepSeek OpenAI 兼容 API + 平台自有的 Agent 编排逻辑实现，避免被 rc 版本的破坏性变更绑死。dsh 作为二期可插拔的执行 runtime（SDK 子进程）。
- **AI 的边界**：负责规划下一步、选工具、解释证据、生成判定草案与报告叙述；**不负责定级、不直接执行未审批命令、不绕过人工步骤**。
- **平台的确定性底座全部保留**：执行引擎、条款映射、判定聚合、报告定级、审计、工具/条款管理不动。

核心理由：Z6s 测试笔记证明，真实合规测试"工具不固定、流程不固定、强依赖硬件人工操作"（短接进 EDL、RTOS 串口、暗码开 U 盘、多工具抓包、逐界面截图），纯脚本编排无法通用；但"判定什么、怎么算过"是法规明确的、确定性的。把生成式决策交给 Agent、把合规判定交给确定性引擎，是正确分工。

---

## 2. 为什么 v0.2 的"一键静态模板"不够

Z6s 草稿暴露的真实情况（见 `小天才手表Z6s.md`）：

1. **前期准备无法预编排**：短接金点进 9008（8-10 秒窗口）、安卓高版本"点二维码 5 下 + 长按绑定号 + 校验码平台开调试"、RTOS 装驱动/短接/输暗码 `*#0769789#*`——全是人工硬件操作。
2. **证据收集与条款判定分离**：抓包时按"功能模块"存证（WiFi/蓝牙/蜂窝/升级/聊天），采集时不知道最终判哪条；判定阶段才把证据分配给 GEC/SCM/CCK/CRY。强制每步绑条款会把准备工作硬塞进条款，建模错误。
3. **设备分型导致流程分叉**：同是小天才，高通安卓 vs 展锐 RTOS 调试方式完全不同，Agent 要根据设备信息动态选路径。
4. **外部工具多且产出物形态杂**：nmap（TCP/UDP 截图）、wireshark/bp（加密包分析）、EMBA/binwalk（固件解包）、Nessus、airodump-ng（WiFi 空口）、蓝牙抓包、串口工具——需要挂载外部产出物（pcap、固件、截图、nmap XML）。
5. **大量截图证据**：笔记里 80 张截图，覆盖客户端界面、nmap 结果、wireshark 解析、BLE GATT、证书等——需要"证据截图上传 + 关联条款"能力。

结论：需要的是"Agent 引导 + 人工执行 + 证据沉淀 + 判定审核"的半结构化流程，不是一张静态模板。

---

## 3. 目标工作流：Agent 引导的人机协同分阶段测试

### 3.1 四阶段模型

四个阶段是**逻辑分层**，不是固定流程清单。每个阶段具体做什么、做多少、按什么顺序，由 Agent 根据设备型号/平台/能力动态规划，设备之间差异很大（见 §2）。

| 阶段 | 名称 | 映射条款 | 执行主体 | 产物 |
|---|---|---|---|---|
| A | 前期准备 Onboarding | 否 | Agent 规划 + 人工硬件操作 + 设备工具 | 设备档案、接入方式（artifacts，clauseId=null） |
| B | 证据收集 Collection | 否 | Agent 规划 + 人工引导 + 工具执行 | pcap/串口日志/固件/截图（evidences，clauseId=null，带功能模块标签） |
| C | 条款判定 Adjudication | **是** | Agent 选工具 + 分析 B 阶段证据 | `pending_review` 判定草案（带 evidenceRefs） |
| D | 审核与报告 Review | 继承 C | 用户审核 + 确定性定级 | approved 判定、grade、报告、整改建议 |

> **A/B 的内容不是固定的**：A 阶段对 Z6s（展锐 RTOS）是"装驱动+短接+输暗码开 U 盘"，对高通安卓可能是"点二维码 5 下+校验码平台开 adb"，对某些设备可能是"adb 直连"甚至"拆 PCB 飞线"。Agent 要做的是根据设备档案和 skill/知识库选出该设备的接入路径，而不是套一个固定清单。B 阶段同理，抓哪些包、跑哪些工具取决于 A 阶段识别出的接口/能力。

**为什么必须分阶段**：法规只规定"判定阶段测什么、怎么算过"，不规定"怎么接设备、怎么抓对包"；后者依赖设备特性与人工经验，正是 Agent 动态规划的价值。A/B 的过程记录进报告附录（可追溯），但**不参与定级**；只有 C/D 的判定进合规主体。

### 3.2 一次完整流转

```
选设备 + 选法规模块（阶段 C 的条款集合 + 授权工具集）
  ↓
[A 准备] Agent 根据设备型号/平台动态规划接入步骤（每台设备不一样）：
         查 skill/知识库确定调试接口开启方式 → 人工步骤卡片
         （可能是短接/暗码/驱动/二维码校验/adb直连/飞线……按设备而定）
         产物：设备档案、接入方式 → artifacts
  ↓
[B 收集] Agent 按 A 阶段识别出的接口/能力动态规划证据采集：
         哪些模块要抓包、跑 nmap、提固件、截图——取决于设备有什么
         人工引导（边点 App 边抓包）+ evidence_attach
         产物：证据文件（clauseId=null，functionModule 标签）
  ↓
[C 判定] Agent 针对已选条款：
         - 选内置模组/工具执行（module_exec，参数可注入 A 阶段设备档案）
         - 分析 B 阶段证据（pcap/截图/固件），跨阶段引用 evidenceRefs
         - 产出 pending_review 判定草案
         证据不足时可请求回退 B 补采（需用户确认，限次数）
  ↓
[D 审核] 用户逐条审核：
         通过 → approved（进定级）
         拒绝 + 理由 → Agent 按 clauseId 局部重跑 C 相关步骤（不影响其他条款）
         ReportService 确定性定级；A/B 过程进附录；AI 整改建议确认后并入
```

### 3.3 步骤类型（stepType）

| stepType | 执行主体 | 产物 | 阶段 |
|---|---|---|---|
| `tool_exec` | 平台 ExecutionEngine（模组/命令） | ExecutionResult + evidence | A/C |
| `human_instruction` | 用户（看指令、操作硬件、点完成） | 完成记录 + 上传文件 | A/B |
| `evidence_attach` | Agent 引导 + 用户/工具产出 | pcap/截图/日志落文件库 | B |
| `analysis` | Agent（模型分析结构化证据） | 判定草案 | C |

### 3.4 判定审核流（关键）

- Agent 在 C 阶段生成的判定一律 `reviewStatus='pending_review'`，**不进报告定级**。
- 报告定级只算 `approved` 判定；未覆盖条款按 not-covered。
- 拒绝时必须填理由（写审计），Agent 据此**按条款局部重跑**（复用现有 retry 机制，扩展为"按 clauseId 重跑一组步骤"），不重置其他条款。
- 证据不足可**回退 B 补采**，再回 C 重新分析；阶段间反向迭代需用户确认 + 限次数。
- 所有审核动作（谁/何时/哪条/结果）写 append-only 审计。

### 3.5 人工步骤语义

- Agent 调 `request_permission`/human_step → 前端会话页弹"指令卡片"：步骤说明、预期结果、可选参考命令、**证据上传区**。
- 用户完成物理操作后点"继续"，可附截图/日志；平台写入该步骤 evidence，放行 Agent。
- 用户可随时打断、补充信息让 Agent 调整计划。
- 人工步骤有超时/挂起策略（提醒、归档），避免会话泄漏。

### 3.6 设备差异从哪来：skill 知识库，不是硬编码

A/B 阶段"这台设备该怎么做"不能写死在代码里。来源应是：

1. **平台 skill 库**：把每类设备/平台的调试方法、接口开启步骤、常见工具沉淀成可检索的知识条目（类似 dsh 的 `SKILL.md`），按"品牌/平台/芯片"打标签。Agent 根据 A 阶段识别出的型号/平台（高通安卓、展锐 RTOS、Linux 摄像头、路由器 OpenWrt……）检索对应 skill，动态生成该设备的准备/收集步骤。
2. **用户补充与修正**：用户可在会话中纠正 Agent 的步骤（如"这台不用短接，adb 直接开"），修正可沉淀回该型号的 skill（二期），越用越准。
3. **设备档案驱动**：A 阶段产出的设备档案（型号、固件版本、开放接口）是后续 B/C 阶段选工具、选参数的依据。

因此平台要支持 skill 的录入/检索/版本管理；一期可先内置少量设备的 skill（含 Z6s 这类样例），验证动态规划闭环，不追求覆盖全部设备。

---

## 4. 平台现状盘点

### 4.1 已有确定性底座（保留不动）

| 能力 | 位置 |
|---|---|
| 执行引擎（runCommand/runModule，取消/超时） | `engine/executionEngine.ts`、`commandExecutor.ts` |
| 模组加载器 + 4 个内置模组 | `engine/moduleLoader.ts`、`packages/modules/*` |
| 编排引擎（DAG、并发、失败策略、compliance 聚合、retry） | `services/orchestratorService.ts` |
| 条款判定（verdictEvaluator、clauseMapping） | `services/verdictEvaluator.ts`、`clauseMappingService.ts` |
| 报告确定性定级与导出 | `services/reportService.ts` |
| append-only 审计、权限钩子 | `auditRepository.ts`、`authzService.ts` |
| 工具/条款/标准/分类管理 | 各 repository + 前端页面 |
| 文件证据存储、流式命令测试终端 | `config.filesDir`、`/api/test-command/stream` |
| 合规模板编辑器（条款树 + 步骤 + verdictRule + 聚合） | `components/ComplianceTemplateEditor.tsx` |

### 4.2 一期需要新增的

1. **Agent 会话与编排**：不依赖 dsh，用 DeepSeek API 自有的规划循环（见 §5.3）。
2. **阶段与人工步骤语义**：`stepType`、`phase`、`ClauseVerdict.reviewStatus`、按条款局部重跑、阶段回退。
3. **测试工件（artifacts）**：A/B 产物先存证、C 再分配条款。
4. **Agent 工具桥**：把平台工具/模组/条款/工件查询包装成 function-calling 工具；执行回落平台 API。
5. **证据附件与功能模块标注**：上传 pcap/截图/固件，B 阶段 `clauseId=null + functionModule`。
6. **前端 Agent 入口**：模块选择 → 会话页（阶段时间线 + 指令卡片 + 审核面板 + 工件视图）。
7. **AI 成文**：报告叙述/整改建议（数字由代码算）。

### 4.3 一期明确不做

- ❌ 不拉取/不嵌入 dsh runtime（二期评估）
- ❌ 不让模型直接执行任意 shell（命令走工具桥 + 审批）
- ❌ 模型自我迭代写插件入库
- ❌ 多智能体/子代理编排
- ❌ 会话历史跨大版本兼容承诺

---

## 5. 架构方案

### 5.1 总体架构

```
┌──────────────────────────────────────────────┐
│ 平台（自研，全部合规证据/判定/审计在此）          │
│ 前端：模块选择 + Agent 会话页 + 现有管理页       │
│ 业务层：AgentService / HumanStep / Review /    │
│        Artifact / AgentToolBridge / ReportAI   │
│ 执行引擎（现有）：ExecutionEngine + Orchestrator│
│ 持久化：clause_verdicts(+reviewStatus) /       │
│   evidences(+clauseId,functionModule) /        │
│   step_runs(+stepType,phase) / artifacts(新) / │
│   agent_sessions(新) / audit_logs              │
└───────────────┬──────────────────────────────┘
                │ AiProvider 接口（OpenAI 兼容）
        ┌───────┴────────┐
        │ DeepSeek Chat  │  （一期）
        │ v4-pro/flash   │
        └────────────────┘
                ▲
                │ 二期：可替换/叠加 dsh SDK 子进程
                │ （路径 A，stdio JSON-RPC，特性开关）
```

### 5.2 AiProvider 抽象（关键解耦）

```ts
interface AiProvider {
  chat(opts: {
    model?: string;
    messages: ChatMessage[];
    tools?: ToolSchema[];          // OpenAI function-calling
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
    responseFormat?: { type: 'json_object' } | { type: 'json_schema'; schema: unknown };
    thinking?: boolean;
    stream?: boolean;
    signal?: AbortSignal;
  }): Promise<ChatResult> | AsyncIterable<ChatChunk>;
}
```

- 一期实现 `DeepSeekProvider`（baseURL `https://api.deepseek.com`，OpenAI SDK）。
- 二期可加 `DshProvider`/本地模型 provider；上层业务不感知。
- prompt、few-shot、output schema 放配置/DB，模型版本在 config 锁死（不用 `latest`）。

### 5.3 一期 Agent 编排循环（不依赖 dsh）

用一个简单的"模型规划 → 工具调用 → 结果回灌 → 继续"循环实现，这是 OpenAI function-calling 的标准模式，成熟稳定：

1. 系统 prompt 注入：四阶段定义、当前阶段、已选条款、已收集证据摘要、可用工具 schema、输出约束。
2. 模型返回：
   - `function_call` → 平台执行工具（tool_exec / human_step / evidence_attach / clause_query / artifact_write / advance_phase / request_review），结果回灌。
   - 文本/结构化 JSON → 作为阶段计划或判定草案。
3. 人工步骤由 `human_step` 工具触发：平台落一条 `human_instruction` stepRun，前端弹卡片，Promise 等用户"完成"后回灌结果。
4. 阶段推进由 `advance_phase` 显式触发，平台校验（如 B→C 前确认证据齐全）。
5. 全部步骤/工具调用/模型决策落 `step_runs` + `agent_sessions`，可回放。

> 这比 dsh 的 Cordis 微内核简单得多，且完全可控；二期若上 dsh，把这个循环替换为 dsh runtime 即可，业务数据格式不变。

### 5.4 工具桥（Agent 能调用什么）

**给模型的工具（粗粒度、白名单、结构化输出）**：
- `list_clauses(standard, chapter)` / `get_clause(id)` — 读条款
- `plan_step(phase, title, instruction, expectedOutcome, evidenceReq)` — 登记一个自动/人工步骤
- `run_module(moduleId, params)` — 执行内置模组（返回结构化 ExecutionResult）
- `attach_evidence(functionModule, label, fileRef?)` — 登记证据附件（引导用户上传）
- `write_artifact(type, content)` — 写设备档案/拓扑
- `read_evidence(functionModule?)` / `read_artifact(type)` — 读已收集证据
- `create_verdict(clauseId, pass, reason, evidenceRefs)` — 提交判定草案（服务端校验 evidenceRefs 存在）
- `request_phase_advance(target)` / `request_human_input(instruction)` — 流程控制

**不暴露给模型**：`CommandExecutor.runCommand`（任意 shell）。命令型工具只能通过模组/已注册命令工具执行，且高危走审批。

### 5.5 阶段边界强制（服务端 + 落库双校验）

- 非 C 阶段步骤写 `clause_verdicts` → 拒绝。
- C 阶段 verdict 无 `clauseId` 或无 evidenceRefs → `skipped`。
- `reviewStatus` 默认 `pending_review`；只有 `approved` 进定级。
- A/B 的 evidence `clauseId=null`，C 通过 `evidenceRefs` 跨阶段引用。

---

## 6. 数据模型变更

1. `step_runs` 增加：`stepType ('tool_exec'|'human_instruction'|'evidence_attach'|'analysis')`、`phase ('onboarding'|'collection'|'adjudication'|'review')`、`functionModule`、`instruction`、`expectedOutcome`、`artifacts(json)`、`agentSessionId`。
2. `clause_verdicts` 增加：`reviewStatus ('pending_review'|'approved'|'rejected'|'skipped')`、`reviewedBy`、`reviewedAt`、`reviewNote`。
3. `evidences` 增加：`clauseId?`（可空）、`functionModule?`、`sourceStepType?`、`fileRef?`、`mimeType?`。
4. 新表 `artifacts`：`id, projectRunId, type('device_profile'|'network_topology'|'onboarding_result'|'other'), content(json/text), fileRefs(json), createdAt`（clauseId 恒 null）。
5. 新表 `agent_sessions`：`id, projectId, presetId(可选), phase, status, model, currentStepId, createdAt, updatedAt`；模型对话/工具调用事件可放 append-only `agent_events`（或复用审计日志）。
6. `projects` 增加 `mode ('template'|'agent-guided')`。
7. **落库强制校验**：非 adjudication 阶段不得写 verdict；verdict 必须带 clauseId。

> Z6s 笔记里的截图、pcap、固件、nmap 输出，都走 evidences.fileRef/artifacts.fileRefs 存 `filesDir/evidence/`，functionModule 标签对应"网络/蓝牙/升级/聊天/定位"等模块，与判定阶段的条款检索对齐。

---

## 7. 与 dsh 的关系（二期）

- dsh 现状：`0.1.0-rc.8`，8/13 开源，8/17 rc.7，8/20 rc.8，已发生 SQLite 存储不兼容（SCHEMA_VERSION=17，旧盘拒绝打开、无迁移）。**1.0 前不进主链路。**
- 一期用 §5.3 自有循环，已能覆盖人机协同；dsh 的增量价值在：session log 事件溯源回放、preset/skill 生态、子代理、workflow 脚本——这些是二期"探索性诊断"场景需要的。
- 二期接入方式采纳 dsh 调研的**路径 A（SDK 子进程，stdio JSON-RPC）**，平台与 dsh 仅走协议，不进程内嵌；版本锁定；dsh 持久化目录独立；报告/证据双写平台库。
- 双向打通：平台模组包装成 dsh `defineTool` 薄插件可进 dsh 生态；dsh 第三方插件经 AgentToolBridge 反向挂载。
- 一期代码结构预留 `AiProvider` 接口，使二期接 dsh 时业务层改动最小。

---

## 8. Z6s 草稿对平台能力的需求清单

> 注意：下表是**小天才 Z6s（展锐 RTOS）这一款设备**的测试做法，用于验证平台需要哪些能力，**不是固定流程模板**。其他设备（高通安卓手表、摄像头、路由器、门锁……）的 A/B 阶段动作完全不同，但需要的平台能力是相通的。

| Z6s 上的具体做法 | 平台需要的通用能力 | 阶段 |
|---|---|---|
| 读官网/文档识别接口、资产 | Agent 读 URL/文档 + skill 知识库检索 | A/B |
| 短接金点/输暗码/装驱动（仅 Z6s 这类） | human_instruction 卡片 + 完成确认 + 截图上传（其他设备换成别的人工动作） | A |
| 安卓 vs RTOS 调试方式分叉 | Agent 按设备型号/平台动态选路径 | A |
| nmap TCP/UDP 扫描 + 截图 | 模组/命令工具执行 + evidence_attach | B/C |
| Wireshark/bp 抓包、加密分析 | 外部工具产出挂载（pcap 上传 + 功能模块标签） | B |
| EMBA/binwalk 固件分析 | 固件类工具/模组 + 证据附件 | B/C |
| 蓝牙 BLE 枚举/GATT/配对抓包 | packet-capture/设备工具 + 证据附件 | B |
| WiFi AP/airodump 抓包 | 设备工具 + 证据附件 | B |
| 客户端逐界面截图 | human_instruction + 批量截图上传 | B |
| 证据按功能模块存、判定时分配 | functionModule 标签 + 跨阶段 evidenceRefs | B→C |
| 逐条 ACM/AUM/SUM/SCM/CCK/GEC/CRY 判定 | 条款判定草案 + 人工审核 + 按条款重跑 | C/D |
| 报告含过程记录 + 判定主体 + 整改建议 | 报告附录（A/B 过程）+ 确定性定级 + AI 叙述 | D |

---

## 9. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | Agent 规划跑偏、选工具错误 | 工具白名单 + 结构化输出校验；阶段计划需用户可见可改；高风险工具审批 |
| R2 | 人工步骤卡死/忘记完成 | 超时提醒、挂起归档、会话生命周期管理 |
| R3 | 证据错配功能模块/条款 | B 阶段强制 functionModule 标签；C 阶段按模块检索；无证据 verdict 自动 skipped |
| R4 | 阶段回退失控、步骤无限增长 | 回退需用户确认 + 限单条款回退次数，超限人工介入 |
| R5 | 命令注入 | 模型不直接碰 shell；模组内部白名单校验；命令工具试跑+审批 |
| R6 | 模型生成判定/报告幻觉 | 定级由代码算；判定必须带 evidenceRefs；AI 叙述标注"仅供参考"；verdict 无证据直接 skipped |
| R7 | DeepSeek 不可用/超时 | 超时+重试+降级；AiProvider 可切 flash 模型/其他厂商；AI 失败不影响手动流程 |
| R8 | 成本（长上下文、多轮） | 证据摘要而非原文喂模型；Context Caching；planning 用 pro、成文用 flash；token 用量审计 |
| R9 | 数据外发合规 | 明示开关；只传 verdict/证据摘要，不传原始固件；二期支持本地模型 |
| R10 | dsh rc 破坏性变更 | 一期不依赖；二期子进程隔离 + 版本锁 + 双写 + 回归门禁 |
| R11 | 不可复现/审计质疑 | 所有 Agent 决策、工具调用、人工动作落 step_runs/agent_events/audit；审核留痕 |
| R12 | 权限缺口 | AuthzService 一期即打开角色校验；Agent 接口显式 requireRole；高危操作审批 |

**安全红线**：AI 不直接执行 shell；人工步骤不可被模型跳过；判定必须有证据且经人工审核才定级；所有模型可见输入必须可审计。

---

## 10. 分期路线

### P0：补可观测性底座（与 AI 无关，3-5 人日）
- 工具/模组详情页、命令工具判定规则命中测试（部分已有）
- 证据/文件上传组件（后续人工步骤复用）

### P1：一期 Agent 人机协同（核心，约 25-30 人日）
- `AiProvider` + DeepSeek 适配；配置/开关；`ai_generations` 审计
- Agent 规划循环（§5.3）+ 工具桥（§5.4）+ 阶段状态机
- **skill 知识库最小版**：内置少量设备/平台的接入方法样例（含 Z6s 这类），支持按型号/平台检索，驱动 A 阶段动态规划
- 人工步骤：指令卡片、完成/上传、继续、打断
- Artifact 与 Evidence 管理（functionModule 标签、文件落库、跨阶段引用）
- ClauseVerdict 审核流（pending/approve/reject + 按条款局部重跑 + 阶段回退）
- 数据模型扩展 + 阶段边界校验
- `/api/agent/*` 接口 + WebSocket 事件流
- 前端：模块选择 → Agent 会话页（阶段时间线、指令卡片、工具输出、审核面板、工件视图）
- 报告：AI 叙述/整改建议（结构化字段代码算）；A/B 过程进附录
- 单测：mock provider 测规划/工具桥/审核/阶段校验/降级
- **范围控制**：一期只做"选条款 → 四阶段人机协同 → 审核 → 报告"主链路。验收目标是选**一个真实设备 + 一个条款族（如 GEC 网络外部接口）**，Agent 能根据该设备的 skill 动态给出 A/B 步骤、人工完成后跑 C 判定、出报告。Z6s 只是其中一个验证样例，不是固定流程；不追求一次覆盖所有设备和条款。

### P2：能力放开（1-2 个月）
- preset/skill 化：条款 testingMethod → skill；法规模块 → 可复用预设
- 设备操作工具（串口/继电器/packet-capture）正式化
- 流程"另存为模板"：C 阶段稳定步骤沉淀为 Test Plan
- 审批对接、Agent 会话页完善（工具调用记录、推理摘要、守护重启）
- AI 辅助生成命令工具（描述 → 命令+规则 → 试跑 → 确认保存）

### P3：dsh 接入与平台化（dsh 1.0/锁版本后）
- SDK 子进程接 dsh runtime（路径 A），特性开关
- 场景限定"探索性诊断"（非归档主链路）
- 动态插件原型 → 正式插件沉淀
- 会话回放审计、token/成本统计
- dsh 1.0 后重评估兼容承诺

---

## 11. 待决策

1. **一期范围**：是否同意以"单模块（如 GEC 网络外部接口）跑通四阶段人机协同"为验收目标，而非一次性覆盖全部 EN18031 条款？
2. **AI Key 配置**：系统级 `DEEPSEEK_API_KEY` 还是多租户各自 key？（建议一期系统级）
3. **原始证据是否允许外发**：固件/pcap 是否只在本地分析、只把摘要发给模型？是否需要本地模型兜底？
4. **人工步骤证据是否强制**：A/B 步骤是否必须上传至少一个证据才能继续，还是允许"无证据但用户确认"？
5. **模型分工**：planning 用 v4-pro + thinking，成文用 v4-flash，是否认可？
6. **阶段回退权限**：C→B 补采由 Agent 提议、用户确认即可，还是必须 template_manager 角色？
7. **dsh 二期时机**：等 1.0 GA 还是指定人持续跟踪 rc？（建议等 1.0，但跟踪 Release/changelog）
8. **"另存为模板"放 P2 是否认可**：固化流程是效率选项但非一期主线。

---

## 12. 结论

- v0.2 的"一键静态模板"对完整合规测试不够，Z6s 笔记已证伪；改为"Agent 引导的人机协同分阶段测试"。
- 一期用平台自有 Agent 循环 + DeepSeek API 就够，**不急于绑 dsh rc**；确定性引擎管判定与定级，AI 管规划与成文，人工管硬件操作与审核。
- dsh 的价值（session log、preset/skill、子代理）放二期，以 SDK 子进程隔离接入，版本锁定 + 双写审计。
- 建议按 P0→P1 推进，P1 以一个真实模块端到端跑通为验收门槛。
