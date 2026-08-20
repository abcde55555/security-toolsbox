# DeepSeek Agent（Harness）集成可行性方案

> **文档版本**：v0.1（调研稿）
> **产出日期**：2026-08-19
> **适用读者**：项目负责人、架构师、AI/Agent 开发工程师
> **状态**：待评审
> **关联文档**：`docs/en18031/02-Architecture.md`、`03-Module-SDK.md`、`04-Clause-Mapping.md`

---

## 0. 一句话结论

**可行，建议分两期做。**

- **一期（推荐先做）**：把 DeepSeek 当成"workflow 生成器 + 报告润色器"，不把它放进执行链路。用户勾选法规模组 → DeepSeek 读取条款与测试方法 → 生成现有格式的合规编排模板（`Template` + `TemplateStep` + `ClauseBinding`）→ 用户确认/微调 → 走现有确定性执行引擎跑完 → DeepSeek 基于结构化判定结果生成固定格式报告。**执行结果仍由确定性代码判定，模型只负责"编排"和"成文"，风险可控。**
- **二期（观察后再做）**：引入 DeepSeek Harness 的 agent 能力，让模型在受控工具集内自主选择命令、多轮推理、自适应检测。待 Harness 结束 developer preview、破坏性更新落地后再接入。

理由：当前平台已经有一套相当完整的确定性执行引擎（模板编排 → 步骤 → 工具/模组 → 条款判定 → 报告），而合规测试场景**动作高度固定**（端口扫描、默认口令、固件解包、加密检测……），并不需要 agent 自由发挥。让模型做它擅长的事（理解法规、生成流程、组织报告）、让确定性引擎做它擅长的事（执行命令、判定通过/失败、留痕），是投入产出比最高、风险最低的路径。

---

## 1. 背景与目标

### 1.1 当前平台现状

本项目是一个 EN 18031 IoT 合规测试平台，三层架构已落地：

1. **全局工具库**（`tools` 表）：两类工具
   - 内置模组（`packages/modules/*`，TypeScript 实现，如端口检测 `en18031-port-check`、固件密钥扫描、加密检测、默认口令检测）
   - 自定义命令手册工具（`tool_commands` 表，一条命令 + 参数 + 判定规则）
2. **模板编排**（`templates` / `template_steps` / `template_clause_bindings`）
   - `ad-hoc` 模式：自由串工具
   - `compliance` 模式：以条款为骨架，每个条款下挂步骤，支持 `cross_check`（多工具投票）和 `chain`（链式）两种聚合
3. **执行引擎**（`ExecutionEngine` + `OrchestratorService` + `CommandExecutor`）
   - 跑模组 / 跑 shell 命令，实时输出（NDJSON 流、Socket.IO）
   - 把结果映射到条款（模组返回 verdict / 命令输出命中 mapping rule / 步骤 verdictRule）
   - 写入 `step_runs`、`evidences`、`clause_verdicts`
4. **报告**（`ReportService`）：按条款树汇总 verdict，父条款由子项 roll-up，导出 Excel/JSON/HTML

技术栈：Node ≥18、Fastify、better-sqlite3、React + Vite + antd、Socket.IO；无任何 LLM/AI 依赖。

### 1.2 业务诉求（来自需求方）

1. **工具分类 vs tool_use**：现在工具库里很多是命令行工具，直接当 agent 的 tool_use 是否合理？需要评估。
2. **插件编写难**：理念上希望大模型自我迭代，但现阶段仍需人工编写插件，需要一个能查看插件的位置。
3. **动作固定**：用户倾向于"勾选法规模组 → 大模型参考法规与测试方法生成 workflow → agent 调用 → 产出固定格式报告"。
4. **DeepSeek Harness 兼容性**：后续官方有大版本更新，需要考虑更新与兼容策略。

### 1.3 调研范围

- DeepSeek 模型与 API 能力（function calling / thinking / 多轮）
- DeepSeek Harness（developer preview）定位与集成方式
- 与当前三层架构、数据模型、执行引擎的契合点与冲突点
- 风险（安全、确定性、成本、版本兼容）与缓解

---

## 2. DeepSeek 能力调研（截至 2026-08）

> 数据来源：DeepSeek 官方 API 文档（`api-docs.deepseek.com`）。由于 Harness 文档站为客户端渲染 SPA，部分细节以官方导航与 OpenAI 兼容契约为准。**接入前必须再拉一次最新文档核对。**

