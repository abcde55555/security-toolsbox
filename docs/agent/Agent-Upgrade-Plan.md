# EN18031 合规测试平台 · 智能体（Agent）升级改造方案

> **文档版本**：v1.2
> **产出日期**：2026-08-20
> **输入依据**：《DeepSeek Harness（dsh）平台集成可行性调研方案》（dsh-v0.1.0-rc.8）＋ 本仓库现有代码与文档 ＋ 业务痛点访谈
> **适用读者**：架构师、Tech Lead、后端/前端/模组开发工程师、测试工程师
> **读完后你能做的事**：理解平台从「确定性模板编排」升级为「Agent 引导的人机协同合规测试平台」的架构决策、分阶段工作流、改造范围、分期实施计划与风险清单，并据此拆任务单。

---

## 1. 结论摘要

1. **业务本质**：IoT 设备合规测试的痛点在于——工具不固定、流程不固定、且高度依赖硬件外设与人为操作（配网、接线、按键触发、抓包）。纯脚本编排无法通用，纯人工又不够标准化。因此本方案的核心工作流**不是「全自动模板编排」，也不是「法规条款步骤直接映射为全部测试步骤」，而是「Agent 引导的人机协同分阶段测试」**：法规条款约束「判定阶段」的测试范围，Agent 动态规划全程步骤（含不映射条款的前期准备与收集步骤）、执行工具、在需要人工介入时暂停并引导用户，全程采集证据，最后在判定阶段把证据分析结果分配到条款下，产出判定供用户审核。
2. **关键澄清（本版修正）**：法规步骤 ≠ 平台完整测试步骤。一个完整测试项目包含多个阶段，其中只有「判定阶段」的步骤直接映射 EN18031 条款；前期的设备信息采集、配网接入、环境搭建、抓包/日志收集等步骤**不映射条款**，但它们的产物（设备档案、网络拓扑、抓包文件）是判定阶段分配条款到证据的基础。方案必须显式区分这两个层次，否则会把「准备工作」误当作「合规判定」，导致流程建模错误。
3. **可行性判断**：可行，现阶段（dsh 1.0 之前）定位为「并行试点」而非「全线替换」。平台现有的「执行引擎 + 条款映射 + 报告 + 审计 + 工具/条款管理」是合规场景必须保持确定性、必须可管理可视化的部分，全部保留；dsh 负责「模型在环的决策、规划、解释、人机交互引导」这一平台缺失的部分。
4. **接入方式**：采纳 dsh 调研的**路径 A（SDK 子进程模式，stdio JSON-RPC）**为主，路径 B（ACP）用于无状态批任务。dsh 以版本锁定的子进程存在，升级/崩溃风险隔离在协议边界外。
5. **为什么用平台而非直接用 Claude Code 等终端 Agent**：终端 Agent 无法提供「工具管理、法规条款配置、测试流程配置、判定审核、证据链、报告归档、审计」这些管理面与合规面能力；平台承载管理，dsh 承载决策。为什么用 dsh：万物皆插件的理念使其工具集、预设、工作流可被平台动态重组，扩展性与可玩性正是本项目想要的。**插件化边界（见决策七）**：Agent 运行时能力（工具、skill、preset、workflow）以 dsh 插件形式承载，可进 dsh 生态复用；平台的管理面与数据面（工具库/条款库管理、判定审核、证据链、报告、审计、权限）不插件化，保留为平台宿主，保证合规确定性。
6. **审计双写**：dsh session log 只作运行时回放证据；报告、条款判定、证据、审核动作双写平台自有库（`clause_verdicts`、`evidences`、`reports`、`audit_logs`），跨 dsh 大版本允许清空 dsh 会话，平台合规证据不受影响。

---

## 2. 业务痛点与设计原则

### 2.1 痛点拆解

| # | 痛点 | 说明 | 方案回应 |
|---|---|---|---|
| 1 | 执行工具不固定 | 不同设备/场景用不同工具（nmap、tcpdump、binwalk、厂商 SDK、串口脚本） | 平台工具库统一管理，Agent 按需选用 |
| 2 | 测试流程不固定 | 无法预写一套通用编排脚本覆盖所有设备 | 不预定义固定步骤；Agent 分阶段动态规划，法规条款约束判定阶段范围 |
| 3 | 硬件外设与人为触发 | 配网、插拔串口/USB、按按键、继电器上电，脚本无法自动完成 | 「人工步骤」节点：Agent 暂停并引导用户，用户完成后继续 |
| 4 | 纯人工不标准化 | 判定依赖个人经验，结果不可复现、不可追溯 | 条款判定草案 → 用户审核 → 证据链归档，标准化且可追溯 |
| 5 | 证据分散 | 抓包文件、日志散落各处，难以关联到条款 | 每步证据落平台文件库，收集阶段先存证，判定阶段再分配到条款 |
| 6 | 审核与重跑 | 某条款判定不认可时需要局部重跑，而非整流程重来 | 待审核判定状态 + 按条款局部重跑（复用现有 retry 机制） |
| 7 | **法规步骤 ≠ 完整测试步骤** | 法规条款只覆盖「测试判定」环节，但完整项目还有设备采集、配网、环境搭建、抓包收集等前期工作 | 引入「阶段」模型：准备/收集阶段步骤不映射条款，判定阶段步骤映射条款；前期产物作为判定依据 |

### 2.2 设计原则

