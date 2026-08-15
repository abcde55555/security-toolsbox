# EN18031 合规测试平台 · 架构设计文档

> **文档版本**：v1.0
> **适用读者**：前后端架构师、Tech Lead、执行引擎/模组 SDK 开发工程师
> **读完后你能做的事**：按本文约定的模块边界和接口搭建代码工程骨架、选择存储、在不修改核心流程的前提下扩展新的合规模组与工具执行通道。

## 1. 总体架构：Web-First（Node 后端 + React 前端），Electron 桌面壳为可选包装

1. 推荐部署形态。考虑到 Linux 无图形界面服务器是合规测试平台的典型部署环境，首期部署形态定为 **B/S Client/Server 架构**：独立 Node.js 后端进程（承担业务服务层、执行引擎、持久化），用户通过浏览器访问 React 前端。后端通过 node-pty / child_process 本机执行 nmap、masscan、nuclei、binwalk、自定义审计脚本等命令；所有合规测试流量和目标设备信息都在后端所在的内网环境中处理，浏览器端仅接收显示数据。当有离线便携审计、审计员本地跑单台设备等场景时，可将同一套前后端用 Electron 包装为桌面应用（主进程承载后端代码），不修改任何业务代码即可切换部署形态。生产环境部署推荐：后端部署在目标网段可达的 Linux 服务器上，浏览器在内网任意机器访问即可。

2. 顶层分层。前端渲染层 React，负责所有 UI 组件、表单、终端显示、报告可视化；业务服务层 State Store + Domain Services，按领域拆成 ToolRegistryService、TemplateService、ProjectService、OrchestratorService、ClauseMappingService、ReportService、AuthzService 七类，各自只有一个职责；执行引擎层 ExecutionEngine，由 CommandExecutor 和 ModuleSDK 两个子通道组成，分别处理命令行型和表单交互型；持久化层 Repository，所有数据读写走 Repository 接口，底层实现 SQLite 或 PostgreSQL 可切换。

3. 跨层调用方向。渲染层只调用业务服务层的方法，不直接访问执行引擎和持久化；业务服务层调用执行引擎和持久化，不回调渲染层（通过状态变更订阅和事件总线通知 UI 更新）；执行引擎只接收执行请求并产生事件，不读写数据库，不感知 UI。这条依赖链必须严格遵守。

## 2. 数据流：一次完整合规测试的端到端流转

1. 阶段一 工具注册。Admin 在工具库注册一条工具记录，写 ToolRepository；同时健康检查任务异步调 `CommandExecutor.run('--version')`，把健康结果更新到记录的 healthStatus 字段。

2. 阶段二 模板编排。Template Manager 创建模板，从工具库引用 N 条工具并带 lockVersion 标识；通过 OrchestratorService 编排步骤列表，每步声明 stepId、toolId、defaultParams、dependsOn 依赖集合；启用的命令/表单模式选择跟随工具本身的 interactionMode；所有占位符参数统一用 `{{project.targetIp}}` 类的 mustache 风格变量表达，不在模板里填具体值。

3. 阶段三 项目创建与赋值。Auditor 基于模板创建项目，在 Project Variables 面板填 `targetIp`、`targetCidr`、`complianceLevel` 等变量，ProjectService 校验必填项并生成首次报告骨架。

4. 阶段四 编排执行。点击「跑整套流程」按钮，OrchestratorService 读步骤 DAG，拓扑排序后逐批执行；无依赖的步骤并行，有依赖的步骤等待；每步根据 interactionMode 分发到 CommandExecutor 注入变量后跑命令，或到 ModuleSDK 调用模组 `execute(params)` 方法；执行过程中的 stdout、进度、状态通过事件总线 EventEmitter 广播到 UI 更新终端和进度条。

5. 阶段五 结果入库与条款映射。每条步骤执行完成后，ExecutionResult 实体写入 Repository；然后 ClauseMappingService 根据步骤映射的 ruleId 列表，解析结果中的判定项，产出 ClauseVerdicts 实体，每条 verdict 对应一个 EN18031 条款编号。

