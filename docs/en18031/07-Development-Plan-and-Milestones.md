# EN18031 合规测试平台 · 开发里程碑与实施计划

> **文档版本**：v1.0
> **产出日期**：2026-08-15
> **适用读者**：Tech Lead、项目经理、全栈开发工程师、合规模组开发工程师
> **读完后你能做的事**：按本文的 Milestone 顺序启动工程、按任务清单拆 Issue、明确每个里程碑的交付物与验收标准、对照推荐目录结构初始化代码仓库。

## 1. 总体交付节奏（Web-First 优先，Electron 放最后）

1. 四个 Milestone 串行推进，前一个的验收标准全部通过后才进入下一个。Milestone 1 交付"地基能跑一条模组"，Milestone 2 交付"MVP 闭环可出完整报告"，Milestone 3 交付"实际团队能用一周不阻塞"，Milestone 4 交付"多团队接入与窄屏可用"。每个 Milestone 结束后触发测试 Agent 验证，发现问题在 GitHub 提 Issue，修复完成后走 PR + Review + CI 合并流程。

2. Web-First 是首期唯一交付形态。Electron 桌面壳打包放在 Milestone 4 之后作为独立里程碑处理，不进入 MVP 范围。原因是 Linux 无头部署是第一优先级，Electron 包装不会改变任何业务代码，仅作为启动器与窗口管理，晚点做不会阻塞核心功能。

3. 用户管理与权限属于 Milestone 4 范围，但数据模型和接口钩子必须在 Milestone 1 就预埋。首期实际运行以"单 Admin 本地模式"为主，登录页可以先隐藏或以静态占位，直到 Milestone 4 再打开。

4. 推荐的 Sprint 粒度。每个 Milestone 拆 2~3 个 Sprint，每个 Sprint 不超过 2 周。Sprint 结束必须有可演示产物，不能只交代码。

## 2. 技术栈锁定（选型理由 + 不可替换范围）

1. 后端运行时。Node.js 18 LTS（或更高稳定 LTS），TypeScript 严格模式（strict=true、noImplicitAny=true、strictNullChecks=true），不接受 JavaScript 裸文件混入；构建用 tsup 或 esbuild，不用 tsc 直接产出，理由是冷启动速度和 tree-shaking 质量，执行引擎作为常驻进程启动速度很重要。

2. Web 框架。Express 或 Fastify 二选一，推荐 Fastify（更快的 JSON 序列化、内置请求校验 schema、插件生态好）；路由必须按领域前缀分文件组织，不能全挤在一个 index.ts。路由层只做三件事：解析请求参数、调用 assertRole 权限钩子、转发给对应 Service，不能在路由里写业务逻辑。

3. 实时推送。WebSocket 用 Socket.IO v4+，理由是自动重连、房间订阅、消息确认机制，原生 WebSocket 这些要手写容易出 Bug；项目执行实时流每个 runId 一个房间，浏览器订阅 /ws/projects/:id/runs/:runId/stream；Electron 版复用同一套 Socket.IO，后端起本地 127.0.0.1 随机端口，渲染进程直接连，不做第二条 IPC 通道。

4. 持久化。首期 SQLite 3（better-sqlite3 驱动，同步 API 事务简单），Repository 接口抽象保留 PostgreSQL 切换能力；ORM 不强制，推荐用 Kysely（类型安全查询构造器，不做模型魔法，迁移脚本可控），不推荐 Prisma（迁移时生成大量样板、复杂事务性能差）；迁移脚本用 Kysely Migrations 或 db-migrate，手写 SQL 也可以，但必须版本化、可回滚、幂等。

5. 前端框架。React 18+ TypeScript，构建用 Vite，状态管理用 Zustand（轻量、概念少、TS 友好，不需要 Redux Toolkit 那套复杂 boilerplate）；路由用 React Router v6；UI 组件库推荐 Ant Design 5 或 Radix UI + Tailwind，二选一，保持一致不要混；终端显示用 xterm.js 加自绘，报告页的图表用 ECharts 或 Recharts。

6. 命令执行通道。node-pty 作为伪终端引擎（支持 PTY、实时行输出、resize、kill），兜底用 child_process.spawn 当 node-pty 在某些平台编译失败时的降级；超时与取消令牌统一由 ExecutionEngine 封装，不允许业务代码直接 require('child_process') 自己起进程。