1. **确定性执行与生成式决策分离**：工具执行、条款判定、合规定级走平台确定性引擎；Agent 只做「规划下一步、选择工具、解释结果、生成判定草案与整改建议」等生成式部分。定级（grade）永远由 `ReportService` 规则引擎计算，不交给模型。
2. **人机协同是核心，不是兜底**：Agent 会话天然是半结构化流程——自动步骤与人工步骤交替，Agent 在任何需要硬件操作/外部信息/确认的节点暂停并引导用户。dsh 的 `request_permission` / approval policy 承载这类交互。
3. **证据驱动**：判定必须可追溯到证据（抓包文件、命令输出、操作记录）；「无证据的判定」沿用平台已有机制降级处理（`ClauseMappingService` 校验）。
4. **平台是单一真源**：工具、法规条款、判定、报告、审计、审核记录全部落在平台库；dsh 只持有模型行为与决策（session log），不持有合规证据。
5. **半结构化流程可持久化、可断点续跑**：测试会话可能跨天（抓包放一夜），每一步人工/自动步骤的结果即时落库，重启后可从「未完成的步骤」继续。
6. **阶段与条款解耦**：步骤是否映射条款由「阶段」决定，而非步骤本身。准备/收集阶段的步骤 `clauseId=null`，其产物作为「测试工件」暂存；只有判定阶段的步骤才产出 `ClauseVerdict`。报告定级只基于判定阶段结果，准备/收集阶段作为「测试过程记录」进入报告附录（可追溯但不参与定级）。

---

## 3. 核心工作流：Agent 引导的人机协同分阶段测试

### 3.1 阶段模型（Phase Model）

一个完整测试项目分为四个阶段，**只有阶段 C 直接映射 EN18031 条款**，阶段 A/B 是阶段 C 的输入准备：

| 阶段 | 名称 | 是否映射条款 | 目标 | 产物（测试工件/证据） |
|---|---|---|---|---|
| A | 前期准备（Onboarding） | 否（clauseId=null） | 建立设备档案与测试环境 | 设备档案（型号/固件版本/硬件/MAC/序列号）、网络拓扑、接入状态、配网结果 |
| B | 证据收集（Collection） | 否（clauseId=null） | 按功能模块采集原始证据 | 抓包 pcap（配网/协议/升级/App 通信）、串口日志、系统 dump、固件镜像——先存证、标注功能模块标签 |
| C | 条款判定（Adjudication） | **是（clauseId 非空）** | 执行测试工具 + 分析阶段 B 证据，分配条款结论 | `pending_review` 判定草案（`evidenceRefs` 可跨阶段引用阶段 B 证据） |
| D | 审核与报告（Review & Report） | 是（继承阶段 C） | 用户审核判定、局部重跑、产出正式报告 | `approved` 判定、定级 grade、报告归档、整改建议 |

**为什么必须分阶段**：
1. 法规只回答了「判定阶段测什么、怎么算通过」，没回答「怎么把设备接进来、怎么抓到正确的包」——后者依赖设备特性与人工经验，正是 Agent 动态规划的用武之地。
2. 收集阶段的证据（如某功能模块的抓包）在采集时并不知道会判到哪些条款，只能先按「功能模块」标签存证；到判定阶段由 Agent 分析后再分配到具体条款。若一开始就强制每一步绑定条款，会逼 Agent 把准备工作硬塞进条款，造成流程建模错误。
3. 报告的可追溯性要求「过程记录」与「判定依据」分离：阶段 A/B 进报告附录（展示完整测试过程），阶段 C/D 进判定主体（定级）。

### 3.2 工作流总览

```
用户选定 设备 + 法规模块（判定阶段条款集合 + 可用工具集，由平台配置）
        │
        ▼
┌─ 阶段 A 前期准备 ────────────────────────────────┐
│  Agent 规划：设备信息采集 / 配网接入 / 环境搭建    │
│  （多为人工步骤或设备操作工具）                    │
│  产物 → 设备档案 + 网络拓扑（测试工件，clauseId=null）│
└────────────────────┬─────────────────────────────┘
                     ▼
┌─ 阶段 B 证据收集 ────────────────────────────────┐
│  Agent 规划：按功能模块抓包 / 串口日志 / 固件提取   │
│  （人工引导 + evidence_attach）                   │
│  产物 → 证据文件集（clauseId=null，功能模块标签）   │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─ 阶段 C 条款判定 ────────────────────────────────┐
│  Agent 规划：针对已选条款执行测试工具（module_exec）│
│  并分析阶段 B 证据 → 分配条款结论                  │
│  产物 → pending_review 判定草案                   │
└────────────────────┬─────────────────────────────┘
                     ▼
┌─ 阶段 D 审核与报告 ──────────────────────────────┐
│  用户逐条审核：确认 / 拒绝(附理由→按条款局部重跑)   │
│  报告：确定性定级 + 审核后判定 + 证据链            │
│        + 阶段 A/B 过程记录（附录） + 整改建议       │
└──────────────────────────────────────────────────┘
```

### 3.3 步骤类型设计（StepRun 扩展）

现有 `StepRun` 只有自动执行语义，需扩展类型字段 `stepType` 与 `phase`：

| stepType | 语义 | 执行主体 | 产物 | 常见阶段 | 对应 dsh 能力 |
|---|---|---|---|---|---|
| `tool_exec` | 自动执行平台工具/模组 | 平台 ExecutionEngine | `ExecutionResult`（evidence+verdicts） | A/C | 工具调用（`module_exec` / `template_run`） |
| `human_instruction` | 人工步骤：Agent 给指令，等待用户完成 | 用户（平台 UI 展示指令 + 完成按钮 + 证据上传） | 用户确认记录、上传文件 | A/B | `request_permission` / 自定义 `human_step` 事件 |
| `evidence_attach` | 证据采集：引导抓包/截图/串口 | Agent 引导 + 用户或工具完成 | pcap / 图片 / 串口日志，落平台文件库 | B | 工具调用 + 文件回传 |
| `analysis` | 证据分析 → 条款判定草案 | Agent（模型分析结构化证据） | 判定草案（`pending_review` 的 ClauseVerdict） | C | 模型推理 + 结构化输出 |

