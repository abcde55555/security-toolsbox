# UX 大改蓝图：以项目工作台为中心的合规测试体验重构

> 范围：`packages/web` 前端体验整体重构。不动既有后端业务逻辑、不动 DB schema、保持全部现有 REST API 兼容（唯一例外：api-eng 正在并行新增的只读聚合端点 `GET /projects/:id/workbench`，见 §4.3 与 §8）。
> 关联文档：[10-ux-evolution.md](./10-ux-evolution.md)（本蓝图吸收其 P1/P2/P3，并向上扩展为全局信息架构重构）。
> 撰写：ux-overhaul/planner · 2025 · **R2**：按 captain 约束修订——①会话页近期新增交互列入防退化红线（§5.0）；②第一阶段收敛为 ui-eng+api-eng 两人 1–2 天量级，且「工作台一屏」直接建立在 `/projects/:id/workbench`（含 `nextSuggestion`）之上（§7）。

---

## 1. 现状诊断（基于源码走查）

| # | 痛点 | 证据（现状） |
| --- | --- | --- |
| D1 | **工作流割裂**：「项目」与「Agent 测试」是两套平行世界。项目详情页六 Tab 只覆盖编排执行；Agent 会话列表/详情完全独立成三页，靠 AssessmentStepper 里一个 `window.location.href='/agent'` 跳转缝合，跳走后丢失项目上下文 | `ProjectDetail.tsx` L63 / `AssessmentStepper.tsx` L63；`AgentSessionDetail.tsx` 顶栏只有「会话列表」返回，无所属项目入口 |
| D2 | **新手冷启动难**：空数据时各页只给一句 `Empty description`。「新建项目」需要先有标准→条款→模板→工具，但没有任何页面告诉新用户这个依赖顺序 | `Projects.tsx` L121「暂无项目」；`AgentNewSession.tsx` L167 仅在标准为空时提示「去创建标准」；`Settings/Clauses/Templates` 各自孤立 |
| D3 | **会话页信息过载、下一步行动不突出**：主区 PhaseTimeline 按阶段分组，真正的 AI 对话被压到底部折叠面板；人工待办藏在右上角按钮 + 右侧 Drawer；判定审核在右侧 Sider 第一个 Tab——四处分散，「我现在该做什么」没有单一答案 | `AgentSessionDetail.tsx` L124–238（三段布局）、L241–288（待办 Drawer）、L290–352（右侧 Sider）；wiki 10-ux-evolution 现状诊断表 |
| D4 | **判定/报告环节弱**：审核动作只在会话页右侧 Sider 内可用；跨会话的「本项目还有几条判定没审」在项目维度不可见（API 已有 `/api/agent/projects/:id/pending-verdicts` 但前端未消费）；报告生成后与判定的因果链弱，报告 Tab 空态只让用户「去执行流程点开始测试」 | `VerdictReviewPanel.tsx` 仅被 `AgentSessionDetail` 引用；`ProjectDetail.tsx` 六 Tab 中无审核 Tab；`ReportTab.tsx` L79–93 空态文案 |
| D5 | **全局导航平铺**：8 个一级菜单并列，资源类（工具库/知识库）与流程类（项目/Agent）权重相同；「执行记录」是孤立的命令运行流水，与项目无导航关联 | `App.tsx` L55–64 navItems |

**关键有利条件**：后端 API 面已完整支撑本次重构所需的全部数据聚合，无需任何后端改动——
`GET /api/agent/sessions?projectId=`（按项目过滤会话）、`GET /api/agent/human-todos`（跨会话人工待办）、
`GET /api/agent/projects/:projectId/pending-verdicts`(按项目汇聚待审判定)、`GET /api/projects/:id/preflight|executions|logs`、
`GET /api/projects/:id/reports/latest` 全部就绪。

---

## 2. 目标体验定义（五条原则）