6. 阶段六 报告汇总与导出。项目所有步骤完成后（或任意时刻点击「生成报告」），ReportService 按「合规定级规则表 → 条款判定汇总 → 证据链关联」三步生成 Report 实体；Report 提供 `exportPdf()` 和 `exportExcel()` 两个导出方法。

7. 日志保障。阶段四到阶段六的所有用户触发动作和引擎执行动作，都通过 AuditLogService 同步写一条不可变的 append-only 审计日志，任何用户包括 Admin 都不可通过 API 删除。

## 3. 模块边界与依赖（Domain Services 详细职责）

1. ToolRegistryService 工具注册中心。唯一职责是 CRUD 工具实体，维护工具的路径、版本、健康状态、引用计数；不执行命令，不解析结果；健康检查异步交给 HealthCheckWorker 处理，通过事件回写状态；工具删除时必须通过引用计数检查，只要有一个模板正在引用就软删除而不是真删除。

2. TemplateService 模板服务。管理模板实体、模板与工具的引用关系（含 lockVersion）、编排步骤 DAG、每步默认参数；提供 clone(fromTemplateId) 克隆方法；提供 notifyToolUpgrade(toolId) 方法，当某工具升级后遍历所有"跟随模式"引用它的模板，打上需确认标志。

3. ProjectService 项目服务。管理项目实体、项目变量集合、执行历史列表；项目创建必须基于一个模板；提供 bindTemplate 切换模板接口；变量集合变更时自动关联影响的所有步骤默认参数，但不直接触发重跑。

4. OrchestratorService 编排服务。唯一能执行步骤 DAG 的服务；接收 projectId + 可选 stepId 子集，做拓扑排序、依赖等待、并发控制（默认并发度 2，可配置）、超时控制、失败策略、进度汇总；不直接调命令或模组，统一走 ExecutionEngine 门面。

5. ClauseMappingService 条款映射服务。维护 EN18031 条款库；维护「工具步骤 → 条款判定规则」映射列表；接收 ExecutionResult，按映射规则解析出 ClauseVerdicts；映射规则支持两种表达方式：模组结果中 clauseId 直出，或命令输出正则匹配后映射到条款。

6. ReportService 报告服务。生成、存储、导出项目级报告；合规定级规则在 ReportService 内部独立配置，不耦合条款库；导出的 PDF 走浏览器渲染模板页 → puppeteer PDF，导出的 Excel 走 exceljs 生成，两种格式内容一一对应。

7. AuthzService 授权服务（轻量预留首期）。暴露 `assertRole(req, roles[])` 和 `hasRole(user, role)` 两个公开方法；首期实现可直接返回 true 或根据本地配置文件判断，但所有 Controller/Service 的写入口必须调用它；数据模型保留 userId 外键和 role 枚举字段，等后期接入认证时再打开。

## 4. 执行引擎接口抽象（最重要的跨模块契约）

1. ExecutionEngine 门面。对外只暴露两个方法：runCommand(command, context) 和 runModule(moduleId, params, context)，返回 Promise<ExecutionResult> 且同时支持 onProgress 回调。context 必含 projectId、stepId、userId、variables、timeoutMs 五个字段。

2. CommandExecutor 通道。接收命令字符串（内部已按 context.variables 做过变量替换），由 Electron 主进程通过 node-pty spawn 起一个伪终端会话；stdout/stderr 按行推送 onProgress；退出码 0 成功非 0 失败；超时 kill 并标记 status=timeout；提供 cancel(sessionId) 中断接口。

3. ModuleSDK 通道。按 moduleId 从注册表找到对应模组类实例，调用 `instance.execute(params, { onProgress, onCancelToken })`；模组内部可以自由组合命令或做复杂计算，最终必须返回标准化的 ExecutionResult；详细契约见《模组 SDK 规范》文档。

4. ExecutionResult 标准结构。所有通道的返回值必须是一个形状固定的对象，字段有 runId、projectId、stepId、toolId、moduleId（可为空）、status（success/fail/timeout/crash/partial/blocked 六种枚举）、exitCode、stdout、stderr、durationMs、startedAt、finishedAt、evidence 数组、verdicts 数组（每条 verdict 是 clauseId + pass + reason + severity + evidenceRef 的对象）、error 字段（失败时填）。任何引擎通道或任何模组都不得自定义返回字段与 status 枚举外的状态。