**字段说明**：
- `phase: 'onboarding' | 'collection' | 'adjudication' | 'review'`（阶段 A/B/C/D 落标）。
- `clauseId` 可空：阶段 A/B 的步骤 `clauseId=null`（沿用 `TemplateStep.clauseId` 已支持 `string | null` 的约定）；仅阶段 C 步骤 `clauseId` 非空。
- 阶段 B 的证据先以 `clauseId=null + functionModule 标签` 存证；阶段 C 分析后通过 `evidenceRefs` 跨阶段引用，并把判定写入 `ClauseVerdict`。

### 3.4 条款判定审核流

1. Agent 在阶段 C 分析证据后生成的判定以 `ClauseVerdict` 落库，新增状态字段 `reviewStatus: 'pending_review' | 'approved' | 'rejected' | 'skipped'`。
2. **审核不通过的判定不进入报告定级**；报告页对 `pending_review` 判定单独标注，定级只基于 `approved` 判定 + 未覆盖条款按 `not-covered` 处理（沿用现有规则）。
3. 用户拒绝时附带理由（写审计日志），Agent 据此**局部重跑该条款**：通过 `clauseBindings`/步骤上的 `clauseId` 定位相关判定阶段步骤，仅重跑这些步骤（复用 `OrchestratorService.retryStep` 的思路，扩展为「按条款重跑一组步骤」），不重置其他条款结果。
4. 若判定需要补充证据（如某条款证据不足），Agent 可**回退到阶段 B** 补抓数据，再回到阶段 C 重新分析——阶段间可反向迭代。
5. 所有审核动作（谁、何时、对哪条判定、结果）写入 `audit_logs`，满足合规可追溯。

### 3.5 人工步骤的执行语义

- Agent 需要人工介入时，通过 dsh `request_permission`（或平台 `human_step` 事件）暂停，前端 Agent 会话页展示指令卡片（含步骤说明、预期结果、可选参考命令）。
- 用户完成操作后点击「继续」，可附带上传证据文件（抓包、截图）；平台写入该步骤的 evidence，再放行 Agent 继续规划。
- 用户也可在任意时刻「打断」：新增输入/修正给 Agent，Agent 调整计划。

### 3.6 证据与条款的关联（跨阶段）

- 阶段 B 采集的证据写入平台 `evidences` 表（`clauseId=null`，`functionModule` 标注功能模块），文件存平台 `filesDir/evidence/`。
- 阶段 C 判定时，Agent 把证据引用挂到判定草案的 `evidenceRefs`，此时证据才与条款建立关联；用户审核时可点开查看原始 pcap / 日志 / 截图。
- 沿用平台「判定缺失证据则降级」机制：Agent 若给不出证据引用，判定草案直接标为 `skipped` 并提示补充证据。
- 阶段 A 的设备档案/网络拓扑作为「测试工件（artifact）」单独存储（`artifacts` 表，见 7.2），供阶段 C 的工具执行引用（如把设备档案中的 IP 注入端口扫描参数），也进报告附录。

---

## 4. 平台现状盘点：哪些是 Agent 化的天然基础

以下为对仓库代码事实的盘点。平台已经具备 Agent 化所需的绝大部分「确定性执行底座」，缺的是「模型在环的决策层」与「人机协同/分阶段步骤语义」。

### 4.1 已有（保留不动）的确定性底座

| 能力 | 代码位置 | 对 Agent 化的价值 |
|---|---|---|
| 执行引擎门面（runCommand / runModule） | `packages/server/src/engine/executionEngine.ts` | 工具执行的标准入口，支持取消令牌与超时 |
| 命令执行器（进程树 kill、超时、取消） | `packages/server/src/engine/commandExecutor.ts` | 自动执行型步骤的安全边界 |
| 模组加载器（SDK 契约校验） | `packages/server/src/engine/moduleLoader.ts` | 4 个内置模组以工具形式暴露给模型 |
| 编排引擎（DAG、并发、失败策略、断点续跑、compliance 聚合） | `packages/server/src/services/orchestratorService.ts` | 可复用其调度/重试/进度机制承载半结构化流程 |
| 条款映射与判定 | `clauseMappingService.ts`、`verdictEvaluator.ts` | 输出已是结构化 `clauseId + pass + reason + evidenceRefs`，对应 dsh `output.schema` |
| 报告定级与导出 | `reportService.ts` | 确定性定级，绝不交给模型 |
| append-only 审计日志 | `repositories/auditRepository.ts` | 审核/执行/人工步骤全部可追溯 |
| 权限钩子 | `services/authzService.ts`（目前占位放行） | Agent 路径必须先真正打开角色校验 |
| 前端 React 界面（Terminal 组件等） | `packages/web/src/` | Agent 会话页可复用 |
| 4 个内置模组 + 工具库模型 | `packages/modules/`、`tools` 表 | 直接作为 Agent 的结构化工具面 |
| 文件证据存储与导出配置 | `config.filesDir` / `reportsDir` | 抓包/日志/截图落库的现成位置 |

### 4.2 平台当前缺失（需新增）的部分

1. **Agent 会话生命周期**：dsh runtime 子进程拉起、会话创建/复用/销毁、事件订阅转发到平台 WebSocket。
2. **Agent 工具桥**：把平台工具/模组/条款/工件查询以 `defineTool` 薄插件形式注册进 dsh，并映射回平台 API。
3. **阶段与人工步骤语义**：`stepType`、`phase`、`ClauseVerdict.reviewStatus`、按条款局部重跑、阶段间反向迭代、审核动作审计。
4. **测试工件（artifact）管理**：阶段 A/B 产物（设备档案、网络拓扑、功能模块证据）先存证再分配条款。
5. **审批对接**：dsh `dsh-user-approval` policy ↔ 平台 `AuthzService` 角色。
6. **skill 生成**：由条款库 `testingMethod` + 模组 README 生成 `SKILL.md`（测试方法知识注入）。
7. **preset 生成与目录**：每个法规模块一个 `agent.cordis.yml`（约束判定阶段条款范围 + 授权工具集），平台侧管理启停。
8. **设备操作工具**：串口/USB/继电器等外设操作封装为平台工具（category 扩展 `device-interaction`）。
9. **前端 Agent 入口**：模块选择、Agent 会话页（阶段时间线 + 指令卡片 + 审核面板）。