1. **项目即主线（Project as Spine）**——平台的一切动作都归属某个项目的评估生命周期；任何页面都能回答「我在哪个项目的哪个阶段」，离开项目上下文的页面必须显式声明自己是「资源库」。
2. **系统永远回答「现在该干什么」（Next Best Action）**——每一级界面（工作台/项目/会话）有且只有一个由数据推导的主行动按钮；其余操作降级为次级入口。推导规则见 §4.3。
3. **对话即现场（One Event Stream）**——Agent 协作过程渲染为一条按时间交织的统一事件流（消息/思考/工具卡/人工卡/判定卡/报告卡），不折叠主叙事；输入框常驻底部。（即 wiki P1）
4. **证据链优先（Evidence-First Traceability）**——每个判定、每个报告数字都能下钻到原始证据；审核动作发生在证据旁边，而不是另一个面板里。
5. **渐进式披露（Progressive Disclosure）**——新手看到的是引导清单和下一步按钮；专家随时可以到达终端、原始日志、JSON 导入等高级能力，但默认界面保持安静。

---

## 3. 目标工作流：从零到出报告的完整旅程

角色：合规测试工程师。每行「系统主动说」= 该阶段界面上最突出的引导元素（Next Best Action 卡片或头部主按钮），全部可由现有 GET 数据在前端推导。

| 阶段 | 用户目标 | 系统主动说什么 | 入口与去向 | 消费的现有 API |
| --- | --- | --- | --- | --- |
| S0 冷启动 | 第一次打开平台 | 「完成 5 步即可跑第一次评估」清单：①建标准 ②导入条款 ③注册工具 ④建模板 ⑤创建项目；每步显示 ✓/缺省，点击直达对应页 | 工作台 Onboarding 清单卡 | standards/clauses/tools/templates 各 list |
| S1 备料 | 为设备建评估项目 | 项目卡上显示「未绑模板 / 变量缺 N 项 → 先去配置变量」，预检结果内联展示缺口 | 新建项目向导（选标准+模板+等级）→ 项目工作台·设置 Tab | projects CRUD, preflight, variables |
| S2 执行采集 | 跑编排拿到客观数据 | 运行中：进度条+ETA 常驻头部；结束：「X 步失败建议重试」「Y 条命令手册步骤未执行，逐条补采」；全部成功→「进入 Agent 深度测试」 | 工作台·执行采集 Tab（现 FlowTab/Terminal/执行记录归并） | runs start/cancel/retry, batchProgress 流, executions |
| S3 Agent 深度测试 | 人机协同采证+初判 | 「继续未完成会话（等待你执行 2 个人工步骤）」；无会话时「发起会话（已带入设备档案与授权工具）」 | 项目工作台·Agent 会话 Tab → 会话详情（统一事件流） | agent sessions?projectId=, human-todos, create(prefill) |
| S4 判定审核 | 人审每条判定草案 | 会话流内判定卡直接给 通过/拒绝(必填理由)/退回补采 三键；项目工作台显示「N 条待审」徽标，一键进入审核视图 | 项目工作台·判定审核 Tab + 会话流内联卡 | pending-verdicts, verdicts approve/reject, clauses/:clauseId/retry |
| S5 报告交付 | 出具 Excel/HTML 报告 | 判定清零后自动提示「报告可生成/需刷新」；生成后摘要卡（评级+通过率+失败 Top）回贴到事件流尾部与工作台总览；一键导出 | 项目工作台·报告 Tab | reports latest/generate/html/export/download |

**闭环规则**：S4 拒绝→回到 S3 补采；报告重新生成后旧链接仍可达（reports 按 id 寻址）。整个旅程中用户不需要记住「接下来去哪个菜单」。

---

## 4. 新信息架构与导航结构

### 4.1 导航：从 8 项平铺 → 侧边栏分组

顶部深色横排菜单改为**可折叠左侧边栏**（8+ 项后横排溢出，侧边栏可扩展且能挂二级说明）。Header 只留：Logo、全局搜索（远期）、通知铃铛、用户。