7. 报告导出。PDF 导出用 Puppeteer 渲染报告页再生成 PDF（视觉与浏览器一致，不需要手写 PDF 布局库），Excel 导出用 exceljs；导出文件统一存本地文件系统的 reports/ 目录，文件名带 projectId + runId + 时间戳 + 格式后缀，同时写文件哈希到 reports 表。

## 3. 推荐工程目录结构（代码归属边界）

1. 仓库根按后端 packages/server、前端 packages/web、合规模组 packages/modules、共享类型 packages/shared、Electron 壳 packages/electron（Milestone 4+）五个 package 组织，用 pnpm workspace 或 npm workspace 管理依赖。禁止出现"后端依赖前端组件"或"前端依赖后端 Service 实现"的交叉依赖；共享包只放 TypeScript 类型定义、枚举、常量、zod 校验 schema，不放逻辑。

2. packages/server 内部按领域分层：src/routes 路由层（按 tools.ts、templates.ts、projects.ts … 分文件），src/services 业务服务层（ToolRegistryService.ts、TemplateService.ts … 每类服务一个文件），src/engine 执行引擎（ExecutionEngine.ts、CommandExecutor.ts、ModuleLoader.ts、types.ts），src/repositories 持久化层（每个 Repository 一个文件 + Repository 接口抽象），src/db 数据库连接、迁移脚本、种子数据，src/middleware 中间件（authMiddleware、auditMiddleware、errorHandler），src/events 事件总线与订阅者，src/config 配置加载（环境变量 + 默认值 + zod 校验）。

3. packages/web 内部按领域拆 store 和页面：src/stores 放 Zustand stores（toolStore、templateStore、projectStore、terminalStore、reportStore、authStore），src/pages 放路由级页面（ToolsPage、TemplatesPage、ProjectDetailPage，ProjectDetailPage 再拆五个子 Tab 组件），src/components 放通用组件（ToolCard、StepCard、TerminalView、ClauseVerdictBadge、HealthDot），src/services 放前端 API 客户端（自动生成或手写 fetch 封装，统一处理返回信封和错误码），src/types 引用 packages/shared 的类型并补充前端专用类型。

4. packages/modules 每个模组一个子目录，子目录固定包含 module.config.ts、index.ts（实现 BaseModule 接口）、README.md（模组说明、条款覆盖列表、注意事项）。模组不能直接 import packages/server 的内部实现，只能通过 packages/shared 里暴露的 BaseModule 接口和 ExecutionEngine 抽象类型进行依赖倒置，保证模组未来可以独立打包或第三方上传时不依赖核心层具体实现。

5. packages/shared 只放跨端共用的类型：ExecutionResult、ExecutionStatus 枚举、Tool 类型、Template 类型、Project 类型、ClauseVerdict 类型、API 错误码枚举、表单字段类型。所有跨包引用只能从 shared 出类型，不能跨包互相引用实现文件，避免打包时形成循环依赖。

## 4. Milestone 1 — 架构地基（预计 3~4 周）

1. 本阶段目标。能跑通"一个内置模组（port-check）从参数表单 → 执行 nmap 命令 → 解析输出 → 生成 clause verdict → 写入 evidence"的最小闭环，不需要 UI、不需要模板、不需要项目、不需要报告。验收标准是一条 CLI 脚本或集成测试能 assert 最终 verdict 的 clauseId 正确、pass 值正确、evidenceRefs 非空。