---

## 5. 总体架构决策

### 5.1 总体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 平台（自研，保持独立，所有合规证据与判定落在平台侧）                      │
│                                                                     │
│  前端（React/AntD 现有 + 新增）                                       │
│   ├─ 新增：法规模块选择 / Agent 会话页（阶段时间线+指令卡片+审核面板）   │
│   └─ 现有：工具库 / 模板 / 项目 / 执行记录 / 合规测试项 / 报告          │
│                                                                     │
│  业务服务层（现有 + 新增）                                            │
│   ├─ 现有：ToolRegistryService / TemplateService / ProjectService / │
│   │        OrchestratorService / ClauseMappingService /             │
│   │        ReportService / AuthzService                              │
│   └─ 新增：AgentService（会话生命周期）/ AgentToolBridge（工具桥）      │
│        / HumanStepService（人工步骤）/ ReviewService（判定审核）       │
│        / ArtifactService（测试工件）/ AgentPresetRegistry /          │
│        / SkillGenerator                                              │
│                                                                     │
│  执行引擎（现有，复用）                                              │
│   ├─ ExecutionEngine（runCommand / runModule）                      │
│   ├─ ModuleLoader（4 个内置模组 + 设备操作工具）                      │
│   └─ OrchestratorService（调度/重试/进度，承载半结构化步骤流）          │
│                                                                     │
│  持久化（现有 + 字段扩展）：clause_verdicts(+reviewStatus) /          │
│   evidences(+clauseId,functionModule) / step_runs(+stepType,phase)  │
│   / artifacts(新增) / reports / audit_logs                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ stdio JSON-RPC（dsh-sdk-client，版本锁定）
┌────────────────────────────▼────────────────────────────────────────┐
│ dsh runtime（子进程，版本锁定）                                       │
│                                                                     │
│  ├─ cordis.yml：agent-spine + preset 挂载 + 业务薄插件                │
│  ├─ preset/：每法规模块一个 agent 组合（条款约束 prompt + 工具授权）   │
│  ├─ skills/：各模块测试方法（由平台条款库生成）                        │
│  └─ 薄工具插件：                                                   │
│       ├─ module_exec（调用平台执行 API，复用执行引擎）                 │
│       ├─ artifact_query（读设备档案/网络拓扑/功能模块证据索引）        │
│       ├─ clause_query / evidence_query / report_read（只读）         │
│       ├─ evidence_attach（引导用户上传抓包/截图）                     │
│       ├─ request_permission（人工步骤：暂停并等待用户完成）            │
│       └─ skill（dsh 原生，加载测试方法）                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 核心决策点

1. **决策一：Agent 执行回落平台，dsh 不做直连命令行**。dsh 薄工具插件的 `module_exec` 内部调用平台执行 API，最终执行、审计、条款映射、证据落库全部走平台既有链路。dsh 自带 bash/terminal 工具**只在内部可信试点环境开启**，生产默认关闭，规避自由文本与权限粒度风险。
2. **决策二：工具的单一真源是平台工具库**。`Tool` 表的 `formFields` + `clauses` + `commands` 是模型可见工具的 schema 来源；`AgentToolBridge` 在会话启动时按 preset 将授权工具动态注册为 `defineTool`，模型看到的工具 schema 与人工工具台一致。工具库新增 `device-interaction` 分类承接硬件外设工具。
3. **决策三：核心流程是「分阶段的人机协同逐步执行」，模板编排降级为可选能力**。
   - 主线（Agent guided）：Agent 按「准备→收集→判定→审核」四阶段动态规划，自动步骤与人工步骤交替，证据驱动、判定可审核、按条款重跑、阶段间可反向迭代。
   - 保留线（模板编排）：对流程相对固定的场景（尤其是阶段 C 判定部分），仍可让 Agent 选择平台既有模板一键执行（复用 `OrchestratorService`），作为效率选项而非核心假设。
4. **决策四：合规定级与判定审核是确定性+人工确认，模型只做生成式补充**。`grade` 由 `ReportService` 规则引擎计算；Agent 生成的判定是「草案」，必须经用户审核（`approved`）才生效；模型仅在报告「整改建议区」生成文本，同样需确认后入库。
5. **决策五：阶段 A/B 与阶段 C 的边界强制**。只有阶段 C 步骤可产出 `ClauseVerdict`；阶段 A/B 步骤 `clauseId=null`，其产物一律进 `artifacts`/`evidences`（clauseId=null）。平台在落库时校验：非判定阶段步骤不得写 `clause_verdicts`，判定阶段步骤必须带 `clauseId`。
6. **决策六：版本锁定 + 协议边界 + 双写审计**。采纳 dsh 调研第 8 节全部策略；平台侧业务插件做成薄层，只注册工具/prompt/output schema，不碰 agent-loop 与核心事件。
7. **决策七：平台为宿主、插件为能力（管理面不插件化）**。评估过「把整套功能全做成 dsh 插件」的路线，结论是「管理与数据面留在平台，Agent 运行时能力插件化」。
   - **适合做成 dsh 插件（运行时能力，进生态可复用）**：测试方法 skill（`SKILL.md`）、法规模块 preset（`agent.cordis.yml`）、工具定义（`defineTool` 包一层执行逻辑）、`request_permission` 人工交互、模型生成的 workflow。
   - **不适合做成 dsh 插件（管理面/数据面，属平台宿主）**：工具库/条款库 CRUD 与配置管理（面向人、需权限）、判定审核与证据链（强业务 schema + 审批）、报告归档（`ReportService` 确定性输出）、审计日志（平台 append-only 真源）、用户/角色权限（`AuthzService`）。
   - **两者区别**：dsh 插件是「给 Agent 用的能力」，解决「模型如何被装配、如何与工具交互」；平台管理面解决「合规如何被管理、证据如何被信任」。dsh 的持久化与权限面向 session 回放，不面向业务建模，强业务 schema（条款、判定、审核、报告）放 dsh 层既无管理 UI 也无版本承诺。
   - **全插件化风险**：dsh 当前 0.1.0-rc，插件协议与 SQLite schema 随时破坏性变更，全押注意味着「升级 dsh = 重写整个平台」；现有三层架构（工具库-模板-项目）、报告、审计、条款映射要全部用插件协议重建，等于推翻已有工程；dsh 目前没有面向业务表单的管理 UI，报告/审核界面仍需自建。
   - **双向打通（推荐演进）**：平台模组的执行逻辑包装成标准 `defineTool` 薄插件，既服务本平台，也可发布进 dsh 生态供第三方复用；dsh 生态的第三方工具插件可经 `AgentToolBridge` 反向挂载进平台工具库。平台不依赖 dsh，dsh 生态能用平台能力。

