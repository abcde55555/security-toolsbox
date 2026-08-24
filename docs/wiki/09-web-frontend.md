# 09 · Web 前端（@en18031/web）

> 位置：`packages/web` · React 18.3 + antd 5.20 + react-router-dom 6.26 + socket.io-client 4.7 + Vite 5.4
> 无全局状态库（无 Redux/Zustand），状态靠 hooks + useReducer + 模块级缓存；所有类型复用 `@en18031/shared`。

## 1. 工程结构与启动

```
src/
├── main.tsx          # StrictMode → ConfigProvider(zhCN, 主色#2563eb) → antd App → BrowserRouter → ErrorBoundary → App
├── App.tsx           # Layout(Header+Content) + 路由表；Header 深色导航 7 项
├── api/              # client.ts(fetch 封装) / endpoints.ts(接口清单) / socket.ts(实时订阅)
├── hooks/            # useRunStream / useCommandRunStream / useCategories / useAgentSession / useMockAgentSession
├── pages/            # 10 个页面
├── components/       # Terminal/DynamicForm 等 14 个根组件 + project/(9) + agent/(11)
└── utils/ui.ts       # 状态↔颜色/中文映射字典、格式化函数
```

Vite：端口 **5173**，`/api` 与 `/socket.io`(ws) 代理到 `127.0.0.1:3000`；alias `@→src`（备而未用）。构建 `tsc -b && vite build` → `dist/`。

## 2. API 层

- **client.ts**：`request<T>()` 原生 fetch，BASE='/api' 相对路径；校验 `res.ok && code===0` 后剥壳返回 `data`；`requestPaged<T>` 返回 `{items,total}`；便捷对象 `api.get/post/put/del`；`reportError(e)` 统一弹 antd message。无鉴权头、无超时、无重试。
- **endpoints.ts**：按域组织的接口清单（Standards/Categories/Tools/Templates/Projects/Clauses/CommandRuns/Upload/AuditLogs/Agent/Reports/Settings 共 12 组，与 [07-API 参考](./07-api-reference.md) 一一对应）。特殊者：
  - `ToolsApi.testCommandStream()`：fetch ReadableStream 逐行解析 NDJSON（start/stdout/stderr/done/error），支持 AbortSignal —— 命令编辑器的实时测试终端；
  - `UploadApi.upload()`：XMLHttpRequest FormData 上传，上报进度百分比；
  - Agent 组含少量后端尚未实现的预留端点（resume/advance/rollback/review/retryClause 等，见 §7）。
- **socket.ts**：两条订阅通道均为「每次订阅新建一条 socket 连接」模式（非全局单例）：
  - `subscribeRun(runId, handlers)` / `useRunStream`：connect 后 emit `subscribe {runId}` 入房间，监听 `run:logLine/run:progress/run:status/run:batchProgress` 四事件；
  - `subscribeAgentSession(sessionId, handlers)`：监听 17 个 `agent:*` 事件并分发到 onXxx 回调 + `onRaw` 透传。

## 3. Hooks

| Hook | 说明 |
| --- | --- |
| `useRunStream(runId, handlers)` | re-export 自 api/socket；handlers 放 ref，更新不触发重订阅 |
| `useCommandRunStream({pollIntervalMs=1500, bufferCap=3000})` | 命令运行「流式+轮询对账」共享 Hook：socket 行入 `useLogBuffer`；1.5s 轮询 get(runId)；终态且未对账 → 用 detail.stdout/stderr 全量重刷 buffer 防丢行；快命令场景用轮询输出打底 seed。返回 `{setRunId, detail, buffer, running, finished, start, stop…}` |
| `useCategories()` | 模块级缓存 + 发布订阅的轻量全局状态；内置 7 分类 FALLBACK；返回 `{categories, loading, labelOf(key), refresh}`；另有模块级 `categoryLabelOf` 可在 React 外调用 |
| `useAgentSession(sessionId)` | **Agent 会话核心状态机**：useReducer 容器（session/events/steps/toolCalls/humanSteps/artifacts/evidences/verdicts/phases/messages/lastSeq）；初始加载并行拉详情+全量事件+工件+判定并对历史事件走 applyEvent 回放（与实时事件共用同一组 reducer 函数，保证刷新后状态一致）；实时订阅经 **Proxy 转发最新 handler** 免重订阅；5s 事件回补（sinceSeq 增量）+3s 会话状态兜底轮询；动作封装 completeHumanStep/sendMessage(乐观插入)/reviewVerdict/retryClause/start/abort；导出 `buildTimeline(state)` 平铺排序时间线 |
| `useMockAgentSession(seed)` | 演示驱动：setTimeout 脚本注入假事件流（人工步骤/nmap 输出/判定草案），与真实 hook 返回同形，`?mock=1` 时无感切换 |
| `useNotifications(onNew?)` | **全局通知流**（P1）：独占一条 socket 监听平台级 `notification:new` 广播 + 初始全量拉取 + 30s 未读数轮询兜底；返回 `{items, unread, refresh, markRead, dismiss, snooze, acceptSkill}`；acceptSkill 调 accept-skill 端点把 AI 沉淀建议落地为 draft 技能 |