```
┌ Sidebar ──────────────┐
│ ◆ EN18031 合规测试平台 │
│                       │
│ 🏠 工作台              │   ← 新增，默认首页
│ 📁 项目                │   ← 流程主线
│ 💬 Agent 会话          │   ← 跨项目会话列表（支持 ?projectId= 过滤）
│ ─────────────────     │
│ 资源库                 │   ← 分组标题（非路由）
│   ├ 工具库             │
│   ├ 合规测试项         │
│   ├ 模板              │
│   └ 知识库            │
│ ─────────────────     │
│ ⚙ 设置                │
└───────────────────────┘
```

### 4.2 页面拓扑

```
工作台 /
 ├─ 下一步行动队列（全局优先级：运行中 > 人工待办 > 待审判定 > 可出报告 > 冷启动清单）
 ├─ 项目卡片墙（每卡带迷你 Stepper + 主行动按钮）
 └─ 动态摘要（通知 + 最近审计尾部）

项目空间 /projects → /projects/:id（工作台壳，Tab 化）
 ├─ 总览        ← 新增聚合视图
 ├─ 执行采集    ← 现 FlowTab + Terminal + 工具执行记录 归并
 ├─ Agent 会话  ← 新增：本项目会话列表 + 发起会话（预填充向导）
 ├─ 判定审核    ← 新增：跨会话 pending-verdicts 审核视图
 ├─ 报告        ← 现 ReportTab 增强
 └─ 设置        ← 现 变量 + 审计日志 归并

Agent 会话 /sessions → /sessions/new → /sessions/:id
   （详情页 = 统一事件流重写，见 §5.5）

资源库 /library/{tools|clauses|templates|knowledge}（内容暂不动，换路由与分组）
设置 /settings（不动）
```

### 4.3 Next Best Action：服务端建议为主，前端规则为回退（`useNextAction` hook）

**主数据源 = `GET /projects/:id/workbench`（api-eng 并行交付中的只读聚合端点）**。该端点一次返回项目工作台一屏所需的全量聚合数据，其中 `nextSuggestion` 字段即「下一步行动」（含动作类型、文案、目标路由/Tab、计数等）。前端 `useNextAction(projectId)` 只负责：拉取 workbench → 规范化 `nextSuggestion` → 映射到 UI 主按钮与跳转；轮询/失效策略与现有页面一致。

**前端推导规则表作为回退与契约定义**（workbench 未就绪、字段缺失或过渡期时生效；亦即 api-eng 实现 `nextSuggestion` 时的对齐基准）。对单个 project，按下表取第一个命中的规则：

| 优先级 | 条件（全部来自现有接口） | 行动文案 | 动作 |
| --- | --- | --- | --- |
| 1 | 存在非终态 run | 「运行中 · {percent}%」+ 取消 | 跳执行采集 Tab |
| 2 | human-todos 含本项目步骤 | 「{n} 个人工步骤等你处理」 | 跳对应会话并高亮卡片（复用现有 scrollIntoView+animate） |
| 3 | pending-verdicts > 0 | 「{n} 条判定待你审核」 | 跳判定审核视图 |
| 4 | run 终态且 report 过期/缺失 | 「生成合规报告」 | POST reports |
| 5 | report 存在且有未导出标记 | 「导出 Excel 报告」 | reports export/download |
| 6 | preflight 有缺口 | 「修复预检问题（{n}）」 | 打开 PreflightModal / 变量 |
| 7 | 无 run 且有模板 | 「开始测试」 | PreflightModal → startRun |
| 8 | 兜底 | 「发起 Agent 会话 / 配置变量」 | 对应入口 |

全局工作台 Home 的跨项目队列在 workbench 提供 list 级变体之前，可按项目并发调用单项目端点求值各自 top1 再排序；若量级不可接受则该能力顺延至 Phase 4 之后（见 §7）。

### 4.4 路由变更表