### 2.1 模型与 API 形态

| 项 | 现状 |
|---|---|
| API 兼容 | **OpenAI Chat Completions 格式** + Anthropic 格式，双兼容 |
| Endpoint | `https://api.deepseek.com/chat/completions`（OpenAI）、`https://api.deepseek.com/anthropic`（Anthropic） |
| 主力模型 | `deepseek-v4-pro`、`deepseek-v4-flash`（均为 0731/0813 更新后的版本，调用方式不变） |
| 特性 | `thinking`（推理模式）、`reasoning_effort`、`stream`、JSON Output、Context Caching、FIM |
| 工具调用 | OpenAI 标准 `tools` / `tool_choice` / `tool_calls`（function calling） |
| SDK | 可直接用官方 OpenAI SDK（改 baseURL）或 Anthropic SDK |

**关键结论**：即使不用 Harness，仅用 Chat Completions + function calling 就能实现"让模型选工具"。Harness 是更高层的封装。

### 2.2 DeepSeek Harness 是什么

官方表述：*"DeepSeek Harness is now in developer preview for agent harness developers worldwide."*

定位推断（基于命名与官方把它和 Claude Code / GitHub Copilot / OpenCode 并列）：

- Harness 是一个 **agent 运行时/协议层**，让第三方 agent / 编码助手把 DeepSeek 作为后端模型，由 Harness 负责工具调用循环、上下文管理、会话持久化等。
- 类似 Anthropic 的 Computer Use / Claude Agent SDK、OpenAI Assistants 的定位——**模型 + 工具调度循环 + 状态管理**的打包方案。
- 当前是 **developer preview**，意味着：
  - API/协议**可能在 GA 前破坏性变更**
  - 不建议直接绑死在生产关键路径
  - 适合调研、做实验性分支

### 2.3 对本项目最相关的能力

1. **Function Calling**：把"跑一条命令""查一个条款""生成 workflow"注册成 tool，模型返回调用意图 → 我方执行 → 回灌结果。这是 agent 能力的基础，且 OpenAI 标准稳定。
2. **Structured Output / JSON Mode**：让模型输出严格 JSON（如生成的 `Template` JSON、报告 JSON），降低解析失败率。
3. **Thinking / reasoning_effort**：生成 workflow 这类需要规划的任务用 `high` + thinking，简单润色用 `low` 或关闭，平衡质量与成本。
4. **Context Caching**：法规模组文本（EN18031 全部条款）很长且复用率高，命中缓存可显著降本。
5. **Streaming**：workflow 生成、报告生成都应流式输出给前端，体验好。

---

## 3. 四个问题逐一回应

### 3.1 工具分类 ≠ tool_use：命令行工具直接当 agent 工具是否合理？

**结论：不合理直接等价，但可以分层抽象。**

现在工具库里两类东西本质不同：

| | 内置模组 | 命令手册工具 |
|---|---|---|
| 本质 | 一段确定性代码，输入表单 → 输出结构化 verdict | 一条 shell 命令 + 输出匹配规则 |
| 可控性 | 高（参数 schema 明确、结果结构固定） | 中（命令可任意拼接、输出是非结构化文本） |
| 适合给 agent | ✅ 适合（封装成一个粗粒度 tool） | ⚠️ 不适合把"任意命令"当 tool |
| 风险 | 低 | 高（命令注入、跑飞、产生无关输出） |

**建议的工具分层：**

- **Agent-facing tools（粗粒度、白名单、确定性）**：把内置模组包装成 agent 可调用的 tool，例如：
  - `run_port_check(target_ip, port_range, scan_type)` → 返回结构化 JSON（开放端口、判定、证据）
  - `run_firmware_secret_scan(firmware_path)` → 返回发现的密钥列表
  - `list_clauses(standard, chapter)` → 返回条款
  - `save_template(template_json)` → 保存生成的 workflow
- **Execution primitives（细粒度、仅引擎内部用）**：`CommandExecutor.runCommand` 这种"跑任意 shell"**不直接暴露给模型**。命令手册工具作为"模板步骤"由确定性引擎执行，agent 只能在生成 workflow 时"引用"它（填好参数、绑定判定规则），不能在运行时临时拼命令。
- 现有"工具分类"是给人看的目录；agent tool_use 是给模型看的能力清单。两者**多对一**：一个 agent tool 可能对应一个模组；分类不直接等于 tool 定义。