> `subscribeRun` 的 RunStreamEvents 新增 `onNarrative`（`report:narrative` 事件透传），供报告页实时接收 AI 叙述。

## 4. 路由表与页面

| 路径 | 页面 | 功能要点 |
| --- | --- | --- |
| `/` | Navigate → /projects | 默认重定向 |
| `/tools` | ToolLibrary | 分类侧栏(useCategories)+工具卡片墙(健康色 Badge/类型 Tag/引用数)；详情 Drawer(命令卡/条款卡/参数卡/健康检查)；注册/编辑工具(ToolEditorDrawer)、分类管理(CategoryManager)、单命令运行(RunCommandModal) |
| `/clauses` | Clauses | 标准 CRUD(左侧卡列表) + 条款树表格 CRUD(parentId 缩进选择/子项新建/删除防环) + JSON 批量导入(失败逐条明细) + MappingRulesModal(映射规则管理 + **前端即时规则测试器**) + 判定改判入口 |
| `/templates` | Templates | 模板列表/详情(Steps 渲染编排流程/upgradePending 红框升级确认)；新建下拉分「自由编排模板」(Modal+StepParamBinder) 与「合规测试模板(条款驱动)」(ComplianceTemplateEditor)；覆盖度(TemplateCoverage)、克隆、删除；「基于此模板创建项目」跳 `?newFrom=` |
| `/projects` | Projects | 项目列表附 latestRun；任一活跃运行时 5s 自动刷新；新建 Modal；行点击进详情 |
| `/projects/:id` | ProjectDetail | 最复杂页面：预检(PreflightModal)→开始/取消编排；单独执行工具(Cascader+RunCommandModal)；useRunStream 实时日志(2000 条环形缓冲) + running 时 2.5s 步骤轮询；六 Tab = 执行流程 FlowTab / 变量 VariablesTab / 终端 TerminalTab / 工具执行记录 ProjectExecutions / 审计日志 AuditTab / 合规报告 ReportTab；步骤详情 StepDetailDrawer(含人工覆盖判定)；终态联动刷新报告与审计 |
| `/agent` | AgentSessions | 会话列表（状态/阶段/设备/回退次数） |
| `/agent/new` | AgentNewSession | 四步向导：选标准 → 条款树勾选(叶子批量) → 设备档案 → 授权工具白名单 → 创建并跳转 |
| `/agent/:sessionId` | AgentSessionDetail | 三段布局：PhaseHeader(四阶段 Steps+连接状态) / PhaseTimeline(分相时间线) / AI 对话输入；右侧 Sider Tabs = 判定审核 VerdictReviewPanel(通过/拒绝必填理由/补采退回 B 阶段)、工件证据 ArtifactPanel、会话信息；顶栏条件按钮 启动/中止；`?mock=1` 走演示数据 |
| `/settings` | Settings | AI Provider 配置：列表(星标激活/协议 Tag/hasKey 不回显明文)+ 表单(protocol openai\|anthropic/baseUrl/apiKey 编辑留空不改/双模型/超时/重试) + 六个 PRESETS(deepseek/openai/anthropic/moonshot/ollama/vllm) + 连通性测试(显示 latencyMs/model/sample) |
| `/knowledge` | Knowledge | **知识沉淀中心**（P1）双 Tab：①经验笔记——关键词检索表格 + 新建/编辑 Modal(title/content/tags/sourceType/url) + 「编译为技能」（调 compile，成功弹窗展示草稿与 warnings）；②技能库——key/title/version/状态 Tag(draft 橙/approved 绿/archived 灰)/whenToUse 表格 + 正文 Drawer + 批准/归档/版本史 Modal。批准后 Agent 规划时自动注入（见 08 §8） |