### 5.3 一次 Agent 引导的合规检测端到端流转

1. **阶段一 模块选择**。用户选定设备与法规模块（如 5.3 网络通信），`AgentPresetRegistry` 挂载对应 preset 到 dsh 会话作用域，注入条款约束 prompt section 与授权工具集。
2. **阶段二 知识注入**。`SkillGenerator` 生成的测试方法 `SKILL.md` 已在 dsh `skills/`；模型用 `skill` 工具按需加载测试方法（判定阶段 + 准备/收集阶段的通用操作指引）。
3. **阶段三 阶段 A 准备**。Agent 规划设备信息采集、配网接入、环境搭建步骤（人工步骤 + 设备操作工具），产物写入 `artifacts`（设备档案、网络拓扑）。
4. **阶段四 阶段 B 收集**。Agent 按功能模块规划抓包/串口日志/固件提取（`evidence_attach` + 人工引导），证据以 `clauseId=null + functionModule` 落 `evidences`。
5. **阶段五 阶段 C 判定**。Agent 基于已选条款规划测试工具（`module_exec`），结合阶段 A 工件参数 + 阶段 B 证据分析，产出 `pending_review` 判定草案，`evidenceRefs` 跨阶段引用。
6. **阶段六 阶段 D 审核**。用户逐条审核：确认生效；拒绝则附理由，Agent 按 clauseId 局部重跑（证据不足时回退阶段 B 补采）；全部审核动作写审计。
7. **阶段七 报告**。`ReportService` 基于 `approved` 判定确定性定级；阶段 A/B 过程记录进报告附录；Agent 整改建议确认后并入报告；双写审计完成。

---

## 6. dsh 调研文档中「平台现状四个关切」的落地设计

### 6.1 关切一：tools_use 工具分类，工具多为命令行

**落地设计**：
1. **分层原则**：按「输出确定性」分类。4 个内置模组（结构化 `ExecutionResult`）进 Agent 主工具面；命令行工具作为受限兜底面，Agent 调用前必须走审批；新增 `device-interaction` 分类承载串口/USB/继电器等硬件工具（结构化交互，不是自由 shell）。
2. **schema 映射**：`AgentToolBridge` 把模组 `formFields` 转成 dsh 工具输入参数 schema，把 `clauses` 声明转成输出 `output.schema` 骨架（clauseId + pass + reason + evidenceRefs）。dsh `INVALID_TOOL_OUTPUT` 与平台 `sanitizeAndEnforceResult` 双重校验。
3. **人工与 Agent 共用工具**：元数据单一真源在平台 `tools` 表；人工工具台、Agent 工具视图都从它渲染（对应 dsh `tools.restrict()` + preset 作用域）。

### 6.2 关切二：插件编写费劲，需要人工可查看的位置

**落地设计**：
1. **平台自建「业务插件/预设目录」作为查看位置**：`packages/server/agent/presets/<moduleId>/agent.cordis.yml` 一个法规模块一个目录；`packages/server/agent/skills/<moduleId>/SKILL.md` 存放测试方法。用目录结构 + 平台「Agent 预设管理页」充当目录。
2. **运行时查看**：平台提供「已挂载工具/预设」管理页，数据来源一为平台 `AgentPresetRegistry`，二为 dsh `cordis_inspect` 的只读快照。
3. **编写体验分两档**：探索期允许模型用 `cordis_define` 在 dsh 进程内存现场原型（仅内部试点环境）；正式化由平台维护者把原型沉淀为 `AgentToolBridge` 中的薄插件。不依赖 dsh 的动态插件自动转正（dsh 目前没有）。

### 6.3 关切三：法规模块 → 生成 workflow → 固定报告

**落地设计**：
1. **本期（核心）**：走「preset 条款约束 + skill 测试方法 + Agent 分阶段动态规划 + 人工步骤 + 判定审核」的人机协同模式，不需要模型写脚本，动作与输出确定性可控，正好规避「命令行为主的自由文本」风险。
2. **流程固定化场景**：当某个法规模块判定阶段（阶段 C）的测试流程被验证为稳定后，允许把步骤清单沉淀为平台模板，后续 Agent 可直接选用（效率选项）；同时支持用户把 Agent 会话中确认过的步骤「另存为模板」。准备/收集阶段（A/B）因其设备相关性高，一般不模板化，保留 Agent 动态规划。
3. **报告落库**：判定草案审核通过后写入 `clause_verdicts`，`ReportService` 定级；阶段 A/B 过程记录写入报告附录；dsh session log 留作回放证据。

### 6.4 关切四：dsh 后续大更新的兼容性