2. 任务清单。任务 1-1 初始化仓库 monorepo 结构、TS 配置、ESLint 规则、CI 基础流水线（lint + typecheck + build）。任务 1-2 编写 packages/shared 的所有类型与枚举，配套 zod 校验 schema（ExecutionResult、Tool、Clause、Verdict 这几个核心结构必须有 schema，用于运行时校验外部输入）。任务 1-3 实现 packages/server 执行引擎子系统：ExecutionEngine 门面、CommandExecutor（node-pty + spawn 兜底）、ModuleLoader（按 id 加载 packages/modules 下对应模组实例）、ExecutionResult 标准化校验（不合法返回直接拦截并写入 SDK 契约警告日志）。任务 1-4 实现 Repository 接口抽象 + SQLite 实现 + 迁移脚本，落地 tools、clauses、evidences、clause_verdicts、audit_logs 五张表，users 和 workspaces 表建表但不写入业务逻辑。任务 1-5 实现 ToolRegistryService 与 ClauseMappingService：工具 CRUD、健康检查 worker（异步跑 --version 回写 healthStatus）、引用计数检查；条款库种子数据导入（EN18031 L1/L2/L3 最小集合）、映射规则 CRUD、按 ExecutionResult 解析生成 verdict。任务 1-6 写 AuthzService 空实现 + authMiddleware 占位，所有写接口路由挂上 assertRole 且角色声明正确，测试 Agent 应验证接口被错误角色访问时会走到 assertRole 分支（即使首期放行也要有分支覆盖）。任务 1-7 开发首个内置模组 en18031-port-check：完整 module.config.ts、formFields 定义（目标 IP、端口范围、超时、扫描类型）、execute 方法内调 engine.runCommand 跑 nmap、按端口开放/关闭生成 evidence、按映射条款 5.3-1/5.3-2/5.3-3 生成 verdicts、处理 cancelToken。任务 1-8 编写 Milestone 1 集成测试套件。

3. 本阶段不做。任何前端 UI 代码、模板编排逻辑、项目管理逻辑、报告导出逻辑；这些依赖地基稳定，提前写会因为 ExecutionResult 契约变更而反复返工。

4. 交付物。packages/shared 类型库（发布为 workspace 包），packages/server 可启动的最小 HTTP API（只有 tools、clauses、auth 三组接口 + 健康检查），en18031-port-check 模组源码，Milestone 1 测试报告，CI 流水线首次绿标。

## 5. Milestone 2 — MVP 闭环（预计 4~5 周）

1. 本阶段目标。拿一个真实 IoT 设备（例如网络摄像头），按 EN18031 L2 标准，从"创建模板 → 建项目填变量 → 跑整套编排 → 一键导出 PDF 报告"，不需要测试工程师手动输入任何一条命令或手写一段报告正文。验收标准是：报告中 5.3 网络通信章节所有 L2 条款有判定、每条判定有证据追溯、合规定级计算规则正确、PDF 导出文件可归档。

2. 任务清单。任务 2-1 落地 TemplateService 与 OrchestratorService：模板 CRUD + 工具引用关系（含 lockVersion）、编排步骤 DAG 合法性校验、拓扑排序、并发控制、依赖等待、失败策略、超时控制、进度聚合、exportVars 变量提取与传递、ephemeral 产物清理。任务 2-2 落地 ProjectService 与 ReportService：项目 CRUD、变量面板必填校验、project_run 与 step_run 生命周期、合规定级规则引擎（PASS/CONDITIONAL PASS/FAIL 三档，阈值配置化）、报告快照生成、Puppeteer PDF 导出流水线、exceljs Excel 导出流水线。任务 2-3 补齐 packages/server 所有 REST API（06 文档列出的 1~12 节全部），补齐 WebSocket 推送通道（logLine、progress、status、batchProgress 四类消息），补齐审计日志 append-only 的数据库层触发器禁止 UPDATE/DELETE。任务 2-4 开发 packages/web 完整 UI：工具库页（分类、搜索、健康灯、注册表单、详情）、模板管理页（列表、克隆、引用工具选择、编排步骤编辑器、DSL 预览）、项目详情页五个 Tab（目标与工具、编排进度、终端、审计日志、合规报告）、Header 用户占位下拉与部署状态徽章。任务 2-5 开发至少 5 个内置模组覆盖 EN18031 L2 核心章节：网络端口合规（复用 M1 的 port-check）、弱加密套件检测（crypto-check）、默认口令检测（default-cred-check）、固件硬编码密钥扫描（firmware-secret-scan，基于 binwalk + grep）、TLS 证书合规检测（tls-cert-check），每个模组必须附带自己的单元测试与条款映射种子规则。任务 2-6 写 Milestone 2 E2E 测试套件：Playwright 模拟用户完成整套流程，断言 PDF 文件存在、条款判定 PASS/FAIL 分布符合预期。任务 2-7 准备条款库完整种子数据（至少覆盖 L1 全量 + L2 核心 30 条 + L3 示例 10 条），准备 IoT 摄像头作为联调目标设备，准备一台 Linux 测试服务器验证 Web-First 部署可跑。

