# DeepSeek Harness（dsh）平台集成可行性调研方案

- 调研日期：2026-08-20
- 调研对象：`deepseek-ai/deepseek-harness`，本调研基于仓库 `master`（tag `dsh-v0.1.0-rc.8`）源码与文档，并结合官方 Release Notes 与社区信息
- 调研目标：为「工具平台 + 智能体（Agent）」二开输出可行性方案，覆盖核心思路、与同类产品的差异、集成路径、平台现状四个关切的落地性、实施风险与更新兼容策略
- 文档范围：本文件是平台侧的立项决策文档，引用仓库文件均给出 `packages/` 或 `docs/` 相对路径，便于在仓库内核对

---

## 1. 结论摘要

1. dsh 的核心是「一切皆插件」的 Harness：模型只负责推理，模型之外的所有工程（工具调用、规划、执行、日志、持久化）由可替换的插件树承担，运行时代码可通过配置完全重组。
2. dsh 目前处于 0.1.0-rc 预发布阶段，官方明示「THERE WILL BE COMPATIBILITY-BREAKING CHANGES」；`rc.8` 已发生过一次 SQLite 数据格式不兼容变更。**任何深度耦合都必须做版本锁定与升级演练。**
3. 平台集成推荐走「子进程边界」而非「进程内深度嵌入」：用 TypeScript/Python SDK（stdio JSON-RPC）或 ACP 协议把 dsh 当独立执行引擎拉起，平台侧保留自己的前端、权限、用户体系。这样把不兼容风险隔离在协议边界上。
4. 平台四个关切（tools_use 工具分类、插件查看与编写、法规模块生成 workflow、更新兼容）都有明确答案，其中「法规参考 + 测试方法 → workflow → 固定报告」是 dsh 能力组合的舒适区（preset + skill + workflow + 结构化输出）。
5. 结论：可行，但**现阶段（1.0 之前）定位为「并行试点」而非「全线替换」**，平台主体保持独立，dsh 作为可插拔的 Agent 执行引擎接入。

---

## 2. DeepSeek Harness 是什么：核心思路

### 2.1 Agent = Model + Harness

dsh 由 DeepSeek 官方于 2026-08-13 开源（开发者预览版）。其核心公式是：

- Model 负责推理与决策；
- Harness 负责模型之外的全部执行层工程：工具注册与调度、任务规划、Shell/文件/网络等能力的执行、会话日志、持久化、权限与沙箱、子代理编排。

官方公开语境反复强调这一点：Harness 承接的是「如何让模型持续完成任务」，使模型能力从单次响应延伸为可执行、可记录、可复用的工作流。

### 2.2 一切皆插件（Cordis 微内核）