| 旧路由 | 新路由 | 迁移策略 |
| --- | --- | --- |
| `/` (→/projects) | `/` = 工作台 Home | 立即生效；`/projects` 仍在侧边栏第二项 |
| `/tools` | `/library/tools` | `<Navigate replace>` 重定向保留 ≥2 个版本 |
| `/clauses` | `/library/clauses` | 同上 |
| `/templates` | `/library/templates` | 同上 |
| `/knowledge` | `/library/knowledge` | 同上 |
| `/projects` | `/projects`（不变） | — |
| `/projects/:id` | `/projects/:id`（内容重构为工作台壳） | URL 不变，零迁移成本；Tab 用 query/hash 定位（`?tab=review`） |
| `/agent` | `/sessions` | 重定向 + 更新 4 处内部跳转（App.tsx 待办 Popover、AssessmentStepper、AgentNewSession/Detail 返回钮） |
| `/agent/new` | `/sessions/new`（新增 `?projectId=` 预填） | 重定向；旧查询参数透传 |
| `/agent/:sessionId` | `/sessions/:sessionId` | 重定向；`?mock=1` 行为保留 |
| `/runs` | 并入 `/projects/:id` 执行采集 Tab + 工作台动态摘要 | 过渡期 `/runs` 保留为独立只读页并从导航隐藏，Phase 4 删除路由改重定向 |
| `/settings` | `/settings`（不变） | — |

站内受影响的硬编码跳转全量清单（grep 已核实，共 13 处）：`navigate('/agent')` ×3、`navigate('/agent/new')`、`navigate(\`/agent/${…}\`)` ×2、`window.location.assign('/agent/${…}')` ×1、其余为 `/projects*` 与 `/clauses`（后者仅 AgentNewSession 空态一处）。均在 Phase 0 一次性替换。

---

## 5. 页面/区域线框级文字描述

### 5.0 防退化红线：会话详情页近期新增能力必须原语义保留

以下三项是会话详情页最近迭代的成果，任何重构（尤其 Phase 2 统一事件流改造）**不得使其交互语义退化**。实现均位于可复用的 hook/组件层，新布局应原样搬用而非重写：

| 能力 | 现状实现（源码位置） | 必须保留的语义 | 新设计中的归宿 |
| --- | --- | --- | --- |
| ① 人工待办抽屉 + 卡片闭环状态 | `AgentSessionDetail.tsx` L241–288 待办 Drawer；`HumanStepCard.tsx` L116–211 卡片状态机 | 未完成卡琥珀色脉冲 + 标题闪烁提醒；提交后转绿并按会话状态显示差异化横幅——running=「Agent 已收到，继续执行中」/ planning=「已提交，正在恢复执行」/ 其他=「已提交，结果已保存」（L67、L143）；已提交的成果说明、证据附件、提交时间在卡上可见（L184–197） | EventStream 中人工卡内嵌同一 `HumanStepCard`；右栏待办清单与流内卡片双向定位（点击→scrollIntoView+脉冲高亮），闭环横幅文案逐字保留 |
| ② 假等待自愈提示 | `useAgentSession.ts` L610–636 completeHumanStep 错误分支；L599–608 3s 状态轮询兜底；`HumanStepCard.tsx` L192「已提交：执行链正在自动恢复，稍候将继续」 | 提交人工步骤遇「已结束/不在等待状态」（他人已完成/超时/服务重启等状态漂移）时**静默全量重拉状态而非弹错**，用户无感自愈；planning 态给出"自动恢复中"预期管理文案 | 自愈逻辑整体留在 `useAgentSession`，重构只动渲染层；EventStream 与右栏共用同一 hook 实例，禁止旁路直调 API 造成状态分叉 |
| ③ 流式推理显示 | `AgentSessionDetail.tsx` L149–181「正在生成…」块：💭 reasoning 斜体灰字 + text 正文实时追加 | 生成期间推理与正文增量可见（maxHeight 滚动），生成完成后归位为正式消息卡 | EventStream 流尾就地渲染 streaming 气泡（reasoning 默认灰字小号、可展开），数据仍来自 socket streaming 缓冲，不另起轮询 |

**验收口径**：Phase 2 合并前按上表逐项回归——待办提交→闭环横幅三态正确、制造状态漂移后无错误弹窗且界面自动对齐、生成期推理可见。

### 5.1 全局 Shell（AppShell.tsx）