3. 本阶段不做。长任务的暂停继续、模板克隆继承合并、日志筛选、响应式窄屏适配、Electron 壳、用户管理真实 UI。

4. 交付物。可部署的 Web-First 前后端（Linux 服务器可一键 docker compose up），5 个内置模组 + 条款种子数据，完整的 EN18031 L2 IoT 摄像头合规报告 PDF 样本，Playwright E2E 测试脚本，Milestone 2 测试报告。

## 6. Milestone 3 — 体验与效率（预计 3~4 周）

1. 本阶段目标。实际测试团队用一整周，无阻塞性反馈，长任务不丢失进度，工具异常有语义化提示，日志可快速定位问题，模板可复用可克隆。验收标准是测试团队满意度问卷 ≥4/5，阻塞性 Issue 数量为 0。

2. 任务清单。任务 3-1 长任务进度与中断控制：OrchestratorService 增加 pause/resume 状态机、StepRun 持久化进度百分比、ETA 估算系数调整、强制终止的资源清理钩子、模组 cancelToken 回调的全链路测试。任务 3-2 工具健康检查体系：启动时全量扫描一次健康、模板引用区红色升级提示 UI、健康灯点击触发即时校验、版本不匹配的黄色警告与"仍要运行"二次确认对话框。任务 3-3 模板克隆与继承：clone 接口支持 inheritParent 父子关系写入、父模板升级后的子模板变更通知 UI、手动选择合并或忽略的 diff 视图。任务 3-4 错误状态的语义化处理：新增 timeout/crash/blocked(EDR)/permission_denied/partial 五类 ExecutionStatus，对应 UI 颜色与提示文案、报告页判定策略区分（超时=未知，部分成功=按已成功结果标黄）、错误码与用户建议动作映射表。任务 3-5 自定义工具开放表单交互模式：工具注册时 formFields schema 可选填写、前端按 schema 动态渲染表单、自定义命令行工具的 execute 包装器（子进程 + JSON 输出解析 + 证据/判定生成）。任务 3-6 审计日志的检索与筛选：前端筛选组件（状态/工具/时间范围/关键词）、后端查询索引优化（createdAt + entityType 联合索引）、日志详情抽屉页展示 before/after JSON diff。任务 3-7 Milestone 3 回归测试套件 + 性能测试（1000 条日志、20 个步骤并行、50MB stdout 不卡 UI）。

## 7. Milestone 4 — 扩展能力（预计 3~4 周）

1. 本阶段目标。多产品线团队接入可用、13 寸笔记本窄屏可用、用户管理 UI 可真正用。验收标准是两个独立团队的 Workspace 数据完全隔离，1024 宽度无水平滚动条，Auditor 角色无法访问 Admin 专属功能。

2. 任务清单。任务 4-1 响应式布局与窄屏适配：1024 断点下侧栏可收起为图标、项目详情的五个 Tab 支持左右滑动或折叠为下拉、工具详情从双栏改为单栏上下堆叠、终端最小高度保证 12 行可见。任务 4-2 分类+标签双维度筛选：标签多选组件、Admin 专属标签管理页、工具搜索结果按分类+标签联合过滤索引。任务 4-3 版本变更记录与回滚：tools/templates/projects 三表新增 revision 自增字段，每次写入写一条 *_revisions 历史快照，详情页增加"历史版本"时间线 Tab，支持一键回滚（写审计日志）。任务 4-4 Workspace 多团队隔离：workspaces 表 UI 管理（Admin 专属）、所有 SQL 查询 Scope 统一走 withWorkspace、登录后切换 Workspace 下拉、跨 Workspace 的数据访问必须返回 9004 资源不存在而不是 9002 权限不足（避免泄露其他 Workspace 存在性）。任务 4-5 用户管理 UI 打开：登录页、用户列表 CRUD、角色修改弹窗、密码重置、登录日志、AuthzService 真实 assertRole 打开、所有前端 useAuthorization Hook 的角色判断逻辑启用。任务 4-6 Milestone 4 安全测试与权限矩阵测试：每种角色访问每个接口的 403/404 断言、Workspace 越权尝试、审计日志不可删除/不可修改的物理验证（直接改 SQLite 文件尝试被触发器拦截）。任务 4-7 Electron 桌面壳打包（可选）：主进程启动本地后端、随机端口、渲染进程加载本地 URL、窗口管理、菜单、自动更新、离线便携审计模式的文档。

