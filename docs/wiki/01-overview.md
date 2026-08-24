# 01 · 项目概览

## 1. 项目定位

**EN18031 合规测试平台**（monorepo 包名 `en18031-tools`）用于对消费类物联网设备执行 **EN 18031 系列标准**（ETSI 消费类物联网网络安全标准，含 -1/-2/-3 部分）的合规评估。平台解决三个核心问题：

1. **检测工具化**：将安全检查（加密算法核查、固件密钥扫描、端口暴露检查、默认凭据检查等）封装为可注册、可复用的「模块（module）/工具（tool）」；
2. **评估流程化**：通过「合规模板 → 项目 → 运行 → 条款判定 → 报告」的流水线，把零散的检查结果聚合为按条款组织的合规结论与 Excel 报告；
3. **评估智能化**：内置 AI Agent 会话子系统，以「引导(onboarding)→采集(collection)→裁定(adjudication)→复核(review)」四阶段人机协同流程驱动评估，支持 DeepSeek / OpenAI 兼容 / Anthropic 协议的多 Provider 配置。

## 2. 技术栈总览

| 层 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 语言 | TypeScript | ^5.5.4 | 全仓 TypeScript，`strict: true`，ES2022 target，纯 ESM（`"type": "module"`），模块解析 `Bundler` |
| 后端框架 | Fastify | ^4.28.1 | HTTP 服务；插件：`@fastify/cors`、`@fastify/multipart`(上传)、`@fastify/static`(托管前端 dist) |
| 实时通信 | socket.io | ^4.7.5 | 服务端 + `socket.io-client` 前端；基于房间(`run:*`、`agent:*`)推送执行/会话事件 |
| 数据库 | better-sqlite3 | ^11.3.0 | 单文件 SQLite（WAL 模式 + 外键约束），内嵌版本化迁移系统（9 个迁移） |
| 校验 | zod | ^3.23.8 | shared 包中的请求/实体 Schema |
| 日志 | pino + pino-pretty | ^9/^11 | 结构化日志 |
| 报告 | exceljs | ^4.4.0 | 生成 Excel 合规报告 |
| XML 解析 | fast-xml-parser | ^4.5.0 | 固件分析模块解析 XML 资源 |
| 前端 | React + antd + react-router-dom | ^18.3 / ^5.20 / ^6.26 | SPA；Ant Design 组件库 |
| 构建 | Vite / tsc / tsx | ^5.4 | web 用 Vite；server/modules 用 tsc；开发期用 tsx 直接跑 TS |
| 测试 | vitest | ^2.0.5 | shared/modules/server 的单元测试；另有无依赖 Node 冒烟脚本 |
| 包管理 | pnpm workspace | — | `packages/*` 四个子包，`workspace:*` 协议互联 |

## 3. 仓库目录结构

```
security-toolsbox/
├── package.json                 # 根脚本：build/typecheck/test/dev:server/dev:web/seed/start
├── pnpm-workspace.yaml          # 工作区：packages/*
├── tsconfig.base.json           # 共享编译选项（strict, ES2022, Bundler 解析）
├── en18031_prototype_v7.html    # v7 UI 高保真原型（单文件，前端交互蓝本）
├── data/                        # 运行时数据目录（gitignore）
│   ├── sqlite/app.db            # SQLite 主库
│   ├── files/cmdruns|evidence|tmp  # 命令输出日志/证据文件/临时目录
│   ├── reports/                 # 生成的 Excel 报告
│   └── logs/                    # 应用日志
├── docs/
│   ├── en18031/                 # 平台设计文档（PRD/架构/SDK/DSL/数据模型等 10 篇）
│   ├── agent/                   # Agent 可行性与实施计划
│   └── wiki/                    # ★ 本 Code Wiki
└── packages/
    ├── shared/src/              # index.ts / types.ts / enums.ts / schemas.ts
    ├── modules/src/
    │   ├── index.ts             # builtInModules 汇出
    │   └── en18031-{crypto-check,firmware-secret-scan,port-check,default-cred-check}/
    │       ├── module.config.ts # ModuleConfig 声明
    │       ├── index.ts         # execute() 实现
    │       └── __tests__/       # vitest 用例
    ├── server/
    │   ├── src/
    │   │   ├── index.ts         # Fastify 引导 + Socket.IO + 静态托管
    │   │   ├── config.ts        # AppConfig：环境变量 → 配置
    │   │   ├── logger.ts        # pino 日志器
    │   │   ├── db/              # database.ts(迁移)/seed.ts/clauseSeed.ts/commandToolSeed.ts
    │   │   ├── repositories/    # 13 个数据访问仓库 + json.ts 序列化助手
    │   │   ├── services/        # 业务服务层（14 文件）
    │   │   ├── engine/          # 执行引擎：executionEngine/commandExecutor/moduleLoader/cancelToken
    │   │   ├── routes/          # Fastify 路由（12 文件，REST API）
    │   │   ├── agent/           # AI Agent 子系统（阶段机/规划循环/AI Provider/工具桥）
    │   │   └── __tests__/       # vitest 单测（10+ 文件）
    │   └── scripts/             # smoke.mjs / smoke-commands.mjs E2E 冒烟
    └── web/
        ├── vite.config.ts       # 端口 5173，代理 /api 与 /socket.io → :3000
        └── src/
            ├── main.tsx/App.tsx # 路由与布局
            ├── api/             # client.ts/endpoints.ts/socket.ts
            ├── hooks/           # 5 个实时数据 Hooks
            ├── pages/           # 10 个页面
            ├── components/      # 通用组件 + project/* + agent/* 子目录
            └── utils/ui.ts
```