- 左侧 Sider 240px 可折叠至 64px（图标模式），深色主题延续现 Header 配色（#0f172a）。
- 分组菜单如 §4.1；「Agent 会话」项保留现有红色徽标（human-todos 15s 轮询逻辑原样搬入 AppShell）。
- Header 48px：面包屑（项目名/会话名）+ 通知铃铛（NotificationBell 组件原样复用）+ 用户。
- Content 保持 `height:100%; overflow:hidden` 的满高布局约定。

### 5.2 工作台 Home（新增页）

```
┌ 下一步行动队列（横向卡片条，最多 5 张，按 §4.3 排序）──────────┐
│ [🔴 2 个人工步骤待办 · 项目A →去处理] [🟡 5 条判定待审 · 项目B] … │
├──────────────────────────────────────────────────────────────┤
│ 我的项目（卡片栅格，替代现在的表格默认视图；表格模式保留切换）      │
│ ┌项目A────────┐ ┌项目B────────┐ ┌＋新建项目┐                  │
│ │状态Tag 模板名 │ │              │ │          │                  │
│ │mini-Stepper │ │              │ │          │                  │
│ │[主行动按钮]  │ │              │ │          │                  │
│ └────────────┘ └─────────────┘ └──────────┘                  │
├──────────────────────────────────────────────────────────────┤
│ 动态摘要：最近审计日志 tail + 未读通知合并流（点击穿透）           │
└──────────────────────────────────────────────────────────────┘
空态（无项目）：OnboardingChecklist 替代卡片墙 —— 五步清单，
每步「已完成✓/未开始」+ 直达按钮；全部完成后该组件不再渲染。
```

### 5.3 项目工作台 `/projects/:id`

- **头部区**（吸顶）：返回 + 项目名 + 状态/等级/模板 Tag；右侧 = **上下文主按钮**（即 §4.3 top1 行动）+ 取消/刷新等次按钮；运行中时头部下方常驻进度条+ETA（沿用现实现）。
- **Stepper 行**：AssessmentStepper 增强——五步各自显示量化进度（变量 n/N、步骤通过 x/y、会话 n 个、待审 m 条、报告版本 v），点击步进直接切到对应 Tab（不再 `window.location.href` 整页跳转）。
- **Tab 区**：
  - `总览`（新，**即「工作台一屏」，直接消费 `GET /projects/:id/workbench`**）：NextAction 卡（渲染 `nextSuggestion`，回退规则见 §4.3）+ KPI 条（适用条款/通过/失败/未覆盖/证据数/待审数）+ 「最近事件」纵向摘要（run 日志 tail 与最新 agent 会话事件按时间混合，各取前 N 条，点击展开到源 Tab）+ 本项目待办清单（含命令手册步骤补采提醒 Alert，复用现有两条 Alert 的数据逻辑）。
  - `执行采集`：FlowTab 为主（不动其内部），Terminal 改为其右侧可收起面板而非平级 Tab；`工具执行记录`（ProjectExecutions）以子 Tab 收纳。
  - `Agent 会话`（新）：本项目会话表格（复用 AgentSessions 的列定义，加 projectId 过滤）+「发起新会话」按钮 → 抽屉内嵌四步向导（标准/等级/设备档案从项目变量预填，可跳步）。
  - `判定审核`（新）：调 `pending-verdicts`，按条款分组的审核列表（复用 VerdictReviewPanel 的卡片与三动作），每张卡附证据缩略与「查看来源会话」链接；顶部显示「全部审完即可生成报告」进度。
  - `报告`：现 ReportTab + 空态改为「当前有 n 条未审判定，审完再生成」的条件化引导。
  - `设置`：VariablesTab + AuditTab 两个子 Tab。

### 5.4 Agent 会话列表 `/sessions`

- 顶部过滤器：项目下拉（`?projectId=`，与项目工作台互链）、状态、阶段。
- 表格列基本沿用现实现，增加「人工待办 n」列（human-todos 聚合）与行内主行动（继续/查看报告）。

### 5.5 Agent 会话详情 `/sessions/:sessionId`（改动最大的一页）

采用 wiki P1 目标形态并扩展：