这样既保留了"人工也能用工具"的优点（工具库/模板/手动执行都在），又避免了让 agent 直接拿到 shell 的安全风险。

### 3.2 插件编写难 + 需要查看位置

**两个动作：**

1. **插件/模组查看页（无论是否上 AI 都该做）**：
   - 工具库增加"模组详情"抽屉/页：展示 `module.config`（名称、版本、作者、描述、表单字段、声明覆盖哪些条款 `clauses`、健康检查命令、标签）
   - 展示源码位置/版本/SDK 版本，提供"在线测试"（已有 test-command/stream 能力可复用）
   - 命令手册工具展示命令模板、参数、判定规则、命中测试
   - 这是 P0 的可观测性补全，不依赖 AI。

2. **AI 辅助生成插件（二期可选）**：
   - 提供"新建命令工具"向导：用户描述要检测什么 → DeepSeek 生成 `commandTemplate` + 参数 + verdictRule（基于输出样例）→ 用户试跑（用流式测试终端）→ 微调 → 保存
   - 本质是把"写正则/写命令"的门槛用模型降下来，但**保存前必须人工确认 + 试跑通过**。
   - 不做"模型自我迭代直接写插件入库"——合规场景不可接受未审核代码进生产。

### 3.3 动作固定：勾选模组 → 生成 workflow → agent 执行 → 固定报告

**这是核心场景，一期就做这个。** 但要明确：这一场景下，"agent"其实只在**生成阶段**出现，执行阶段仍是确定性引擎。流程：

```
[用户] 勾选标准 + 章节/条款（如 EN18031 第5章）
  ↓
[后端] 组装上下文：
       - 选中条款的 {clauseId, title, description, testingMethod, level, defaultSeverity}
       - 可用工具清单（agent-facing tools 的 schema）
       - 平台 Template 数据结构说明 + 1-2 个 few-shot 示例
  ↓
[DeepSeek] chat.completions + tools + JSON mode + thinking
  ↓ 输出严格 JSON
[后端] 校验：
       - 所有 toolId 存在、参数符合 schema
       - 每个选中条款都有覆盖（或显式标注"无可用工具"）
       - verdictRule 合法
  ↓
[前端] 渲染成现有合规模板编辑器（ComplianceTemplateEditor），用户可改
  ↓
[用户] 保存为 Template → 创建项目 → 跑预检 → 执行（现有引擎）
  ↓
[执行完] 后端拿 clause_verdicts + evidences
  ↓
[DeepSeek] 基于结构化判定 + 证据，生成固定格式报告的"文字部分"
       （评级、统计、每章结论、整改建议），结构化字段仍由代码算
  ↓
[报告] 合并：代码算的数字/状态 + 模型写的成文 → 现有 Report 结构
```

**为什么不让 agent 直接执行？**

- 合规报告要可复现、可审计。同一个项目跑两次，模型可能选不同工具/参数，结论漂移，审计不认。
- 工具已经足够覆盖场景，agent 自主选工具的增益小、风险大（误操作、命令注入、跑超时）。
- "生成 workflow 后人工确认"把模型的不确定性挡在执行前，执行后全确定。

二期若要 agent 自主执行，也应限制在"探索性诊断"（非归档测试），与合规出报告的主链路隔离。

### 3.4 Harness 更新与兼容

**风险确实存在，必须设计隔离层。** 应对策略：

1. **一期不依赖 Harness**：只用 OpenAI 兼容的 Chat Completions + function calling。这是事实标准，DeepSeek、OpenAI、Anthropic、通义、Kimi 都兼容，**不绑死单一厂商**。
2. **抽象 `AiProvider` 接口**（见 §5.2）：所有调用走自己的接口，DeepSeek 只是其中一个实现。换模型/换厂商只改一个 adapter。
3. **对 Harness 做特性开关**：二期接 Harness 时用 `feature flag` 包住，Harness 不可用时自动回退到"Chat + function calling 自驱循环"。
4. **锁版本 + 契约测试**：
   - 配置里固定 model 名（`deepseek-v4-pro` 而非 `latest`）
   - 对 Harness 的输入/输出做 schema 校验（zod），解析失败走兜底
   - CI 跑一组录制的 fixture（法规→workflow），Harness 升级后回归