**落地设计**：完整采纳 dsh 调研第 8 节，并补充平台侧动作：
1. `package.json` 显式 pin dsh 版本，CI 校验版本一致。
2. 平台↔dsh 只走 `dsh-sdk-client` 协议，不 import dsh 内部包；薄插件只依赖稳定的注册 API。
3. dsh 持久化目录独立于平台 `data/`，升级前整目录备份。
4. 升级演练进发布流程（全量代表性场景回归 + session 可回放 + 双写证据完整）。
5. 审计证据双写平台自有库，跨大版本允许清空 dsh 会话文件。

---

## 7. 平台侧改造清单（按代码模块）

### 7.1 新增 `packages/server/src/agent/` 目录

| 文件 | 职责 |
|---|---|
| `agentService.ts` | Agent 会话生命周期：创建/复用/销毁 dsh 会话，绑定 preset，转发事件到平台 WS |
| `dshClient.ts` | 封装 `dsh-sdk-client`：子进程拉起、版本校验、`run()` / `session()`、错误类型化 |
| `agentToolBridge.ts` | 把平台 `tools`/`clauses`/`artifacts` 元数据生成 dsh `defineTool` 薄插件；执行回落平台 API |
| `agentPresetRegistry.ts` | 读取 `presets/*/agent.cordis.yml`，管理预设启停、工具授权（`tools.restrict`） |
| `skillGenerator.ts` | 从 `clauses.testingMethod` + 模组 README 生成 `SKILL.md`（幂等） |
| `humanStepService.ts` | 人工步骤节点：指令卡片状态机（pending→waiting_user→completed），用户完成/上传证据 |
| `reviewService.ts` | 判定审核：`pending_review→approved/rejected`，拒绝附理由，按条款定位局部重跑 |
| `artifactService.ts` | 测试工件管理：阶段 A/B 产物（设备档案/网络拓扑/功能模块证据索引）存证与查询 |
| `approvalBridge.ts` | 平台 `AuthzService` 角色 ↔ dsh `dsh-user-approval` policy；高危操作审批 |

### 7.2 数据模型扩展（`packages/shared/src/types.ts` + 迁移）

1. `StepRun` 增加 `stepType: 'tool_exec' | 'human_instruction' | 'evidence_attach' | 'analysis'`（默认 `tool_exec`）与 `phase: 'onboarding' | 'collection' | 'adjudication' | 'review'`。
2. `ClauseVerdict` 增加 `reviewStatus: 'pending_review' | 'approved' | 'rejected' | 'skipped'` + `reviewedBy` / `reviewedAt` / `reviewNote`。
3. `Evidence` 增加 `clauseId?`（可空）+ `functionModule?`（功能模块标签，阶段 B 存证用）+ `sourceStepType?`。
4. 新增 `artifacts` 表：阶段 A/B 产物（type 枚举 `device_profile`/`network_topology`/`onboarding_result`/`other`、content/fileRef、关联 projectRunId、可选 clauseId 恒为 null）。
5. `Project` 增加 `mode: 'template' | 'agent-guided'`（agent-guided 下 preset 仅提供条款覆盖声明 + 工具集，步骤由 Agent 分阶段动态生成）。
6. 新增 `agent_sessions` 表（关联 projectId、presetId、dsh 会话句柄、当前阶段、状态、相关变量）。
7. **落库校验（强制）**：`clause_verdicts` 只允许来自 `phase=adjudication` 的步骤；非判定阶段步骤写 verdict 直接拒绝。

### 7.3 新增平台 API（前缀 `/api/agent`）

1. `POST /api/agent/sessions`：创建 Agent 会话，body `{ presetId, projectId?, deviceInfo?, variables? }`。权限：auditor 及以上。
2. `GET /api/agent/sessions`：会话列表。
3. `POST /api/agent/sessions/:id/plan`：请求 Agent 生成分阶段测试计划（含阶段标注）。权限：auditor。
4. `POST /api/agent/sessions/:id/advance-phase`：阶段推进/回退（如判定阶段证据不足回退到收集阶段）。权限：auditor。
5. `POST /api/agent/sessions/:id/prompt`：向会话发消息/打断并修正。权限：auditor。
6. `POST /api/agent/sessions/:id/human-step/:stepId/complete`：用户完成人工步骤（可带证据文件）。权限：auditor。
7. `POST /api/agent/sessions/:id/cancel`：取消当前活动（dsh SDK 无 mid-turn cancel，需关会话进程，平台侧守护重启）。权限：auditor。
8. `GET /api/agent/presets`：预设列表（法规模块 → preset → 授权工具/关联条款）。
9. `POST /api/agent/tools/execute`：dsh 工具桥回调入口（`module_exec`/`evidence_attach` 落点），内部走 `ExecutionEngine`，返回结构化结果。权限：auditor + approval（高危）。
10. `GET /api/agent/sessions/:id/artifacts` / `POST /api/agent/artifacts`：测试工件读写。权限：auditor。
11. `POST /api/agent/verdicts/:id/review`：审核判定（approve/reject + note）。权限：auditor。
12. `POST /api/agent/sessions/:id/report-suggestion`：提交 Agent 整改建议，`pending_review`，确认后并入报告。权限：auditor 提交 / template_manager 确认。
13. WebSocket：Agent 会话事件流（复用现有 socket.io 基础设施，新增 `agent:event` 房间）。

### 7.4 前端新增

1. 新导航入口「智能体 Agent」：法规模块选择（复用 `Clauses` 条款数据）、Agent 会话列表。
2. `AgentSessionPage`：
   - 阶段时间线（A 准备 / B 收集 / C 判定 / D 审核，步骤类型、状态、进度，复用 `Terminal` 展示工具输出）。
   - 指令卡片（人工步骤）：展示 Agent 指令、完成按钮、证据上传。
   - 判定审核面板：逐条展示 `pending_review` 判定 + 证据链 + 通过/拒绝（附理由）/挂起。
   - 工件视图：设备档案、网络拓扑、功能模块证据索引。