## 4. 核心领域概念速查

| 概念 | 类型 | 含义 |
| --- | --- | --- |
| 标准 Standard | `Standard` | 一部标准的元数据，如 `EN18031:2019`（id 即 `standardVersion`） |
| 条款 Clause | `Clause` | 标准下的具体要求，树形（`parentId`），带等级 L1/L2/L3、严重度、适用部分(-1/-2/-3) |
| 工具 Tool | `Tool` | 可执行的检查能力。`type='module'` 为 TS 内置模块，`type='custom'` 为命令行工具（含 `commands[]` 命令模板）；有健康状态(green/yellow/red)、引用计数、乐观锁 revision |
| 命令 Command | `ToolCommand` | 自定义工具下的一条命令模板（`commandTemplate` + `params: FormField[]`），可绑定条款 |
| 模块 Module | `BaseModule` | 内置检测模块的实现契约：`config: ModuleConfig` + `execute(params, ctx)`，返回结构化 `ExecutionResult` |
| 模板 Template | `Template` | 评估方案。两种模式：`ad-hoc`（自由步骤编排）/ `compliance`（步骤挂载到条款 clauseBindings 下）；含变量声明、步骤 DAG（dependsOn）、失败策略、重试、超时、导出变量 |
| 步骤 TemplateStep | — | 模板中的一个执行单元：绑定工具+参数+判定规则(verdictRule)+聚合分组(groupKey) |
| 项目 Project | `Project` | 模板的实例化：快照模板版本 + 填充变量 + 目标合规等级 |
| 运行 ProjectRun | `ProjectRun` | 一次项目执行：进度百分比、取消标记、变量快照 |
| 步骤运行 StepRun | `StepRun` | 单步骤执行记录：状态机、stdout/stderr 文件引用、证据数、判定数 |
| 证据 Evidence | `Evidence` | 判定依据：stdout 行/断言/校验错误/文件指针/截图，带 hash |
| 判定 ClauseVerdict | `ClauseVerdict` | 条款结论：pass/fail + severity + reason + evidenceRefs；Agent 场景有 reviewStatus 复核流 |
| 命令运行 CommandRun | `CommandRun` | 工具库中直接执行一条命令的记录（独立于项目流水线），stdout/stderr 落盘 `data/files/cmdruns/` |
| 报告 Report | `Report` | 汇总判定生成的报告（excel/pdf/snapshot），含 grade（PASS/CONDITIONAL_PASS/FAIL/INCOMPLETE）与 summary |
| Agent 会话 AgentSession | `AgentSession` | AI 人机协同评估会话：设备档案、选中条款、授权工具、阶段(phase)、状态(status) |
| 工件 Artifact | `Artifact` | Agent 产出的结构化资料：device_profile / network_topology / onboarding_result 等 |

## 5. 两种工作模式

平台对同一个项目实体支持两种驱动方式（`projects.mode`，见枚举 `PROJECT_MODES`）：

1. **template（模板模式）**：用户在模板编辑器中编排步骤 DAG → 创建项目填变量 → 一键运行，由 OrchestratorService 自动调度全部步骤并产出判定与报告；
2. **agent_guided（Agent 引导模式）**：创建 AgentSession，由 AI 规划循环(plannerLoop)逐步推进四阶段流程，关键节点插入人工步骤(human_step)，最终同样落成条款判定（数据库触发器强制 Agent 会话只能在 adjudication 阶段写入判定）。

## 6. 设计文档索引（docs/en18031）

`01-PRD` · `02-Architecture` · `03-Module-SDK` · `04-Clause-Mapping` · `05-Orchestration-DSL` · `06-Data-Model-and-API` · `07-Development-Plan-and-Milestones` · `08-Deployment-and-Ops-Guide` · `09-Testing-Strategy` · `10-SDK-Example-PortCheck` —— 本 Wiki 的源码分析与这些设计文档互为印证。