5. **prompt 与模型版本解耦**：system prompt、few-shot、output schema 都放配置/数据库，不硬编码；升级模型时只调 prompt 不动代码。
6. **关注官方 Change Log**：`api-docs.deepseek.com/news/changelog`，大版本（major）发布时走一次完整回归。
7. **数据可迁移**：生成的 workflow 用的是平台自己的 `Template` 模型，不是 Harness 的私有格式。即使 Harness 废弃，已生成的模板照样能跑。

---

## 4. 端到端方案（一期：AI 辅助编排 + 成文）

### 4.1 用户旅程

1. 在"模板"页点"**AI 生成合规模板**"
2. 选择标准（EN18031:2019）、勾选要覆盖的章节/条款（可整章）、选择目标设备画像（可选，帮助选参数）
3. 点"生成"，前端流式显示模型规划过程/进度
4. 生成完成后，自动在合规模板编辑器里打开：左侧条款树已勾选、右侧每个条款挂好工具与判定规则、聚合模式默认 `cross_check/all_pass`
5. 用户检查、调整（换工具、改参数、加步骤、改 verdictRule），可对单条点"让 AI 重新生成这条"
6. 保存 → 走现有流程创建项目、执行、出报告
7. 报告页：结构化数据由代码生成，"总结/风险解读/整改建议"由模型基于 verdict 生成（可重生成）

### 4.2 新增后端模块

```
packages/server/src/
  ai/
    ai.types.ts          # AiProvider 接口、GenerationOptions、Message 类型
    deepseek.provider.ts # DeepSeek Chat Completions 适配（OpenAI 兼容）
    ai.config.ts         # 从 env 读 apiKey/baseUrl/model/thinking
    workflow/
      workflow.builder.ts    # 组装 prompt + 上下文（条款、工具 schema）
      workflow.generator.ts  # 调模型、解析 JSON、校验、落 Template
      workflow.schema.ts     # 生成结果的 zod schema
    report/
      report.writer.ts      # 基于 verdicts 生成报告文字
  routes/
    ai.ts               # POST /api/ai/generate-workflow (stream)
                        # POST /api/ai/generate-report (stream)
                        # POST /api/ai/generate-command-tool
```

### 4.3 `AiProvider` 接口（关键抽象）

```ts
export interface AiProvider {
  chat(opts: {
    model?: string;
    messages: ChatMessage[];
    tools?: ToolSchema[];        // OpenAI function calling
    toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
    responseFormat?: { type: 'json_object' } | { type: 'json_schema'; schema: unknown };
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high';
    temperature?: number;
    stream?: boolean;
    signal?: AbortSignal;
  }): AsyncIterable<ChatChunk> | Promise<ChatResult>;
}
```

- DeepSeek 实现里映射到 OpenAI SDK 的 `chat.completions.create`，baseURL = `https://api.deepseek.com`
- 二期加 Harness 实现时，只是多一个 provider；上层不感知
- 也可加 OpenAI/Anthropic/本地模型实现，作为 DeepSeek 不可用时的兜底

### 4.4 Workflow 生成的 Prompt 设计（要点）

- **System**：你是 IoT 合规测试编排助手。根据选中的 EN 18031 条款和可用工具，生成一个合规测试模板。只能使用给定工具；每个条款必须绑定至少一个工具或显式标注无法覆盖；输出严格 JSON，schema 见附。
- **上下文**：
  - 选中条款数组（含 `testingMethod`——这是模型选工具的关键依据）
  - 可用工具清单：每个工具的 `{id, name, description, formFields, declaredClauses, category}`（注意：给模型的是**粗粒度工具描述**，不是任意 shell）
  - 平台 Template 数据结构说明 + 1 个完整 few-shot（5.3 章 → 端口检测模组）
- **输出 schema**（与 `Template` 对齐的子集）：
  ```json
  {
    "name": "...",
    "description": "...",
    "mode": "compliance",
    "clauseBindings": [{ "clauseId": "5.3-1", "aggregation": {"mode":"cross_check","strategy":"all_pass"} }],
    "steps": [
      { "stepId":"...", "title":"...", "toolId":"en18031-port-check",
        "clauseId":"5.3-1", "params":{...}, "dependsOn":[],
        "onFailure":"continue", "verdictRule":{"kind":"module","mapClauseId":"5.3-1"} }
    ]
  }
  ```
- 后端用 zod 校验后，再做业务校验（toolId 存在、params 符合 formFields、条款都覆盖、无循环依赖），校验失败把错误回灌让模型修一次（最多重试 1-2 轮）。