3. 报告页：判定主体（定级 + 条款）+ 阶段 A/B 过程记录附录 + 「整改建议区」（`pending_review` 的 Agent 建议 + 确认/拒绝）。

### 7.5 设备操作工具（硬件外设能力）

1. 工具库 `ToolCategory` 增加 `device-interaction`。
2. 首批设备工具示例：`serial-console`（串口控制台，封装 minicom/pyserial）、`usb-attach`（USB 设备枚举/挂载状态检查）、`relay-power`（继电器上电/断电，封装 GPIO/串口指令）、`packet-capture`（tcpdump 引导抓包 → 证据落库，产出标注功能模块）。
3. 设备工具以 cmd 或 form 模组两种形态接入，复用 `healthCheck`、`ExecutionResult`、证据落库链路；交互式长驻工具（串口）走现有取消令牌与超时机制。

### 7.6 权限与安全

1. 打开 `AuthzService.assertRole` 占位校验：Agent 会话、plan、prompt、执行、审核、审批各接口声明正确角色；先本地配置版，Milestone 4 接真用户系统。
2. 高危工具（cmd 型、全端口扫描、设备电源操作）在 Agent 路径下必须走审批；审批记录写 `audit_logs`。
3. 命令注入防线不放松：`module_exec` 仍走模组内部白名单校验（如 port-check 的 `SAFE_PORT_RANGE` + `SHELL_META`），不允许模型构造任意命令串。
4. 阶段边界校验：非判定阶段写 `clause_verdicts` 被拒，判定阶段写无 `clauseId` 的 verdict 被拒（服务层 + 落库双重校验）。

---

## 8. 分期实施路线图

### 一期：最小可行试点（2-4 周）

- **目标**：打通「法规模块选择 → 分阶段（A 准备/B 收集/C 判定）→ 证据采集 → 判定草案 → 用户审核」的最小闭环，验证协议边界、人工步骤语义、阶段边界与双写审计。
- **内容**：
  1. `dshClient.ts` + `AgentService` 骨架：子进程拉起、`run()`、事件订阅转发到 WS。
  2. 选 1-2 个法规模块（如 5.3 网络通信、5.5 固件安全）：各建一个 preset + `SkillGenerator` 生成测试方法 skill。
  3. `AgentToolBridge` 注册只读工具（`clause_query`、`artifact_query`、`evidence_query`）与执行工具（`module_exec`、`template_run`）。
  4. `HumanStepService` + `request_permission`：指令卡片、完成/上传证据、继续执行。
  5. `ArtifactService`：设备档案/网络拓扑/功能模块证据索引存证。
  6. `ReviewService`：判定草案 `pending_review` → approve/reject，拒绝附理由 + 按条款局部重跑。
  7. 报告：阶段 A/B 过程记录进附录；Agent 只填整改建议（`pending_review`），定级仍由 `ReportService`。
  8. 版本锁定 + 升级演练脚本（备份 dsh 目录、全量回归、回退）。
- **验收标准**：拿一个真实 IoT 设备，走「选 5.3 模块 → Agent 生成四阶段计划 → A 配网采集设备档案（人工）→ B 抓包存证（人工引导）→ C 端口扫描 + 分析抓包 → 判定草案 → 审核确认 → 报告定级与人工结论一致 → 整改建议确认入库」；阶段 A/B 步骤无 clauseId、不产出 verdict；`pending_review` 判定不计入定级；审计日志与 dsh session log 双写完整。

### 二期：能力放开（1-2 个月）

- **目标**：多模块并行、设备工具扩展、审批对接、流程沉淀、阶段间迭代。
- **内容**：
  1. preset 目录扩展为「模块市场」，平台侧管理启停与工具授权。
  2. 设备工具扩展：串口控制台、继电器电源、多协议抓包沉淀为正式工具。
  3. 审批对接：`AuthzService` 打开角色校验，`approvalBridge` 映射 dsh `dsh-user-approval` policy。
  4. 阶段 C 判定流程可「另存为模板」，供后续 Agent 直接选用；阶段 A/B 保持动态规划。
  5. 前端 Agent 会话页完善：阶段时间线、工具调用记录、模型推理摘要、终断/守护重启。
  6. 平台「已挂载工具/预设」管理页（`cordis_inspect` 运维化）。

### 三期：平台化（持续）

- **目标**：插件生命周期管理、审计回放、成本监控、workflow 放开。
- **内容**：
  1. 动态插件（`cordis_define` 原型）→ 正式插件的沉淀工具（平台自建）。
  2. session 回放审计中心（读取 dsh session log 渲染时间线）。
  3. token/成本统计（dsh token-meter 事件流接入平台报表）。
  4. 评估放开 dsh `workflow` 工具：对已验证稳定的判定阶段允许模型生成编排脚本（产出仍回落平台落库）。
  5. dsh 1.0 正式版发布后重评估兼容承诺，收紧升级策略。

---

## 9. 风险与坑清单

在 dsh 调研第 7 节的 12 条基础上，增补平台特有风险：