```
┌ 头部：会话名·设备·阶段 chips·所属项目链接 │ 启动/中止 ────────────┐
├───────────────────────────────┬──────────────────────────┤
│ 统一事件流（单列滚动，按 seq 时序）│ 右栏（可收起，380px）       │
│  💬 用户消息                    │  ① 待办清单（默认置顶，      │
│  💭 思考（灰色小字，默认收起）     │    点击→滚动定位+脉冲高亮）  │
│  🤖 AI 回复（markdown 渲染）     │  ② 证据库 ArtifactPanel     │
│  🔧 工具调用卡（标题+耗时，展开看   │  ③ 会话信息（条款/设备/       │
│     stdout 摘要/完整输出抽屉）    │     授权工具，原样搬移）      │
│  🙋 人工步骤卡（内嵌完成表单：成果    │                          │
│     说明+粘贴传图，完成后变绿）    │                          │
│  ⚖ 判定草案卡（PASS/FAIL+严重度    │                          │
│     +证据链；内嵌 通过/拒绝/退回补采）│                          │
│  📄 报告摘要卡（会话尾部，评级+      │                          │
│     通过率+导出按钮）             │                          │
├───────────────────────────────┴──────────────────────────┤
│ [粘性待办条：等待你完成「检查调试口」▸] （仅 waiting_human 时出现）│
│ [输入框……………………………………………………………] [发送]                     │
└──────────────────────────────────────────────────────────┘
```

- 数据面完全复用 `useAgentSession`（events/steps/toolCalls/humanSteps/verdicts 已齐备，`buildTimeline` 已提供平铺排序）。
- 现 `AiTranscriptCollapse` 底部面板删除，其统计并入右栏①/头部 chips；流式输出气泡就地插入流尾（现 streaming 展示条逻辑迁入 EventStream）。
- 判定卡动作直连 `approve/reject/retryClause`（wiki P3 落地）；报告卡消费 `ReportsApi.latest(projectId)`。

### 5.6 新建会话向导 `/sessions/new`

- 四步结构不变；新增两种快捷模式：`?projectId=x` 时第 1 步锁定项目关联标准、第 3 步设备档案预填项目变量（可改）、完成后回跳该项目工作台 Agent Tab。
- 步骤内引导文案升级为「为什么需要这一步」式微文案（现 Alert 文案已较好，保留骨架）。

### 5.7 资源库四页

Phase 0–1 仅换路由与侧边栏分组，页面内部不动。Phase 2 起逐步加「使用上下文」出口：模板卡→「基于此模板创建项目」（已有 `?newFrom=`）；工具卡→「试运行」（已有 RunCommandModal）；知识库不动。

---

## 6. 改动清单（文件级）

### 6.1 新建

| 文件 | 说明 |
| --- | --- |
| `packages/web/src/layout/AppShell.tsx` | 侧边栏布局 + 分组菜单 + 待办徽标（从 App.tsx 抽出） |
| `packages/web/src/pages/Home.tsx` | 工作台页（§5.2） |
| `packages/web/src/components/home/NextActionCard.tsx` | 单条行动卡 |
| `packages/web/src/components/home/ProjectCard.tsx` | 项目卡 + mini-Stepper |
| `packages/web/src/components/home/OnboardingChecklist.tsx` | 冷启动五步清单 |
| `packages/web/src/hooks/useNextAction.ts` | §4.3 推导：主路径消费 `workbench.nextSuggestion`，回退走客户端规则（纯函数便于单测） |
| `packages/web/src/components/project/OverviewTab.tsx` | 项目总览聚合视图 |
| `packages/web/src/components/project/ReviewTab.tsx` | 跨会话判定审核视图 |
| `packages/web/src/components/project/SessionsTab.tsx` | 本项目会话列表 + 向导抽屉 |
| `packages/web/src/components/agent/EventStream.tsx` | P1 统一事件流渲染器 |
| `packages/web/src/components/agent/VerdictDraftCard.tsx` | 流内判定卡（内嵌审核三动作） |
| `packages/web/src/components/agent/ReportSummaryCard.tsx` | 流尾报告摘要卡 |

### 6.2 重构（保留文件，改造内部）