> Header 右侧新增 **通知铃铛**（App.tsx 内 NotificationBell 组件）：Badge 未读数 + Popover 列表；
> skill_sediment 类通知给「采纳为技能」主按钮、template_save 给「查看项目」、其余已读/忽略；打开面板即 refresh。
> ReportTab 新增 **AI 叙述报告** 区（NarrativeSection）：优先消费 run 房间 `report:narrative` 实时事件，
> 触发后 3s 轮询 latest 兜底（15 次），已落库 narrative 直接展示；可手动生成/再生成。
| `/runs` | CommandRuns | 全局命令执行记录（薄壳渲染 CommandRunList，非终态行 4s 自动刷新） |

## 5. 核心组件

### 5.1 根组件精选

| 组件 | 要点 |
| --- | --- |
| `Terminal` | 数据单元 `TerminalLine{text,kind,stream}`；配套 `useLogBuffer(cap=2000)`（append 按 \r?\n 分行/超限丢旧置 truncated/setLines 全量替换）；**智能吸底**：用户距底 <32px 才自动滚动；stderr 行红、kind 分色 log-in/err/ok/warn；工具栏复制输出 |
| `DynamicForm` | 依据 shared 的 `FormField[]`（非 JSON Schema）渲染 8 种控件；file 类型经 UploadApi.upload 先传后引（值=服务端路径）；errors 受控展示 |
| `RunCommandModal` | 两阶段：配置(DynamicForm+renderCommandTemplate 实时预览+missing/unused Tag+outputTips) → 运行(Tag+Terminal+对账策略)；终态后可「保存为项目证据」attach 到项目/条款 |
| `CommandEditor` | 占位符驱动参数生成（extractPlaceholders 自动建行）；blockers 校验(占位符↔参数一致/rawParams 合法)；实时预览；NDJSON 流式测试终端（$ 前缀/▋光标动画/matchedRules 结果 Tag） |
| `ToolEditorDrawer` | 工具注册/编辑（builtin 只读禁用）；环境变量键值行；内嵌 CommandEditor 管理 commands；乐观锁 revision 提交 |
| `StepParamBinder` | **模板参数绑定器**：每字段 Segmented 二选一「绑定项目变量(`{{project.x}}`) / 固定值」；可现场新建变量(inferType ip/cidr/text) —— 保证模板不含真实目标值 |
| `VerdictRuleEditor` | 步骤级判定规则三形态：module(选模组声明条款 mapClauseId) / command(通过当+失败当条件+severity) / none |
| `ComplianceTemplateEditor` | 条款驱动合规模板编辑器：左栏叶子条款树勾选，右栏每条款卡(AggregationEditor: cross_check 四策略/chain 链式) + 条款下步骤(工具/参数绑定/判定规则/上下移)；产出 ComplianceSavePayload(clauseBindings/steps 带 clauseId+verdictRule/groupKey/toolRefs follow) |
| `TemplateCoverage` | 圆形进度覆盖率(≥80 绿/≥50 橙/否则红) + 已覆盖(via module/rule)与未覆盖条款表 |
| `PreflightModal` | 变量缺失红色 Alert + 工具可用性清单(不可用标「将跳过」)；主按钮文案随 unavailable 数变化 |
| `ErrorBoundary` | class 组件捕获渲染错误 → Result 错误页 + 重试(强制 remount)/刷新 |

### 5.2 project/ 子目录