### 4.5 工具清单怎么喂给模型

- **数据源**：`tools` 表 + 内置模组的 `ModuleConfig`
- **字段裁剪**：只给模型看 `{id, name, description, category, formFields(id/label/type/required/default/format/description), declaredClauses}`，不给内部路径、不给 `healthCheck.command`
- **数量控制**：工具多了 token 贵且模型选择变差。按选中章节的 `tags`（如 `EN18031-ch5`、`网络扫描`）先筛一遍相关工具；工具清单本身走 Context Caching。
- **命令手册工具**：作为"可被引用的步骤"出现，但模型不能改 `commandTemplate`，只能填参数和 verdictRule。

### 4.6 报告生成

- 不重新跑任何东西，输入是已有的 `clause_verdicts`（pass/fail/reason/severity）+ `evidences` + 条款元数据 + 评级
- 模型只写：**执行概述、每个不通过项的风险解读、整改建议、总体结论**
- 评级、统计数字、条款状态表由代码算（防止模型算错数）
- 输出固定结构 JSON，存到 `reports` 表新增的 `aiSummary` 字段（或单独 `report_narratives` 表）
- 前端报告页分区展示："测试结果（代码生成，不可改）" + "AI 分析与建议（可重新生成）"
- 必须在 UI 上明确标注"AI 生成内容，仅供参考"

### 4.7 配置

`config.ts` 新增：

```ts
ai: {
  enabled: envBool('AI_ENABLED', false),
  provider: env('AI_PROVIDER', 'deepseek'),
  deepseek: {
    apiKey: env('DEEPSEEK_API_KEY', ''),
    baseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    model: env('DEEPSEEK_MODEL', 'deepseek-v4-pro'),
    flashModel: env('DEEPSEEK_FLASH_MODEL', 'deepseek-v4-flash'),
    thinking: envBool('DEEPSEEK_THINKING', true),
  },
  timeoutMs: envInt('AI_TIMEOUT_MS', 120000),
  maxRetries: 2,
}
```

`AI_ENABLED=false` 时所有 AI 接口返回 503，前端隐藏 AI 入口——保证离线/无 key 环境可用。

---

## 5. 架构影响评估

### 5.1 对现有分层的影响

| 层 | 影响 | 说明 |
|---|---|---|
| 工具库 | 小 | 加详情展示；AI 只读工具清单；不改变工具模型 |
| 模板 | 中 | 新增"AI 生成"入口，但产物就是现有 `Template`，编辑/保存/执行全复用 |
| 执行引擎 | 无 | 一期 AI 不在执行链路里，引擎零改动 |
| 条款判定 | 无 | verdict 仍由确定性规则/模组产出 |
| 报告 | 中 | 新增 AI 文字生成 + 存储 + 展示；结构化部分不变 |
| 前端 | 中 | 新增生成向导、流式进度、报告 AI 分区 |

**关键：核心执行链路零侵入。** AI 是外挂的"生成器"和"润色器"，不碰判定与留痕逻辑。

### 5.2 新增抽象的边界

- `AiProvider` 只负责"对话/工具调用/流式"，不懂业务
- `workflow.generator` 负责业务（拼上下文、校验产物、落库）
- `report.writer` 负责成文
- 三者都不直接碰数据库，通过 repository；便于单测（mock provider）

### 5.3 复用现有能力

- 流式：现有 `/api/test-command/stream` 的 NDJSON 模式可直接复用于 AI 流式
- Socket.IO：workflow 生成进度可推给前端
- 模板校验：`templateService.create/update` 已有 DAG 校验、字段校验，复用
- 插件查看：ModuleLoader 已能列出内置模组 config，直接读
- 报告：`ReportService.getReportDetail` 已有完整 verdict 数据，喂给模型即可

---