| 文件 | 改动 |
| --- | --- |
| `App.tsx` | 换 AppShell + 新路由表 + 全部旧路由 `<Navigate>` 重定向；删除内联 navItems/useHumanTodos（迁入 AppShell） |
| `pages/ProjectDetail.tsx` | Tab 结构重组为 总览/采集/会话/审核/报告/设置；头部主按钮接 useNextAction；拆薄（各 Tab 已是独立组件，主要做装配） |
| `components/AssessmentStepper.tsx` | 加量化描述与 Tab 内跳转回调；去掉 `window.location.href='/agent'` |
| `pages/AgentSessionDetail.tsx` | 主区换 EventStream；删 AiTranscriptCollapse 底板；右栏改 待办/证据/信息 三组；加粘性待办条 |
| `pages/AgentSessions.tsx` | 支持 `?projectId=` 过滤与待办列 |
| `pages/AgentNewSession.tsx` | 支持 `?projectId=` 预填 + 抽屉形态（`embedded` prop），逻辑抽出为可复用组件 `components/agent/NewSessionWizard.tsx` |
| `components/project/ReportTab.tsx` | 空态条件化引导（待审数）+ 生成后摘要回贴回调 |
| `api/endpoints.ts` | **仅追加** `WorkbenchApi.get(projectId)`（消费新聚合端点）与相关响应类型；既有封装零改动 |
| `main.tsx` | 默认路由指向 `/`（工作台）——实际只是确认 redirect 链 |

### 6.3 删除 / 吸收

| 目标 | 时机 |
| --- | --- |
| `App.tsx` 顶部横排 Menu 实现 | Phase 0 被 AppShell 取代 |
| `pages/CommandRuns.tsx` + `/runs` 路由 | Phase 4：CommandRunList 移入项目执行采集子 Tab 与工作台动态摘要，路由改重定向 |
| `components/AiTranscriptCollapse.tsx` | Phase 2 被 EventStream 取代后删除 |
| `components/agent/PhaseTimeline.tsx` | Phase 2 后保留一版作为「阶段分组」备用视图，Phase 4 删除 |

### 6.4 明确不动

`packages/server/**`（routes/services/engine/agent 子系统/db；**唯一例外：api-eng 正在并行新增的只读聚合端点 `GET /projects/:id/workbench`，属加法而非改动**）、`packages/shared/src` 类型（仅消费）、`api/client.ts`、`api/socket.ts`、`hooks/useRunStream|useCommandRunStream|useCategories|useNotifications|useMockAgentSession`、`Settings.tsx`、`Knowledge.tsx`、`ToolLibrary.tsx`、`Clauses.tsx`、`Templates.tsx` 页面主体。

---

## 7. 分阶段实施顺序

> 原则：每阶段独立可发布、独立可回滚、增量叠加在现有代码上；**第一阶段收敛为 ui-eng + api-eng 两人 1–2 天的量级——宁可小步快跑**。全局导航与路由迁移属"地基"但价值密度低，后移至 Phase 3，不阻塞体验交付。

### Phase 1 工作台一屏（第一阶段 · ui-eng + api-eng 两人 1–2 天）

分工：
- **api-eng**：完成 `GET /projects/:id/workbench` 只读聚合端点（已在并行开发中）。响应含项目状态概览、KPI 计数、待办/待审数量、最近事件摘要与 **`nextSuggestion`**（动作类型/文案/目标 Tab）。字段口径以 §4.3 回退规则表为对齐基准；纯读聚合，不改任何既有服务行为。
- **ui-eng**：ProjectDetail 新增 `OverviewTab`（§5.3 总览线框）消费该端点——NextAction 主行动卡 + KPI 条 + 最近事件摘要 + 本项目待办清单；`useNextAction` hook（服务端建议为主、客户端规则回退）；AssessmentStepper 接 `nextSuggestion` 高亮当前步、点击改 Tab 内跳转。

明确不做：不动全局导航、不动路由、不动其余五个 Tab、不动会话页。