`FlowTab`(汇总 Statistic×4+加权进度+历史运行 Timeline 选择器+逐步骤行[状态/abort Tag/重试]) · `VariablesTab`(表单/JSON 双模式+required+validateFieldFormat 校验) · `TerminalTab`(role=log 无障碍简化终端) · `StepDetailDrawer`(判定卡+**人工覆盖判定 Modal 必填原因**+证据卡+stdout/stderr) · `ProjectExecutions`(统一执行记录：orchestration/manual 双来源合并倒序+输出 Drawer) · `StepRunOutput`(步骤输出只读回显) · `ReportTab`(评级大字+指标卡+高/中/低风险+按章节层级判定明细表+导出 Excel/PDF(html)/JSON) · `AuditTab`(关键词/动作/时间范围筛选审计表) · `CommandRunsTab`(备用薄包装)。

### 5.3 agent/ 子目录

- `types.ts`：前端宽松会话状态类型（AgentStep/ToolCallState/HumanStepState/PhaseTransition/TimelineEntry 等——socket 字符串枚举不复用严格 StepRun）。
- `utils.ts`：四阶段元数据（A 接入建档/B 证据采集/C 判定评估/D 复核报告 及配色）、8 种会话状态中文、`fileRefUrl`(剥 uploads/ 前缀映射 `/api/upload/*`)、isImageRef 等。
- `PhaseTimeline`：消息时间线骨架——收集 tool/human/evidence 三类条目按 startedAt 排序再按相位分桶，各相 Divider+Timeline；底部最近 6 条模型消息气泡。
- `ToolCallCard`：AI 工具调用卡（状态 Tag/exitCode/耗时/入参 Collapse/迷你 Terminal/证据链接）。
- `HumanStepCard`：人机协作操作卡——MiniMarkdown 指令(内置极简渲染器，P0 不引 react-markdown)、预期结果、参考命令折叠；EvidenceUploader 上传+outcome 文本+完成按钮；「我遇到问题」转 sendMessage；active 时 scrollIntoView 居中+每 1.2s 切换 document.title「⚠ 等待人工操作」+脉冲动画。
- `EvidenceUploader`：功能模块 Select(8 类)+上传(accept image/.pcap/.log/.txt/.json/.bin/.pdf)→Tag 列表。
- `VerdictReviewPanel`：待审/已审分组；每卡 PASS-FAIL 描边+AI 生成紫 Tag+证据文件按钮；三操作 通过/拒绝(必填理由「提交并按条款重跑」)/补采(RedoOutlined 退回 B 阶段)。
- 其余：`ArtifactPanel`(工件/证据双 Tab+图片缩略预览)、`AiTranscriptCollapse`(AI 规划记录折叠)、`EvidenceAttachCard`(补充证据，持久化端点 TODO)、`mockSession.ts`(演示数据：小天才 Z6s 手册场景)。

## 6. 实时性设计模式（贯穿全站）

三层保障：**Socket 推送为主 + 定时轮询对账为辅 + 终态全量对账兜底**。

| 场景 | socket | 轮询 | 对账 |
| --- | --- | --- | --- |
| 命令运行 | run:logLine/status | 1.5s（useCommandRunStream） | 终态全量重刷 buffer；reconciled/receivedSocket/pollSeq 三 ref 防丢行防竞态 |
| 项目执行 | run:logLine/progress/status/batchProgress | 2.5s 步骤+run | 终态定格进度+刷新报告/审计 |
| 执行记录 | — | 4s（有非终态行时） | — |
| Agent 会话 | 17 个 agent:* 事件 | 3s 状态 + 5s sinceSeq 事件回补 | 历史 applyEvent 回放 + Proxy handler 转发 |

## 7. 已知留白（客观记录）

- `AgentApi` 中 resume/advance/rollback/sessions/:id/verdicts/review/clause retry 等调用对应的后端端点尚未实现（服务端 routes/agent.ts 无此路由）；
- `onAttachEvidence`（AgentSessionDetail 证据上送）为 TODO；EvidenceAttachCard 的会话持久化端点 TODO；
- mock 体系（mockSession/useMockAgentSession/?mock=1）是后端并行开发期的临时通道，代码内有明确 `TODO(agent-backend)` 注释；
- 前端 `subscribe {room:'agent:...'}` 与服务端读取 `payload.sessionId` 存在字段名不一致，实际加房依赖握手 query 或由事件全局广播兜底。