## 6. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 模型生成的 workflow 引用了不存在的工具/错误参数 | 高 | zod + 业务双重校验；失败回灌重试；前端打开后人工确认才能保存 |
| R2 | 模型把条款漏覆盖/错配工具 | 高 | 强制每个选中条款必须有步骤或显式"无法覆盖"标记；UI 高亮未覆盖条款；few-shot 示例 |
| R3 | 命令注入（模型生成/修改 shell 命令） | 高 | 一期模型不碰命令模板，只能引用已有命令工具并填参数；命令工具保存前必须试跑 |
| R4 | Harness 破坏性更新导致不可用 | 中 | 一期不依赖 Harness；AiProvider 抽象 + 特性开关；锁模型版本；契约测试 |
| R5 | DeepSeek 服务不可用/超时 | 中 | 超时+重试+降级；AI 失败不影响手动流程；可配多 provider |
| R6 | 成本失控（长 prompt、反复重试） | 中 | 工具清单按章节筛选 + Context Caching；重试上限；flash 模型用于轻任务；记录 token 用量到审计 |
| R7 | 报告内容幻觉/与数据矛盾 | 中 | 数字与状态由代码算；AI 只写叙述；UI 标注 AI 生成；把 verdict 原文作为上下文强约束 |
| R8 | 数据合规（把企业固件信息/扫描结果发给第三方） | 中 | 明确告知 + 开关；报告生成只传 verdict/证据摘要，不传原始固件；支持本地模型 provider（二期） |
| R9 | prompt 注入（工具描述/条款被恶意构造） | 低 | 工具/条款来自管理员，非终端用户任意输入；输出仍走 schema 校验 |
| R10 | 生成结果不可复现，审计质疑 | 中 | 保存 prompt、模型版本、raw 输出到审计日志（`ai_generations` 表）；模板可手动编辑但记录来源 |

### 安全红线

1. **AI 绝不直接执行 shell。** 一期 AI 只生成 JSON 模板和文字，不进执行链路。
2. **AI 生成的命令工具/模板必须人工确认 + 试跑才能保存启用。**
3. **AI 输出一律 schema 校验**，不接受任意 JSON 直接落库。
4. **审计可追溯**：每次 AI 调用记录 who/when/model/prompt 哈希/输入条款/输出/耗时/token。

---

## 7. 分期与里程碑

### P0（与 AI 无关，先补可观测性）

- 工具/模组详情查看页（config、声明条款、健康检查、在线测试）
- 命令工具判定规则可视化与命中测试（部分已有）
- 估时：3-5 人日

### P1（一期：AI 编排生成 + 报告成文）

- `AiProvider` 抽象 + DeepSeek 适配
- `POST /api/ai/generate-workflow`（流式）：选条款 → 生成 Template JSON → 校验 → 前端打开编辑器
- 单条"AI 重新生成"、参数建议
- `POST /api/ai/generate-report`：基于 verdict 生成叙述
- 配置与开关、审计日志表 `ai_generations`
- 前端：AI 生成向导、流式进度、报告 AI 分区
- 单测：mock provider 测生成/校验/降级
- 估时：15-20 人日

### P2（二期：观察 Harness 后评估）

- 跟踪 Harness GA 与 changelog
- Harness adapter（特性开关后），探索 agent 自主选工具的"探索性诊断"模式
- AI 辅助生成命令工具（描述 → 命令+规则 → 试跑 → 保存）
- 多 provider / 本地模型兜底
- 估时：待 Harness 稳定后评估

---

## 8. 待决策问题（需评审确认）

1. **一期是否就做报告 AI 成文，还是先只做 workflow 生成？** 建议都做，但报告成文可晚一周。
2. **AI 生成的模板是否允许直接保存运行，还是必须人工打开确认？** 建议强制人工确认（前端打开编辑器，至少点过保存）。
3. **DeepSeek API Key 由系统统一配置，还是支持多用户/多租户各自的 key？** 一期建议系统级配置；多租户 key 留接口。
4. **固件/扫描原始数据是否允许发给 DeepSeek？** 建议一期只传 verdict + 证据文本摘要，不传原始固件；是否需要私有化/本地模型部署作为合规选项？
5. **命令手册工具是否允许 AI 新建？** 建议一期不允许，只能引用；二期加向导并强制试跑。
6. **Harness 是现在就起 spike 分支调研，还是等 GA？** 建议等 GA，但持续跟踪 changelog。

---

## 9. 结论

- 方向正确：以"AI 生成编排 + 确定性执行 + AI 辅助成文"落地，契合"动作固定"的合规测试场景。
- 风险可控：一期 AI 不碰执行、不碰命令、输出强校验、人工确认，核心链路零侵入。
- 厂商不绑死：基于 OpenAI 兼容接口 + AiProvider 抽象，Harness 大版本更新不影响已生成的模板和执行引擎。
- 建议按 P0 → P1 推进，P2 视 Harness 成熟度再定。