## 5. 存储选型与 Repository 接口

1. 首期（Electron 单机版）。关系型数据用 SQLite，文件型用本地文件系统；SQLite 存所有业务表、日志、报告元数据；文件系统存工具执行的原始输出、报告 PDF/Excel 导出文件、上传的自定义工具二进制与配置。

2. 远期（C/S 团队版）。平滑替换 Repository 实现为 PostgreSQL + S3/对象存储；上层业务代码不应出现任何与 SQLite 相关的 SQL 或文件路径操作，所有通过 Repository 接口访问的业务代码零修改切换。

3. Repository 接口列表。ToolRepository、TemplateRepository、ProjectRepository、StepExecutionRepository、ClauseRepository、ClauseMappingRuleRepository、AuditLogRepository、ReportRepository、UserRepository（首期留空），各自只包含 CRUD 加少量领域查询方法，不写业务逻辑。

4. Append-only 审计日志的物理约束。AuditLogRepository 只提供 insert() 和 query() 两个方法，对外不暴露 update() 和 delete()；数据库层用行级触发器禁止 UPDATE/DELETE，双保险保证审计合规。

## 6. 权限预留钩子与可插拔点

1. 路由层。所有需要保护的 API 路由统一走一个 authMiddleware，其内部调用 `AuthzService.assertRole(req, requiredRoles)`；首期 middleware 可以先空实现放行，但必须确保每个写操作路由都挂上了并声明了 requiredRoles。

2. 前端 UI。Header 预留当前用户头像与下拉菜单位置，首期先隐藏或显示"Admin（预留）"字样；任何"删除""注册工具""修改模板"按钮在渲染时都走 `useAuthorization(requiredRoles)` Hook，首期 Hook 返回 true 但代码结构不改。

3. 多 Workspace 预留。所有业务表加 workspaceId 字段，默认值为 'default'；SQL 查询层统一走 `withWorkspace(workspaceId)` Scope，首期全走 default 但不用改表结构就能支持多团队隔离。

4. 模组版本升级兼容钩子。ToolRegistryService 提供 `on('tool.upgraded', (toolId, oldVersion) => ...)` 事件，TemplateService 订阅它后给跟随模式模板打 upgradePending 标记；未来的第三方模组也走同一个升级通知通道。

## 7. 状态管理与 UI 更新

1. 前端 Store。首期推荐 Zustand（体积小、概念少、TypeScript 友好），按领域拆 store：toolStore、templateStore、projectStore、terminalStore、reportStore、authStore。

2. 终端显示。terminalStore 维护 projectId → session 的 Map，每个 session 维护 stdout 日志行数组 + running 状态 + progress；命令执行时引擎回调的每一行都 append，避免整段重渲染导致的终端滚动跳动。

3. 长轮询/推送。C/S Web-First 版统一使用 WebSocket（推荐 Socket.IO）推送终端行、步骤进度、状态变更，避免前端长轮询；Electron 壳版可直接复用同一套 WebSocket 连接（本地起 127.0.0.1 随机端口，渲染进程连后端的本地 WS），不需要维护 IPC 第二条通道。

## 8. 开发顺序建议（按依赖链排序）

1. 最先写 ExecutionEngine + ExecutionResult 契约 + ModuleSDK 接口抽象，这是全系统的心脏，先写下来保证后续所有模块对接同一套标准。

2. 第二步写所有 Repository 接口和业务表建表脚本，把 ToolRepository、ClauseRepository 先实现了，条款库和工具库需要有种子数据才能测后续流程。

3. 第三步 ToolRegistryService + ClauseMappingService 落地，一个管输入一个管输出。

4. 第四步 TemplateService + OrchestratorService。Orchestrator 依赖前面四个服务，且最容易出 bug，放第四。

5. 第五步 ProjectService + ReportService。项目与报告是最上层的业务，依赖其他所有模块。

6. 最后 UI 开发；Electron 桌面壳仅作为 Web-First 架构之上的可选打包方式，放在独立打包里程碑处理，不作为首期开发范围。
