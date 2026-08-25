# EN18031 合规测试平台 · Code Wiki

> 本 Wiki 由对仓库源码的全量分析生成，覆盖项目整体架构、主要模块职责、关键类与函数、依赖关系与运行方式。
> 分析基准：仓库根目录 `security-toolsbox`，monorepo 版本 `en18031-tools 0.1.0`。

## 项目一句话简介

**EN18031 合规测试平台**是一个面向消费类物联网设备网络安全标准 **EN 18031**（ETSI）的合规评估工作台：内置安全检测模块与命令工具库，支持以「合规模板 → 项目执行 → 条款判定 → 报告导出」的流水线完成合规测评，并提供 **AI Agent 人机协同评估会话**（规划—采集—裁定—复核四阶段）。

## 文档导航

| 编号 | 文档 | 内容 |
| --- | --- | --- |
| 01 | [项目概览](./01-overview.md) | 项目定位、技术栈、仓库目录结构、核心概念速查 |
| 02 | [整体架构](./02-architecture.md) | 分层架构图、运行时拓扑、三条核心数据流、事件总线 |
| 03 | [shared 共享包](./03-package-shared.md) | 全局类型、枚举、Zod Schema（前后端契约） |
| 04 | [modules 测试模块包](./04-package-modules.md) | 模块 SDK 契约与 4 个内置安全检测模块 |
| 05 | [server 数据与服务端基础](./05-server-foundation.md) | 入口启动流程、配置项、SQLite 数据库设计、Repository 层 |
| 06 | [server 业务服务与执行引擎](./06-server-services-engine.md) | Service 容器、编排器、判定引擎、命令执行器、报告生成 |
| 07 | [API 接口参考](./07-api-reference.md) | 全部 REST 端点与 Socket.IO 实时事件 |
| 08 | [Agent 智能体子系统](./08-agent-subsystem.md) | AI 会话阶段机、规划循环、工具系统、AI Provider |
| 09 | [Web 前端](./09-web-frontend.md) | 路由表、页面与组件、Hooks、API Client |
| 10 | [依赖关系](./10-dependencies.md) | 包间依赖图、外部依赖清单、数据流转关系 |
| 11 | [运行与测试指南](./11-running-and-testing.md) | 环境要求、安装构建、开发/生产启动、种子数据、测试、环境变量 |

## 快速开始（30 秒版）

```bash
pnpm install                 # 安装依赖（Node >= 18）
pnpm dev:server              # 启动后端 http://localhost:3000（自动建库+种子数据）
pnpm dev:web                 # 启动前端 http://localhost:5173（代理 /api 与 /socket.io 到 3000）
```

详细说明见 [11-运行与测试指南](./11-running-and-testing.md)。

## 仓库四大子包一览

```
packages/
├── shared    @en18031/shared   类型/枚举/Schema —— 前后端共享契约（零运行时依赖，仅 zod）
├── modules   @en18031/modules  内置安全检测模块（加密检查/固件密钥扫描/端口检查/默认凭据检查）
├── server    @en18031/server   Fastify 后端：REST API + Socket.IO + SQLite + 执行引擎 + AI Agent
└── web       @en18031/web      React 18 + Ant Design 5 前端（Vite 构建）
```

## 变更日志