| # | 风险/坑 | 说明 | 缓解 |
|---|---|---|---|
| 13 | Agent 绕过平台执行 | 若模型直连命令行会绕过平台审计/条款映射 | 生产关闭 `dsh-tool-bash`/terminal；执行必须走 `module_exec`/`template_run` 桥 |
| 14 | 审批缺口 | `AuthzService` 目前占位放行 | Agent 接口一律显式 `requireRole`，一期即打开（本地配置版） |
| 15 | 回环超时/死锁 | dsh 子进程 → 平台桥 API → 长任务，链路超时难排查 | 桥调用独立超时；长任务走 `template_run`（复用编排进度/取消）；`module_exec` 限短任务 |
| 16 | 模型生成内容污染报告 | 判定草案/整改建议未经审核写入正式报告 | 一律 `pending_review`，确认人写审计日志；`pending_review` 不计入定级 |
| 17 | 双写不一致 | 平台判定与 dsh session log 时间线对不上 | 桥调用携带 `sessionId`/`runId` 关联；升级演练回归校验一致性 |
| 18 | 依赖安装风险 | dsh 为预览版，SDK 安装/构建可能失败 | 内网 registry + vendored 包 + `pnpm` 精确锁定；`dshEnabled=false` 默认不影响主服务 |
| 19 | 会话资源占用 | 每会话独立上下文，并发模块检测内存/配额 | preset 复用、并发上限、空闲回收 |
| 20 | 条款库与 skill 漂移 | 条款 `testingMethod` 更新后 skill 未重新生成 | `skillGenerator` 幂等 + CI 校验 skill 与条款库哈希一致 |
| 21 | 人工步骤卡死 | 用户未完成人工步骤，Agent 会话挂起占用资源 | 人工步骤超时策略（提醒/挂起归档）；会话生命周期管理 |
| 22 | 设备操作误触 | Agent 触发继电器电源/串口命令可能影响硬件 | 设备操作工具一律审批 + 只读命令默认放行、写操作强制确认 |
| 23 | 证据文件膨胀 | 抓包 pcap 单文件可能巨大，长期累积 | 上传大小限制（现有 `uploadMaxBytes`）、存储策略、pcap 裁剪指引 |
| 24 | **阶段边界混淆** | Agent 把准备工作（A/B）误判为合规判定，或判定阶段无证据硬出 verdict | 服务层+落库双重校验（非判定阶段不得写 verdict）；`pending_review` 无证据自动 `skipped` |
| 25 | 阶段间反向迭代失控 | 判定证据不足回退收集阶段后计划漂移，步骤无限增加 | 回退需用户确认 + 记录审计；限制单条款回退次数，超限人工介入 |
| 26 | 功能模块证据错配 | 抓包未正确标注功能模块，判定阶段分配条款错乱 | 阶段 B 存证时强制 `functionModule` 必填；判定阶段按模块检索证据 |

---

## 10. 验收与测试策略增补

在 `09-Testing-Strategy.md` 基础上增加 Agent 专项测试层：

1. **单元测试**：`AgentToolBridge` 的 `formFields`→dsh 工具 schema 映射正确性；`SkillGenerator` 生成 `SKILL.md` 内容完整性；`ReviewService` 状态机（pending→approved/rejected，拒绝附理由、pending 不计入定级）；`HumanStepService` 状态机（waiting→completed→continue）；**阶段边界校验**（非判定阶段写 verdict 被拒、判定阶段无 clauseId 被拒）。
2. **集成测试**：`dshClient` 拉起子进程 → `run()` 返回结构化结果 → 桥调用回落平台执行 → `clause_verdicts` 落库；双写一致性校验（模拟 dsh 大版本升级后旧 session 不可读、平台证据完好）；人工步骤完成事件正确放行 Agent 继续；**阶段 A/B 产物正确进入 artifacts/evidences（clauseId=null），阶段 C 分析后跨阶段引用证据生成判定**。
3. **E2E**：用户在 Agent 会话页选 5.3 模块 → Agent 生成四阶段计划 → 阶段 A 配网采集（指令卡片）→ 阶段 B 抓包上传 → 阶段 C 端口扫描 + 证据分析 → 判定草案 → 审核确认 → 报告页看到定级 + 阶段 A/B 过程记录附录 + 整改建议 `pending_review`。Playwright 断言用户可见元素。
4. **人工合规验收**：Agent 生成的判定草案与合规负责人人工结论比对，一致率作为一期放量门槛（建议 ≥ 80% 才允许扩大试点模块）。

---

## 11. 附录：关键资料

### 11.1 平台侧现有文档（本系列）
- `01-PRD.md`、`02-Architecture.md`、`03-Module-SDK.md`、`04-Clause-Mapping.md`、`05-Orchestration-DSL.md`、`06-Data-Model-and-API.md`、`07-Development-Plan-and-Milestones.md`、`08-Deployment-and-Ops-Guide.md`、`09-Testing-Strategy.md`、`10-SDK-Example-PortCheck.md`

### 11.2 dsh 调研输入（仓库外部）
- 调研原文：《DeepSeek Harness（dsh）平台集成可行性调研方案》（dsh-v0.1.0-rc.8）
- 仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 关键文档：`docs/architecture.md`、`docs/cordis-primer.md`、`docs/subsystems/tools.md`、`docs/subsystems/workflow.md`、`docs/cookbook/adding-a-tool.md`、`packages/sdk/README.md`

### 11.3 关键术语
- **阶段（Phase）**：A 准备 / B 收集 / C 判定 / D 审核；只有阶段 C 直接映射 EN18031 条款，A/B 产物作为判定输入。
- **测试工件（Artifact）**：阶段 A/B 产物（设备档案、网络拓扑、接入结果），clauseId 恒为 null，供判定阶段引用并进报告附录。
- **Preset**：每会话的 Agent 组合（`agent.cordis.yml`），一个法规模块一个目录，约束判定阶段条款范围 + 授权工具集。
- **Skill**：`SKILL.md` 形式的可复用知识（本项目=测试方法），模型按需加载。
- **人工步骤（human_instruction）**：Agent 暂停并引导用户在物理设备上操作，用户完成后继续的步骤类型。
- **判定草案**：Agent 分析证据生成的 `pending_review` 判定，须经用户审核后才生效。
- **workflow**：模型写的 JS 编排脚本；三期评估放开，产出仍回落平台落库。
- **output.schema**：dsh 工具的结构化输出校验，与平台 `ExecutionResult` 契约对应。
- **双写审计**：平台 `audit_logs`/`clause_verdicts`/`evidences`/`artifacts`（真源）＋ dsh session log（回放证据）。