## 8. CI/CD 与质量门禁（所有 Milestone 共用）

1. 每个 PR 必须通过四道门禁。门禁 1 TypeScript typecheck + ESLint（warn 也不能有，配置 error 级别）。门禁 2 单元测试覆盖率阈值：services 层 ≥80%，engine 层 ≥90%，Repository 层 ≥70%，低于阈值合并按钮禁用。门禁 3 集成测试：SQLite 内存库跑全量 services 层用例，不通过不合并。门禁 4 测试 Agent 自动跑：Milestone 结束时触发专门的测试 Agent 进行验证，测试 Agent 发现的问题必须在 GitHub 开 Issue 并指派对应 Milestone 负责人，修复走 PR 流程。

2. 主分支保护规则。不允许直接 push 到 main 分支，只能通过 PR；PR 至少 1 个 Code Reviewer approve（Milestone 1-2 必须 Tech Lead approve，Milestone 3-4 可以由同级高级工程师互审）；合并方式采用 Squash Merge，每个 PR 合入主分支后生成一条语义化 commit message（feat/fix/docs/chore/ci 前缀）。

3. 发布节奏。每个 Milestone 验收通过后打一个 Git Tag，格式为 v0.Milestone 号.Sprint 号.Patch，例如 Milestone 2 第 1 个 Sprint 完成打 v0.2.1.0；Tag 触发发布流水线，产出 Docker Image（Web-First 版）和 GitHub Release Notes（列出本 Tag 新增/修复/已知问题）。

## 9. 风险清单与缓解预案

1. 风险 1：node-pty 在目标 Linux 服务器编译失败。缓解措施：Milestone 1 启动时即在目标 Linux 环境跑 Dockerfile 构建，编译失败立即切换到 child_process.spawn 兜底并记录为技术债，不阻塞 Milestone 1；同时在 Docker Image 中预装 python3、make、g++ 等 node-pty 编译依赖。

2. 风险 2：合规模组的条款判定规则与甲方合规负责人实际预期不一致，导致报告被判无效。缓解措施：Milestone 2 开发前组织一次条款映射规则评审会，合规负责人签字确认 04-Clause-Mapping 文档中种子条款的严重度、定级阈值、判定逻辑；评审结论作为附件追加到 04 文档，任何后续调整必须走变更申请加审计日志。

3. 风险 3：长任务的进度估算严重偏离（例如 nmap 全端口扫描实际 20 分钟但进度条 2 分钟就跑到 95%），导致用户信任度下降。缓解措施：Milestone 3 的进度估算引入"历史同类步骤执行时间"的加权平均值，首次跑用超时线性估算兜底，第二次跑起自动用上次实际耗时的系数修正；进度条显示 ETA 且标注"预估时间，实际可能偏差 ±30%"，避免给出虚假确定感。

4. 风险 4：append-only 审计日志的磁盘占用在运行半年后膨胀到不可控。缓解措施：Milestone 4 引入日志归档流水线，超过 180 天的日志自动归档到冷存储（压缩 + 哈希校验），在线库只保留近 180 天，但归档日志的哈希必须仍可在线查询以满足审计合规；归档操作本身也写一条审计日志，记录谁、何时、归档了哪段时间范围。

5. 风险 5：用户管理打开后，首期的"全放行 assertRole"被遗漏在某些接口，造成越权漏洞。缓解措施：Milestone 4 启用权限前写一份权限矩阵测试脚本，遍历 06 文档列出的所有写接口，分别用 Admin、Template Manager、Auditor、未登录四种身份调用，断言每种的 HTTP 状态码与返回错误码完全符合文档；脚本挂到 CI 每周跑一次，任何回归立即报警。