dsh 基于 vendored 的 [Cordis](https://github.com/cordiverse/cordis) 插件框架构建（源码在 `vendor/`）。要点（见 `docs/cordis-primer.md`）：

- **插件即 Service**：插件是实现了 `apply(ctx, config)` 的对象；`ctx` 是服务的仓库，稳定键如 `ctx.tools`、`ctx.llm`、`ctx.sessions`。
- **无特权核心**：包括模型适配器、工具注册表、session log、甚至 agent-loop 本身在内，全部是插件，全部可从配置替换（`docs/architecture.md`）。
- **注册是可逆副作用**：`ctx.effect()` / `ctx.on()` 安装的一切贡献（工具、prompt 段落、监听器、适配器）在插件卸载时自动卸载，因此热重载天然成立。
- **类型化事件**：服务通过 TypeScript 声明合并声明事件，用 `emit` / `waterfall` / `parallel` / `serial` 四种调度模式分发；瀑布监听器必须调 `next()` 委托，否则短路。
- **能力缝（capability seam）**：一个可替换能力 = Service Definition（抽象服务类）+ Service Provider（实现）+ Consumer（通常是模型工具）。一个典型例子：`dsh-shell`（定义）、`dsh-bash-local`/`dsh-bash-sandbox`（实现）、`dsh-tool-bash`（模型工具）。换一个 Provider，整个产品行为随之改变。

### 2.3 事件溯源的会话日志（session log）

- 会话日志是 append-only 的 `SessionEvent` 流，是模型上下文、fork、resume、回放、遥测、持久化的唯一事实源。
- 强约束：「模型可见 = 已记录」。任何到达模型请求的输入必须能从日志重建，运行时不变式会校验这一点。新增模型可见输入意味着新增一个 session event 类型。
- 这带来很强的可观测性与可审计性：用户平台可以完整回放 Agent 每一步做了什么、看到了什么。

### 2.4 每会话可组合（scope / preset）

- 每个 Agent 有独立作用域（`agent.ctx`），作用域内的注册只对该 Agent 可见；`tools.restrict()` 可以对一个作用域过滤继承的全局工具集。
- **Agent Preset**（`packages/preset/`）：一个目录存放一个 `agent.cordis.yml`，挂载到某 Agent 作用域下，该会话就拥有自己的一套工具和 prompt 段落，同一进程可并行跑多个不同组合的 Agent。这是「不同场景用不同 Agent」的官方机制。

### 2.5 自我参照（self-referential）

- `dsh-tool-cordis` 提供 5 个模型工具：`cordis_inspect`（只读报告当前进程的服务、插件、工具、API/事件契约）、`cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine`（在进程内存中动态定义、运行、停止、注销插件）。
- 即模型可以「查看运行时的自己」并「现场写插件」，这是区别于大多数 Agent 框架的设计。注意：动态插件仅存于进程内存，重启即失，不能自动转正为正式插件。

### 2.6 多入口与多运行时

| 入口 | 说明 | 适用 |
|---|---|---|
| `dsh web` | 自带 Web UI（127.0.0.1:3080） | 直接体验/单机使用 |
| `dsh --profile headless "task"` | 一次性任务跑完打印结果退出 | 批量/离线 |
| `dsh-acp-demo` | Agent Client Protocol 自动化服务器（stdio JSON-RPC） | 自动化客户端 |
| `dsh-jsonrpc-agent` | SDK 服务端，serving `@deepseek-ai/dsh-sdk-client` | 平台二开首选 |
| 内嵌组合 | 自己写 `cordis.yml` + app bundle，进程内组装 | 深度定制 |

---

## 3. 与其他 Agent 框架/产品的区别

### 3.1 与 Claude Code / Codex（终端编程助手）

- **开放 vs 封闭**：Claude Code/Codex 是闭源一体化工具体系，工具集、模型适配、审批链由官方锁定；dsh 是开源插件框架，LLM 适配器可替换（内置 DeepSeek，可配 Anthropic、OpenAI、自定义 OpenAI 兼容网关）。
- **可嵌入对方**：`rc.8` 支持把 Claude Code、Codex 作为子代理以 Profile Bundle 方式安装进 dsh，即 dsh 可以「指挥」它们。
- **工程成熟度差距**：Claude Code/Codex 的审批与沙箱体系打磨多年；dsh 的权限/沙箱需要自己配置与负责（Linux 依赖 bwrap/Landlock，macOS 依赖 Seatbelt，容器或精简环境缺组件会静默降级）。这是集成时必须自行补齐的一块。
- **迭代状态**：dsh 处于快速迭代的预览期，版本间可能破坏插件协议、配置格式、存储结构；Claude Code/Codex 有稳定版本承诺。

### 3.2 与 LangChain / LangGraph（编排库）

- dsh 是「运行时可热重载的插件体系 + 事件溯源日志」，不是让开发者在代码里用 graph/chain 编排流程；其 workflow 能力是「模型写脚本 + 启动子代理」，更接近 Claude Code 的 dynamic workflows。
- LangChain 系给的是库 API，你把编排逻辑写死在业务代码里；dsh 把「模型如何被装配」交给配置（cordis.yml），业务逻辑反而可以更薄。

### 3.3 与 AutoGen / CrewAI（多智能体）

- dsh 的多智能体通过 subagent seam + workflow + Agent Teams（实验性）实现，子代理可跨进程（ACP、Codex、Claude Code、同进程 fork/spawn）；但没有 CrewAI 那种开箱的「角色剧本」层，需要自己用 preset/prompt 表达。

### 3.4 与 OpenHands 等开源 Agent

- OpenHands 也是开源但偏「一体化应用」；dsh 更强调微内核 + 可重组，模型能力直接决定 agent 行为强弱，Harness 只保证执行与记录。差异本质上是「应用 vs 框架」的定位差异。

### 3.5 一句话定位

dsh 是「以模型能力为中心的执行底座」，插件化程度、会话可观测性、运行时自省能力是它的差异化优势；工程成熟度（沙箱、审批、升级通道）是它的当前短板。

---

## 4. 二开集成路径调研

### 4.1 路径 A：SDK 子进程模式（推荐）

- **组成**：`packages/sdk/`（TS：`@deepseek-ai/dsh-sdk-client`）+ `python/`（Python SDK）。平台进程通过 stdio JSON-RPC 拉起一个 dsh runtime 子进程。
- **用法**（TS）：
  ```ts
  const harness = new DeepSeekHarness({
    launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  const result = await harness.run('…')
  ```
- **特性**：`run()` 拿到 `{ sessionId, finalResponse, events, notifications }`；可订阅 `agent/inbox/spliced`、`assistant/chunk` 等事件流；`session(id)` 开指定会话；命名会话可复用；错误类型化（超时/协议/传输关闭）。
- **优点**：dsh 以黑盒子进程存在，升级/崩溃都不污染平台主进程；协议层相对稳定；平台已有前端时完全复用。
- **代价**：一次只有 root 请求的“整段活动”交付，无 mid-turn cancel（需关进程）；模型结果以事件流观测，不做单 prompt 级归因。

### 4.2 路径 B：ACP 模式

- **组成**：`@deepseek-ai/dsh-acp`（Agent Client Protocol 服务器）+ `@deepseek-ai/dsh-acp-demo`（可运行组合）。
- **特性**：自动化专用，`session/new` 建全新 agent、`session/prompt` 发提示、提交式文本/图片回传、`session/request_permission` 一次性应答权限、`session/cancel` 取消。
- **优点**：协议是行业标准（agentclientprotocol.com），与生态互通；适合「平台发起一次性自动化任务」。
- **代价**：面向全新会话，不支持 resume 与人工交互；提交式输出牺牲 token 级延迟。

### 4.3 路径 C：进程内嵌入 + 自建 HTTP 网关

- **组成**：`@deepseek-ai/dsh-agent-spine-demo`（无执行器的 agent 骨架）+ 自写 `cordis.yml` + `packages/api/`（Typert Remote 网关，`@Remote` 声明式暴露 HTTP `/api` 端点）。
- **特性**：dsh 与平台跑在同一个 Node 进程，业务代码直接注入 `ctx`；通过 Typert 把业务服务暴露为带严格校验的 HTTP API。
- **优点**：可控性最强，可深度定制 prompt/工具/策略。
- **代价**：升级冲突风险最高（同一进程共享运行时）；对平台技术栈（必须 Node）有硬约束。

### 4.4 路径 D：headless / web 直接使用

- 不适合作为平台集成方案，仅适合内部试用与截图演示。

### 4.5 路径对比小结

| 路径 | 隔离度 | 升级风险 | 实现成本 | 适用 |
|---|---|---|---|---|
| A. SDK 子进程 | 高 | 低 | 中 | 平台有自研前端，推荐 |
| B. ACP | 高 | 低 | 低 | 一次性自动化任务 |
| C. 进程内嵌入 | 低 | 高 | 高 | 深度定制且已 Node 化 |
| D. 直接使用 | — | — | 零 | 内部试用 |

---

## 5. 平台现状四个关切的可行性分析

### 5.1 关切一：tools_use 工具分类，工具多为命令行

**现状判断**：平台把工具按 `tools_use` 分类，让人工与 Agent 共用工具，且其中很大一部分是命令行工具。这个方向可行，但「命令行为主」需要分层处理。

**dsh 侧事实**：
- 模型可见工具由 `ctx.tools` 注册，按 scope 过滤（`tools.restrict()` + preset）。人工与 Agent 可以拥有不同工具视图：人工继续用完整工具台，Agent 只看到被授权的那一组，互不干扰。
- dsh 原生提供两种模型工具调用形态：Native（独立 tool call）与 Code Mode（`run_code`：一段程序集中编排多步工具调用，社区常称「PTC」）。对「固定动作」场景，Code Mode 减少轮次与 token。
- 每个工具必须声明 canonical JSON 输出 schema（`output.schema`），执行结果做 schema 校验（`INVALID_TOOL_OUTPUT`）。这是「模型结果确定性」的机制保障。
- 平台现有命令行工具可通过两种方式接入：包一层 `defineTool` 插件（结构化 schema + 输出校验），或用 MCP 桥接（dsh 对 MCP 有现成支持路径：discover tools → `ctx.tools.register()`）。

**结论与建议**：
- 合理性：命令行工具作为「通用兜底执行器」合理（dsh 自己的 `dsh-tool-bash`、持久终端 `dsh-tool-terminal` 就是）。但若**大量高频动作都走命令行**，会让模型拿到不可结构化的自由文本，权限细粒度控制和结果确定性都下降。
- 分层原则：把平台高频、结果固定的动作（查库、比对、出报告片段）做成结构化 JSON 工具（带 output schema）；把低频、探索性动作保留命令行执行器。
- 分类建议：不要按「工具形态」分类（命令行 vs API），按「输出确定性」分类（结构化 vs 自由文本），结构化工具进 Agent 主工具面，自由文本进受限兜底面。

### 5.2 关切二：插件编写费劲，需要一个人工可查看的位置

**现状判断**：这个痛点真实存在。dsh 的正式插件是 TS 包 + `cordis.yml` 挂载，有完整 cookbook（`docs/cookbook/adding-a-tool.md`、`adding-a-package.md`），但学习曲线来自 Cordis 范式（ctx/effect/event/waterfall）。当前没有官方插件市场，只有 GitHub topic `dsh-plugin` 做发现。

**dsh 侧事实**：
- 运行时「查看位置」是现成的：`cordis_inspect` 工具报告当前进程全部服务、插件纤维、已注册工具、API/事件契约，模型可读，人工也可从会话卡查看。
- 运行时「试写插件」也是现成的：`cordis_define`/`cordis_run`/`cordis_stop`/`cordis_undefine` 可在进程内存里现场定义、运行、注销插件，适合探索与原型；但不持久，重启即失。
- 正式插件（持久、可分发）仍需人工走常规开发流程；从「模型现场写的动态插件」到「正式插件」之间没有自动转正通道。
- 插件发现机制：`$DSH_HOME`/profile 下的 `node_modules` + `dsh plugin` 命令 + `dsh-plugin` GitHub topic。

**结论与建议**：
- 平台应当**自建插件仓库/目录**作为「查看位置」：建议用 preset（`agent-presets/` 目录，一个目录一个场景组合）+ 自建「业务插件库」目录，用文档与目录结构充当目录。运行时查看依赖 `cordis_inspect` 或平台自建的「已挂载插件」管理页。
- 编写体验分两档：探索期让模型用 `cordis_define` 现场原型；正式化由平台维护者把原型沉淀为 TS 插件并挂进 preset。平台可在这两者之间补一个「一键导出动态插件为正式插件」的内部工具（目前 dsh 未提供）。
- 学习成本缓解：把「平台业务插件」做成薄层——只注册工具、prompt 段落、output schema，不碰 agent-loop 与核心事件，接口面收敛，升级时改动面小。

### 5.3 关切三：法规模块 → 生成 workflow → 固定报告

**现状判断**：这是本次集成里可行性最高、最贴合 dsh 能力设计的场景。用户的意图拆成四步：
1. 用户选择「需检测的法规模块」；
2. 大模型结合所选法规参考信息与测试方法描述，生成 workflow；
3. Agent 执行 workflow 产出检测结果；
4. 报告用相对固定的结构输出。

**dsh 侧事实**（逐项对应）：
- **法规模块选择 → 每模块组合**：用 Agent Preset 表达。每个法规模块对应一个 preset 目录（`agent.cordis.yml`），内含该模块专用工具集、prompt 段落（法规参考信息作为 prompt section 注入）与限制（`tools.restrict`）。用户选择模块 = 挂载对应 preset，平台可同时跑多个不同模块的 Agent 会话。
- **测试方法作为可复用知识**：用 Skill 表达。`dsh-skill` + `dsh-skill-filesystem` 支持本地 skill 目录（`SKILL.md`），模型用 `skill` 工具按需加载。平台把各法规模块的测试方法写成 skill 文件，模型在工作流中检索引用。
- **生成 workflow**：用 `dsh-workflow` 表达。`ctx.workflowEngine`（worker-thread 引擎）执行「模型写的 JS 脚本」，脚本内 `agent()` 启动子代理，支持 `parallel()`/`pipeline()` 组合，带 phase/日志事件、取消与有界销毁。脚本的 `meta`/`args` 是纯 JSON，模型通过 `workflow` 工具传 `{script, meta, args}`。这正好承接「按法规+方法生成编排脚本」。
- **固定报告结构**：两条路：
  - 结构校验：定义输出工具或子代理的 structured-output schema（`output.schema`），模型/子代理产出必须通过 schema 校验；
  - 固定骨架：把报告做成「固定 schema 的表单工具」，模型只填字段不自由发挥；或 workflow 脚本返回固定 JSON，`WorkflowResult.value` 即结构化结果。
- **可选简化**：如果动作足够固定，未必需要「模型写脚本」。可以让模型「填参数调用平台预置的固定 workflow 模板」，dsh 侧只做参数校验与执行。先在「固定模板 + 受限参数」上落地，再逐步放开到「模型生成脚本」。

**结论与建议**：
- 推荐采用「preset + skill + 结构化输出」作为一期，「模型生成 workflow」作为二期放开。一期不需要模型写代码，动作与输出都确定性可控，正好规避「命令行为主的自由文本」风险。
- 报告落库：平台在 SDK 事件流上订阅 `tool/*`、`assistant/message`，或直接读取 `WorkflowResult.value`，把结构化报告写入平台自有库，dsh 会话日志留作审计证据（「模型可见=已记录」保证可回放）。

### 5.4 关切四：dsh 后续大更新的兼容性

**现状判断**：官方已明示预发布期会有破坏性变更，社区消息也确认「几乎每个 0.1.0-rc.x 都可能修改插件协议、配置格式、session 存储结构」。

**dsh 侧事实**：
- 版本：仓库当前 `0.1.0-rc.8`。发布节奏极快：8/13 开源 → 8/17 rc.7 → 8/20 rc.8。
- `rc.8` 已出现一次存储不兼容：SQLite 后端读写与分叉性能提升、体积下降，但数据结构与旧版不兼容（对应代码里 `SCHEMA_VERSION` 单调递增，旧盘上版本不匹配时 fail loud 拒绝打开，无迁移路径）。
- 版本机制：
  - `SESSION_FORMAT_VERSION = 0`（`packages/core/session/src/types.ts`）：无兼容承诺，日志格式升级需随版本走；
  - `SCHEMA_VERSION = 17`（session-persistence-sqlite）、`STORAGE_SQLITE_SCHEMA_VERSION = 1`、`SESSION_QUERY_SQLITE_SCHEMA_VERSION = 8`：SQLite 各库 schema 版本单调递增，旧格式被拒绝；
  - 会话/配置/插件协议均可能变。
- 官方无更新提醒机制（社区已提 Discussion 要求 `dsh update` 与更新提醒，未落地）。

**结论与建议**：
- 采纳「版本锁定」为硬规则：平台锁定 dsh 的具体版本，升级是显式动作，不进自动依赖浮窗。
- 把集成层建在**协议边界**（SDK JSON-RPC / ACP），而不是进程内 API 耦合，协议面相对稳定。
- 平台侧业务插件做成薄层，只依赖稳定的注册 API（`ctx.tools.register`、preset、`cordis.yml` 行），避开 agent-loop 与核心事件自定义。
- 存储隔离：dsh 的持久化（`persistenceRoot`、`$DSH_HOME`）独立于平台数据目录，升级前可整目录备份/重建。
- 升级演练纳入发布流程：升级 dsh 版本 = 跑一次全量回归（重新执行代表性检测场景），确认插件 API 与日志格式兼容后再切流量。
- 在 1.0 正式版之前，不对「会话历史跨大版本可用」做承诺，必要时允许清空重来；平台把「审计证据」双写在平台自有库，不完全依赖 dsh 的 session 文件。
- 跟踪渠道：GitHub Releases、Discord、GitHub Discussions。

---

## 6. 推荐总体架构

```
┌────────────────────────────────────────────────────────┐
│ 平台（自研，保持独立）                                    │
│  ├─ 前端：模块选择 / 报告展示 / 工具台（人工可用）          │
│  ├─ 业务服务：法规模块元数据、测试方法 skill 库、报告库      │
│  ├─ 权限/审批：平台自有，映射到 dsh 的 approval policy      │
│  └─ Agent 编排层：SDK client（dsh-sdk-client）            │
└───────────────┬────────────────────────────────────────┘
                │ stdio JSON-RPC（协议边界）
┌───────────────▼────────────────────────────────────────┐
│ dsh runtime（子进程，版本锁定）                          │
│  ├─ cordis.yml：agent-spine + preset + 业务插件(薄层)     │
│  ├─ preset/：每法规模块一个 agent 组合                   │
│  ├─ skills/：各模块测试方法                              │
│  ├─ workflow：模型生成或模板化的检测编排                   │
│  └─ 结构化输出 schema：固定报告                          │
└────────────────────────────────────────────────────────┘
```

关键决策点：
1. **接入方式**：路径 A（SDK 子进程）为主，路径 B（ACP）用于无状态自动化批任务；暂不选路径 C（进程内嵌入），把升级风险留在子进程边界外。
2. **业务实现位置**：法规模块元数据、报告库、权限在平台侧；工具、prompt、skill、workflow 模板在 dsh 侧薄插件里。
3. **报告确定性**：一期用「固定模板 + 结构化输出 schema + 受限参数」，二期再放开「模型生成 workflow 脚本」。
4. **审计**：dsh session log 只做运行时回放证据，报告结果双写平台库。

---

## 7. 风险与坑清单

| # | 风险/坑 | 说明 | 缓解 |
|---|---|---|---|
| 1 | 预发布破坏性变更 | 插件协议、配置格式、session 存储随时可能变，`rc.8` 已发生 | 版本锁定、协议边界集成、升级演练 |
| 2 | 沙箱依赖环境 | Linux 需 bwrap/Landlock，macOS 需 Seatbelt；容器/精简环境缺失会静默降级 | 部署前验证沙箱后端；无沙箱时用策略兜底（workspace-write 等） |
| 3 | 审批/权限体系要自建 | dsh 权限与沙箱需要部署方配置负责 | 复用 `dsh-user-approval` 政策配置，对接平台审批中心 |
| 4 | 「模型可见=已记录」强约束 | 新增模型可见输入需新增 session event 类型，不能随意注入 | 平台业务上下文走官方注入点（`agent.inject()`、prompt section、skill） |
| 5 | 插件生态不成熟 | 无官方插件市场，第三方插件质量参差 | 平台自建插件库目录，第三方插件引入需审查 |
| 6 | Cordis 学习曲线 | ctx/effect/event/waterfall 范式与常规开发不同 | 薄插件策略 + cookbook + 内部脚手架模板 |
| 7 | stdout 协议冲突 | ACP/JSON-RPC 场景 stdout 是协议线，任何日志/插件写 stdout 都会破坏协议 | 平台侧严禁业务插件写 stdout；诊断走 stderr |
| 8 | 命令行工具自由文本 | 高频动作走命令行导致结果不确定、权限粒度粗 | 高频动作结构化工具化 + output schema |
| 9 | 长会话成本 | 长历史 token 累积，KV 缓存与压缩需要配置 | 开启 `dsh-compaction-basic` 与 token-meter |
| 10 | 多 Agent 资源 | 每会话独立上下文，并发模块检测的内存/配额 | preset 复用、并发上限、会话生命周期管理 |
| 11 | 子进程生命周期 | SDK 子进程崩溃/泄漏影响平台 | 平台侧守护与重启、`close()` 语义、超时兜底 |
| 12 | 动态插件安全 | `cordis_define` 沙箱是「诚实代码的隔离」而非安全边界 | 仅内部可信环境开启；生产关闭该工具集 |

---

## 8. 更新与兼容策略

1. **版本锁定**：`cordis.yml` 与 `package.json` 显式 pin dsh 版本；CI 里校验版本一致。
2. **协议边界优先**：平台 ↔ dsh 只走 SDK/ACP 协议，不 import dsh 内部包；协议变更评审独立于 dsh 业务代码变更。
3. **薄插件 + 接口面收敛**：业务插件只注册工具/prompt/output schema，不碰 loop 与核心事件；升级时改动面 = 插件层 + cordis.yml。
4. **存储隔离与备份**：`persistenceRoot` 独立；升级前备份；SQLite schema 变更 fail loud，用独立目录重建即回退。
5. **升级演练**：升级 = 跑全量代表性检测场景回归 + 检查 session 可回放，通过才切流量；发布流程含「dsh 版本变更」门禁。
6. **双写审计**：报告与关键证据写入平台自有库，dsh session 文件仅作运行时回放；跨大版本允许清空 dsh 会话，平台证据不受影响。
7. **1.0 前定位**：试点 + 灰度，不做历史数据兼容承诺；跟随上游 changelog 提前评估。

---

## 9. 落地路线图

### 一期：最小可行试点（2-4 周）
- 目标：打通「模块选择 → Agent 执行 → 固定报告」的最小链路，验证协议边界。
- 内容：
  - 用 SDK 子进程拉起 dsh，跑通 `run()` 与事件订阅；
  - 选 1-2 个法规模块：各建一个 preset（工具集 + 法规参考 prompt）+ 一份测试方法 skill；
  - 定义报告固定 schema（一个结构化输出工具或 workflow 模板）；
  - 版本锁定与升级演练脚本（备份、回归、回退）。

### 二期：能力放开（1-2 个月）
- 目标：多模块并行、权限对接、模型生成 workflow。
- 内容：
  - preset 目录扩展为「模块市场」，平台侧管理启停；
  - 对接平台审批中心到 `dsh-user-approval` policy；
  - 放开 `workflow` 工具：模型基于法规+方法生成编排脚本，配合 phase/日志事件回显；
  - 平台插件管理页（查看已挂载插件/工具，对应 `cordis_inspect` 的运维化）。

### 三期：平台化（持续）
- 目标：插件生命周期管理、审计回放、性能与成本监控。
- 内容：
  - 动态插件（`cordis_define` 原型）→ 正式插件的沉淀工具；
  - session 回放审计中心；
  - token/成本统计（token-meter 事件流）；
  - 1.0 正式版发布后重评估兼容承诺并收紧升级策略。

---

## 10. 附录：关键资料与术语

### 10.1 仓库内关键文档
- 架构总览：`docs/architecture.md`、`docs/cordis-primer.md`
- 能力缝与扩展点地图：`docs/capability-seams.md`、`docs/cookbook/extension-cookbook.md`
- 工具系统：`docs/subsystems/tools.md`、`docs/tool-catalog.md`
- 子代理：`docs/subsystems/subagent.md`
- 工作流：`docs/subsystems/workflow.md`
- 会话：`docs/subsystems/session.md`、`docs/persistence-catalog.md`
- 配置目录（全部可配项）：`docs/config-catalog.md`
- SDK：`packages/sdk/README.md`、`packages/sdk/client/README.md`
- ACP：`packages/acp/acp/README.md`
- 最小骨架：`packages/examples/agent-spine-demo/README.md`
- 可运行示例配置：`examples/acp-agent/cordis.yml`
- 工具开发教程：`docs/cookbook/adding-a-tool.md`、`docs/user/develop/basic/tool.md`
- 插件包开发清单：`docs/cookbook/adding-a-package.md`

### 10.2 关键术语
- **Cordis**：dsh 依赖的插件框架（vendored），「一切皆插件」的基础。
- **Seam（能力缝）**：Service Definition + Service Provider + Consumer 三位一体的可替换能力。
- **Scope（作用域）**：每 Agent 的注册单元，注册只对拥有者可见；`agent.ctx` 即其作用域上下文。
- **Preset（预设）**：每会话的 Agent 组合（`agent.cordis.yml`），一个目录一个场景。
- **Session event（会话事件）**：append-only 日志条目；「模型可见=已记录」。
- **Turn / Step**：一个 turn 是一次输入清算；一个 step 是一次模型请求 + 其工具执行。
- **workflow**：模型写的 JS 编排脚本，启动子代理；`meta`/`args` 为纯 JSON。
- **Ralph loop**：前台 fresh-agent 循环，向不可变目标迭代，round 间用有界 handoff 报告传递状态。
- **ACP**：Agent Client Protocol，自动化专用 JSON-RPC 协议。
- **Code Mode / run_code**：一段程序集中编排多步工具调用的模型工具形态（「PTC」）。
- **SESSION_FORMAT_VERSION / SCHEMA_VERSION**：会话日志与 SQLite 库的版本号，单调递增，旧格式 fail loud 拒绝。

### 10.3 外部渠道
- 仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 插件发现：GitHub topic `dsh-plugin`
- 社区：Discord、GitHub Discussions
- 发布：GitHub Releases（`dsh-v0.1.0-rc.8` 为当前 tag）