**验收**：打开任一项目首屏即见「现在最该做什么」且一键到达；workbench 端点失败/超时时静默回退客户端规则，页面不白屏；现有六 Tab 功能零回归。

### Phase 2 会话页统一事件流（= wiki P1/P2，1–2 天）

EventStream 渲染器替换 PhaseTimeline 主区；聊天式输入框常驻底部；待办升级为右栏置顶清单（点击定位+脉冲高亮）；`/sessions` 支持项目过滤。
**验收**：刷新会话页后事件顺序与实时一致（复用 applyEvent 回放保证）；人工步骤可在流内完成并上传证据；**§5.0 三条防退化红线逐项回归通过**（闭环横幅三态 / 假等待自愈无弹窗 / 流式推理可见）；无底部折叠面板。

### Phase 3 全局导航与路由地基（~0.5–1 天，低风险）

抽 AppShell（侧边栏分组导航），建立 `/library/*`、`/sessions/*` 别名路由 + 旧路由重定向，替换 13 处硬编码跳转。
**验收**：所有旧 URL 可达正确页面；导航出现分组；无功能回归（冒烟：建项目→运行→会话→报告全链路走通）。

### Phase 4 全局工作台 Home 与冷启动引导（2–3 天）

Home 页（§5.2）：跨项目行动队列（并发调用单项目 workbench 求值 top1 排序）、项目卡片墙、OnboardingChecklist 冷启动清单、动态摘要；ReportTab 空态条件化。
**验收**：任意时刻打开平台首屏 ≤3 秒内给出全局「现在最该做什么」；空库用户按清单五步完成首次配置。

### Phase 5 项目工作台聚合补全 + 判定闭环内嵌（= wiki P3 延伸，3–4 天）

SessionsTab（本项目会话列表+向导抽屉预填）/ ReviewTab（消费 pending-verdicts）/ 设置归并装配完毕；流内判定卡三动作（通过/拒绝/退回补采）；报告摘要卡回贴事件流尾部与总览。
**验收**：不离开 `/projects/:id` 即可完成 S2–S5 全旅程；拒绝判定→补采→重判→报告刷新在单一滚动流内闭环；跨会话待审数与各会话页一致；旧六 Tab 能力无一丢失。

### Phase 6 清理（0.5–1 天）

`/runs` 吸收进项目执行采集子 Tab；删 AiTranscriptCollapse / PhaseTimeline / CommandRuns 页与冗余重定向。
**验收**：删除项无引用残留（tsc 通过）；重定向表复核。

总计约 9–12 个工程日。痛点对应：Phase 1 起即缓解 D3 的入口层与 D4 的可见性 → Phase 2 解决 D3 → Phase 3 解决 D5 → Phase 4 解决 D2 → Phase 5 根治 D1/D4。

---

## 8. 非目标（明确不做）

1. **不动既有后端业务逻辑**：不改 `packages/server` 的 routes/services/engine/agent 既有行为，不改任何既有请求/响应契约。唯一例外：api-eng 并行新增的**只读聚合端点** `GET /projects/:id/workbench`（含 `nextSuggestion`）——它是加法不是改动，不触碰任何写路径与业务规则，且其字段口径对齐 §4.3 前端回退规则表。除此之外若还需服务端聚合，另立提案。
2. **不动 DB schema**：无迁移、无新表、无字段变更。
3. **保持现有 API 兼容**：不废弃任何现有 REST 端点；`/api/agent/*`、`/api/projects/*` 等路径与语义原样。
4. **不更换技术栈/架构**：继续 React18 + antd5 + react-router6 + hooks/useReducer 模式，不引入 Redux/Zustand/React Query，不改 Vite 配置。
5. **不做权限体系改造**：沿用 `requireRole` 现状；UI 不做角色差异化裁剪。
6. **不做移动端适配**：维持桌面 ≥1280px 主场景。
7. **不一推翻重写**：旧页面在新 IA 下以重定向过渡 ≥2 个版本；任何阶段不要求一次性替换全部页面。
8. **不改报告数据口径**：Excel/HTML 报告的字段、评级算法、导出格式保持原样（只动呈现与引导）。