- **v0.7（体验修复 + 流式输出 + 记忆库）**：① 人工步骤完成误报「不在等待状态」——服务重启后内存等待表丢失所致，现分三路处理（幂等成功/孤儿恢复落库并明示执行链中断/真超时维持报错），前端遇状态漂移静默重拉；② 工具调用卡片入参+输出默认折叠，运行中自动展开输出；③ 底部「AI规划记录」名不副实，重做为「Agent 工作上下文」（阶段/步骤/证据/判定概览）+「模型交互明细」两区；④ Agent 回复流式输出：provider.streamChat → plannerLoop 逐 delta 转发 → 网关与客户端白名单补 agent:message_delta → 前端缓冲条实时渲染，final 到达清空缓冲（浏览器实测 130+ delta 帧）；⑤ 记忆库落地（迁移 v12 agent_memories）：会话 done 时 LLM 非阻塞提炼 session 工作上下文与 user 偏好，新会话启动注入系统提示词，工具结果硬截断防上下文爆炸（设计文档 wiki/09）；⑥ dsh 集成代价评估：结论为现阶段局部借鉴、不整体替换（docs/dsh-integration-assessment.md）。server 97 测试全绿。
- **v0.6（口径澄清 + 叶子条款引导 + expandMode 收尾）**：① 排查 v0.5 遗留"agent 判定不计入报告"——用真实库重放证实管线无缺陷，根因是父子条款语义（章节父项不参与叶子统计）叠加验收操作误判；② 为杜绝复发，在裁定阶段系统提示词、create_verdict 工具描述、handler 返回值三层注入「必须瞄准叶子条款」引导，handler 对父项判定返回 warning 字段供模型自纠（软校验不硬拒）；③ **集成测试抓到真 bug**：template_steps 缺 expandSource/expandDims 列导致展开配置无法持久化——迁移 v11（幂等守卫）补齐存取映射，并新增编排器级集成测试 ×2（for_each_json/cartesian 走真实 startRun 全链路）。详见 05 §迁移表、06 §备注、08。
- **v0.5（expandMode + 真实 AI 全链路验收）**：① expandMode 运行时展开落地（stepExpansion.ts，见 06）；② run 房间字段核对确认本就一致（错位仅在 agent 侧，v0.3 已修），并以浏览器 WS 抓帧实测：真实会话期间收到 33 帧 / 9 类实时事件，轮询兜底不再是必需；③ Provider 栈支持 maxTokens 配置（AiProviderConfig.maxTokens → DeepSeekProvider.defaultMaxTokens），适配推理型模型（reasoning_content 计入 max_tokens 预算，建议 ≥8000，否则思考耗尽预算导致空正文）；④ 接入 opencode zen（https://opencode.ai/zen/v1，openai 协议）完成真实模型验收：Agent 全生命周期 onboarding→collection→adjudication→review→done 走通，AI 经 create_verdict 起草条款 5.1/5.1-1 判定 ×2（越界判定被确定性护栏正确拒绝），approve/reject 端点真实验证通过，报告 CONDITIONAL_PASS + AI 叙述 660 字生成。~~已知后续项：agent 模式判定未计入报告覆盖度~~（**v0.6 更正：非口径缺陷**——5.1 是章节父项，按设计不参与叶子统计；验收时误 approve 父项+reject 叶子所致。真实管线已验证：子项 5.1-1 approved 后报告正确计 pass=1）
- **v0.4（引擎补真）**：判定 DSL `js-expression` 从正则近似升级为真·受限表达式求值（safeExpression.ts：白名单解释器，变量 output/exitCode，禁 eval/new，错误安全收敛）；chain 聚合 `finalVerdict` 条件真正参与求值（orchestrator 传入 per-step 执行结果）；`TemplateStep.retry/retryBackoffMs` 自动生效（stepRetry.ts：仅 fail/timeout、线性退避、上限 5、轨迹入证据链）；`evidence-only` 映射规则不再误产出 pass=false 判定。新增 4 个测试文件 19 用例。详见 06 §判定服务。
- **v0.3（主线打通 + UX）**：前后端契约错位清零——判定审核对齐全局 approve/reject 路由；新增「人工退回补采」（retryClause：回拉 collection + 指令重启循环）与「人工补充证据」（合成 evidence_attach 步骤）两个后端端点并接入 UI；删除 resume/advance/rollback 死方法。修复 socket 加房（握手 query sessionId），实时事件真正生效。修复 mapEvidence 丢失 Agent 扩展列（clauseId/functionModule/sourceStepType）。UX：向导允许空选条款并由 Agent 对话确认范围（含引导文案）、Excel 导出新增 AI 叙述工作表。新增真实浏览器 E2E（scripts/e2e-browser.mjs，10 项断言）。详见 07 §11.4、08、09 §6-7。
- **v0.2（P1 三件套）**：经验笔记→AI 编译 Skill 闭环（表/路由/`search_skills`+`propose_skill` 工具/提示词注入/知识库页）；非阻塞通知（表/路由/铃铛 UI/会话完成沉淀建议）；AI 成文报告（narrativeModel 非阻塞生成+降级）。settings 五端点补挂鉴权。详见 05 §3、07 §11.5/§15、08 §7、09 §3-4。
- v0.1：初版 Code Wiki（12 篇全量分析）。

## 其他重要文件

| 路径 | 说明 |
| --- | --- |
| `en18031_prototype_v7.html` | v7 UI 高保真静态原型（单文件 HTML，Tailwind CDN），是 web 前端的交互蓝本 |
| `docs/en18031/` | 平台设计文档：PRD、架构、Module SDK、条款映射、编排 DSL、数据模型等 10 篇 |
| `docs/agent/` | AI Agent 可行性研究与实施计划（含评估方法总览 CSV） |
| `data/` | 运行时数据：`sqlite/app.db`、`files/{cmdruns,evidence,tmp}`、`reports/`、`logs/` |
| `pnpm-workspace.yaml` | 工作区定义；禁用 better-sqlite3/esbuild 的 postinstall 构建脚本 |
