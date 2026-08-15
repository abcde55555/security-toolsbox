# EN18031 合规测试平台 · 测试策略与质量保障

> **文档版本**：v1.0
> **产出日期**：2026-08-15
> **适用读者**：测试工程师、QA Lead、开发工程师（写单测）、合规模组开发工程师、测试 Agent 自动化执行者
> **读完后你能做的事**：按本策略分层编写测试、准备种子测试数据、执行 Milestone 验收时知道哪些 Case 必须过、条款映射准确度的判定标准是什么、回归测试如何避免漏跑。

## 1. 测试分层原则与覆盖率目标

1. 四层测试金字塔。由下至上分别是单元测试（占比 60%，快速、便宜、覆盖率主力）、集成测试（占比 25%，跨 Service + Repository + 执行引擎的真实协作）、端到端 E2E 测试（占比 10%，Playwright 模拟真实用户从浏览器到数据库全链路）、人工合规验收（占比 5%，合规模组判定结果与甲方标准逐条比对签字确认）。越往上越慢越贵，用例数量越少，严禁颠倒比例把 E2E 写成覆盖率主力。

2. 各层覆盖率阈值与门禁。单元测试：engine 层（ExecutionEngine、CommandExecutor、ModuleLoader）≥90%，services 层（7 个 Domain Service）≥80%，Repository 层 ≥70%，前端 store 与工具函数 ≥60%；阈值在 CI 中硬编码，低于则合并不允许。集成测试：Milestone 结束时按 Checklist 必须 100% 通过，不接受跳过。E2E 测试：每个 Milestone 关键路径至少有 1 条全流程用例，Milestone 2 之后每次回归必须跑。人工验收：Milestone 2 交付前必须有甲方合规负责人在条款映射评审表上签字，未签字的报告不得声称符合 EN18031。

3. 测试运行环境约定。单元测试与集成测试必须支持纯内存 SQLite 跑（`:memory:`），不依赖外部服务、不需要 root、不需要联网、执行完清理无残留，这样 CI 才能并行快；需要 nmap 等真实 CLI 的集成测试，在 CI 中单独标记为 `@needs-system-deps` 的 Job，安装依赖后独立运行，避免阻塞不需要 CLI 的用例；E2E 测试必须用 Docker Compose 起整套服务 + Playwright 专用镜像，确保每次运行环境完全一致。

## 2. 单元测试范围与必测场景

1. ExecutionEngine 单元测试必测 9 类场景。场景 1：CommandExecutor 正常执行 `echo hello`，退出码 0，stdout 正确收到 hello 行，onProgress 回调触发顺序正确。场景 2：CommandExecutor 执行 `exit 1`，status=fail，exitCode=1，ExecutionResult 形状符合契约。场景 3：CommandExecutor 执行 `sleep 60`，设置 100ms 超时，结果 status=timeout，100ms 后子进程已被 kill 不泄漏（通过 ps 或 node-pty 的 pid 是否已退出校验）。场景 4：CommandExecutor 收到 cancelToken 取消后，模组内部清理逻辑被回调，最终 status=cancelled。场景 5：ModuleLoader 加载不存在的 moduleId 抛出明确错误，不污染其他模组。场景 6：ModuleLoader 加载一个返回非标准 ExecutionResult（缺少 verdicts 字段）的模组，被 ExecutionResult 校验器拦截并写入 SDK 契约警告日志、最终 status 降级为 crash。场景 7：ModuleLoader 加载一个返回 verdict.evidenceRefs 为空数组的模组，被 ClauseMappingService 降级，pass=true 被改为 false，severity 从 low 改为 high，理由写明"判定缺失证据"。场景 8：ModuleLoader 加载一个返回 pass=true + severity=high 的 verdict，被强制改为 middle 且有警告日志（契约违规约束）。场景 9：ExecutionEngine 门面的 runCommand / runModule 两个方法都正确注入 runId、projectId、stepId 到返回值，上下文 context 必填字段缺失时报错。

2. Domain Services 单元测试（每个 Service 独立，Repository 用 mock 或内存实现）。ToolRegistryService：创建工具时自动生成 id、删除工具被模板引用时返回 1001 错误、健康状态异步更新、引用计数递增递减正确。TemplateService：模板克隆产生新 id 且步骤被正确复制、跟随模式工具升级后模板打上 upgradePending 标记、编排步骤 DAG 含环时创建失败。OrchestratorService：无依赖步骤正确并行、有依赖步骤等待前置完成后再执行、步骤失败 onFailure=abort 时下游全部 skipped、并发执行数量严格 ≤ concurrencyLimit、exportVars 正确提取 jsonpath 结果、步骤权重加权聚合进度正确。ClauseMappingService：命令级 regex 匹配到后生成 verdict 且证据引用正确、模组判定级 verdict 直接落库不被二次解析、自定义规则级不能覆盖高优先级已判定的 pass/fail、未覆盖条款按 fail 计入报告。ReportService：合规定级三档 PASS/CONDITIONAL PASS/FAIL 的阈值正确、任意一条 high severity 失败直接降级为 FAIL、not-covered 比例超 5% 触发 CONDITIONAL PASS。ProjectService：必填变量未填充时启动编排报错、变量变更自动影响后续步骤但不触发已有 run 重跑。AuthzService：即使首期全放行，每个角色的 assertRole 分支也必须有测试覆盖（用 Jest mock returnValue 模拟真实启用的情况，确保分支可达）。

3. Repository 单元测试必测 4 类。审计日志 Repository 必须不暴露 update/delete 方法（TypeScript 类型层面就没有，或者方法内部直接抛异常不允许调用，测试里调用后断言抛异常）。软删除工具后列表查询默认不返回、getById 带 includeDeleted 参数才返回。分页与排序接口 page/pageSize/sortBy/sortOrder 组合结果正确。SQL 注入防护，参数含单引号、分号时不被执行成恶意语句（better-sqlite3 / Kysely 参数化查询本身保证，但需至少一条显式用例证明不触发语法错误）。

4. 前端单元测试范围。Zustand store 的 action 对状态修改正确（例如 terminalStore 追加一行后数组长度+1、不重渲染已有行）。表单字段校验器 format=ip/cidr/port-range 对合法与非法输入结果正确。合规定级计算的纯函数（从 clauses+verdicts 到 grade）与 ReportService 后端结果一致（同一份种子数据前后端跑出来 grade 相同，测试用同一份 JSON fixture 比对）。ClauseVerdictBadge 组件按不同 status 渲染正确的颜色与文案。

## 3. 集成测试范围与 Milestone 验收 Checklist

1. Milestone 1 地基验收 5 条必须通过。集成 1-1：真实环境下调 ExecutionEngine.runModule 执行 en18031-port-check 模组，传入真实目标 IP，断言返回的 ExecutionResult.status=success、stdout 含 nmap 原始输出、evidence 数组至少 1 条、verdicts 数组至少含 clauseId=5.3-2 一条判定。集成 1-2：通过 ToolRegistryService 创建 3 个工具、1 个升级、TemplateService 引用 2 个跟随模式，升级后模板 upgradePending 标记正确写入。集成 1-3：审计日志 Repository 插入 1 条后，直接用数据库连接尝试 `UPDATE audit_logs SET action='xxx'` 被触发器拦截（断言抛 SQL 错误），证明物理约束生效。集成 1-4：AuthzService.assertRole 用四种身份（admin/template_manager/auditor/anonymous）访问每类写接口的占位校验函数，断言 Admin 通过、Anonymous 走未授权分支（即使首期内部放行也要验证分支可达且返回结构一致）。集成 1-5：ExecutionResult 校验器喂 10 种非法形状（缺字段、多字段、status 枚举错、verdict.clauseId 不存在于条款库等），每种都被拦截且写入明确的 SDK 契约警告。

2. Milestone 2 MVP 验收 7 条必须通过。集成 2-1：端到端从 API 调用"创建模板 → 引用 5 个工具 → 编排 10 步 DAG → 创建项目填变量 → POST /runs 启动整套编排 → 等待所有步骤完成"，断言最终 project_run.status=success、所有 step_run 有 stdoutFileRef、10 步中并行的 2 步实际开始时间差小于 500ms（证明确实并发）。集成 2-2：报告导出 PDF 和 Excel 两个文件实际生成、大小非 0、PDF 用 puppeteer 解析文字后断言包含"5.3-2 明文管理协议不得开放"等关键字段且与条款 verdict 结果一致。集成 2-3：步骤 exportVars 导出的 IP 列表被下一步 port-check 模组正确接收到且 params.targetIp 是对应值（变量传递链路端到端）。集成 2-4：WebSocket /ws/projects/:id/runs/:runId/stream 在执行期间按顺序收到 logLine 与 progress 消息，最终收到 batchProgress=100%，消息数量与 step_runs 预期一致。集成 2-5：故意注册一个 healthStatus=red 的工具、引用到模板、启动编排，断言该步骤 status=fail 且 reason 含"工具健康检查失败"，报告页对应条款标为 not-covered。集成 2-6：数据库行级审计日志触发器，尝试以任何方式 UPDATE/DELETE audit_logs（数据库管理员权限直连），断言被拦截且有一条专门的拦截告警日志写入系统专用告警表。集成 2-7：测试 Agent 首次自动验收：把 Milestone 2 Checklist 写成自动化脚本，运行后产出 JSON 报告，任何失败项在 GitHub 自动开 Issue assign 给对应负责人。

3. Milestone 3 体验验收 5 条必须通过。集成 3-1：长任务 nmap 全端口扫描，执行 10 秒后发 pause 请求 → 等 5 秒 → resume 请求 → 最终完成，断言最终 verdict 与不间断执行的对照组完全一致（字节级比对 stdout 哈希）。集成 3-2：健康检查触发的工具升级通知，UI 层 Playwright 模拟进入模板详情页看到红色角标、点击"确认升级兼容"按钮后角标消失、数据库 upgradePending 字段清空。集成 3-3：自定义工具注册 formFields、前端动态渲染表单、用户填参数手动执行、结果生成 evidence 与 verdict 全链路跑通（同内置模组路径复用）。集成 3-4：审计日志筛选 10 种组合条件（时间范围+工具名+状态+关键词）的返回条数与预期一致。集成 3-5：性能基准：1000 条 step_runs 的项目详情页首屏加载 ≤2 秒、终端追加 50MB stdout 不卡顿、内存占用单实例不超过 2GB。

4. Milestone 4 扩展验收 5 条必须通过。集成 4-1：权限矩阵测试脚本遍历所有写接口（共 30+ 个），4 种身份分别调用，断言返回码与文档 06 完全一致，任何不一致立即失败（含 Workspace 越权访问必须返回 9004 而不是 9002，避免泄露其他 Workspace 存在性）。集成 4-2：两个 Workspace 各建 1 个项目，Auditor 账号只能看到自己 Workspace 的项目、切换 Workspace 后列表变、交叉 API 调用全部 9004。集成 4-3：Playwright 模拟 1024×768 窄屏访问 5 个 Tab，断言页面无水平滚动条、所有按钮仍可点击（无 hidden/overflow:hidden 遮挡）。集成 4-4：版本回滚：工具改两次名（A→B→C）、回滚到 B、审计日志有记录、tool name 变回 B 且 revision 历史可查。集成 4-5：Electron 桌面壳（如已启用）启动后后端随机端口、健康检查 10 秒内 ok、关闭窗口后 5 秒内后端进程退出无残留（ps 验证）。

## 4. 端到端 E2E 测试（Playwright + Docker Compose）

1. E2E 测试的唯一真源是"用户在浏览器里能看到什么"，不绕过 UI 直接调 API。Milestone 2 起每个 Sprint 至少新增 1 条。每条用例结构严格遵循 Given-When-Then：Given 用 docker compose 起干净环境 + 插入种子数据（IoT 摄像头目标 IP、5 个工具、EN18031 L2 模板骨架、条款种子），When Playwright 按真实用户操作点击（不触发内部事件、不注入 state、所有操作走 UI 元素点击与键盘输入），Then 断言页面可见元素的文字与状态（不要断言 API 返回，断言用户实际看到的"合规定级 PASS"徽章、"5.3-2 失败"红色徽章等）。

2. Milestone 2 的关键路径 E2E 用例（必须 1 条，后续每个 Milestone 追加）。Given 一套空环境，种子数据含 IoT 摄像头目标 192.168.1.100、已注册 5 个内置模组、EN18031 L2 标准模板（编排为"主机发现→端口扫描→端口合规→弱加密→默认口令→TLS→固件→报告"8 步）。When 审计员打开浏览器、登录（首期跳过）、进入项目列表页、点击"新建项目"、选模板、填目标 IP=192.168.1.100、合规等级=L2、保存、进入项目页、点击"跑整套流程"按钮、等待终端输出完成、切换到"合规报告"Tab。Then 报告页显示"最终定级：PASS 或 CONDITIONAL PASS（根据真实目标决定，但要与手动跑 nmap 对照一致）"、5.3 网络章节有 4 条以上的判定徽章、点击"导出 PDF"后浏览器下载栏出现一个 .pdf 文件且大小>100KB、审计日志 Tab 能看到"创建项目""启动编排""完成 8 步""生成报告"共 4 条以上日志。

3. E2E 的稳定性保障。所有等待不能用 `sleep(3000)` 固定时间，必须用 Playwright 的 `locator.waitFor()` 等某个可见元素出现；长任务编排执行时用自定义的"最多等待 10 分钟，每 5 秒轮询进度条状态"的等待器；测试目标设备必须是固定不变的已知设备（或 Docker 容器模拟的 HTTP/HTTPS/Telnet 服务），不能依赖真实网络环境中会变化的设备；每条用例之间必须 `docker compose down -v && docker compose up` 完全重置数据库，不共享状态，避免用例顺序依赖。

## 5. 条款映射准确度测试（合规有效性的底线）

1. 为什么这是一类专门的测试。普通测试只断言"代码跑了没报错"，但合规测试如果"跑了但判定错了"比没跑危害更大——会误导审计员出具虚假合规报告，属于合规事故。本类测试必须由既懂 EN18031 标准又能写测试的合规模组负责人或合规专员参与 Review，不能仅靠开发写。

2. 种子条款准确度测试用例集（每个模组对应一份）。模组 port-check 准备 5 台目标虚拟机：目标 A 只开 22/443（符合 5.3-2）、目标 B 开 23（Telnet，违反 5.3-2）、目标 C 开 80 且可 HTTP 登录（违反 5.3-2 HTTP 明文管理）、目标 D 所有高危端口都关但开了 UPnP（违反 5.3-5）、目标 E 混合场景（同时 23+UPnP+80，期望 3 条失败）。5 台目标依次跑 port-check，断言每条条款的 verdict.pass 与预期一致，任何差异开 P0 Issue。

3. 模组 crypto-check 用例集：目标 A TLS 配置仅 TLS1.2+ 且套件正确（pass）、目标 B 支持 TLS1.0 + DES-CBC3-SHA（fail 且 severity=high）、目标 C 证书过期 1 天（fail）、目标 D 证书自签名但用于内网（按配置判定，默认 conditional）。同上述模式一一对照。

4. 条款映射准确度的"对照基准"。每个用例集的预期结果必须有对应的手动测试报告存档：合规模组负责人按 EN18031 标准手动用 nmap/openssl/binwalk 跑一遍，逐条写出每条条款的预期 pass/fail 和理由，签字后作为测试基线。任何一次 CI 跑条款准确度测试与基线不一致，立即视为失败，不允许调整预期去匹配实际输出，必须修改模组判定逻辑或判定规则去匹配基线。

5. 回归时的条款稳定性。版本升级后，同一份种子目标设备（或其 Docker 等价模拟）的条款判定结果必须与上一版 Bit-for-Bit 一致（verdict.pass + verdict.severity + verdict.clauseId 三项哈希不变），除非有明确的条款映射规则变更申请（走变更审批 + 审计日志），否则任何自动变化视为回归缺陷。

## 6. 测试 Agent 自动化与 GitHub Issue/PR 流程

1. 测试 Agent 触发条件。每个 Milestone 结束时（开发负责人打 Tag 前）必须触发一次专门的测试 Agent 验证；日常每个 PR 只跑单元+集成测试，Milestone 级完整 E2E + 条款准确度测试太重 PR 不跑，放到 Milestone 结束统一跑。测试 Agent 可以是单独的 CI Workflow，也可以是用 Trae 的 subagent 能力启动的专用测试会话。

2. 测试 Agent 产出物。Agent 跑完后生成一份结构化 Markdown 报告，包含：运行时间、环境版本（Node/OS/nmap 版本）、四层测试通过率的四元组、失败的 Case 列表（含步骤截图、终端输出、执行日志片段）、条款准确度通过/失败的对比表格、"是否建议进入下一个 Milestone"的结论。任何失败 Case 自动在 GitHub 仓库开 Issue，标题格式 `[Milestone X 验收失败] 模块名 · 用例名 · 一句话失败原因`，标签对应 bug/milestone-X，assignee 指定给对应模组开发负责人或模块 Tech Lead。

3. Issue 修复 → PR 合并流程。修复 Issue 必须走 feature 分支 → PR → Review 的标准流程，严禁直接合 main。PR 描述必须引用对应 Issue 号（Closes #123），PR CI 至少通过：lint/typecheck、该模块的单测全绿、回归套件中与 Issue 相关的那类 Case（用 test file filter 跑，不需要等全量 E2E）。PR Reviewer 至少一人，Milestone 1-2 由 Tech Lead 审，Milestone 3-4 可以高级工程师互审；代码合入时 Squash Merge，commit message 写清 `fix: #123 port-check 模组 5.3-2 判定误报原因修正`。

4. 回归证明要求。每个 Issue 修复 PR 中必须附带：新增一条对应失败 Case 的单测/集成测试（即"先复现失败、再修代码、再跑通"的红-绿-重构循环证明），附一张本地跑该 Case 的终端输出截图，Reviewer 可验证修复有效性，避免"修了但下次再回归"。

## 7. 性能与稳定性测试方案（Milestone 3+ 执行）

1. 并发执行压测场景。Milestone 3 后模拟 10 个审计员同时启动 10 个项目，每个项目 20 步编排，持续跑 1 小时，采集指标：P50/P95/P99 接口延迟、内存峰值（不得超过 4GB/实例）、磁盘 IO 写速率、step_run 成功率（必须 100%、不允许因引擎 bug 导致随机失败）、WebSocket 消息延迟（P99 ≤ 500ms）。

2. 大数据量稳定性。SQLite 模拟写入 10 万条 audit_logs、5 万条 step_runs、100 万条 evidences，验证列表查询分页仍 ≤1 秒、备份脚本完成时间 ≤10 分钟、归档流水线不阻塞在线查询。

3. 异常注入测试。用 chaos 工具随机 kill 执行中的 node-pty 子进程、断网 10 秒后恢复、磁盘临时满（写占位文件到 100%）后再清理，验证平台在异常后能正确恢复：相关步骤标记 crash 或 partial，审计日志连续无断点，下次启动不需要手动修复数据库（WAL checkpoint 自动处理）。

4. 浏览器端性能。Playwright 收集首屏加载时间（工具库 300 个工具卡片、项目详情 50 步编排、报告页 500 条 verdict），首屏 DOMContentLoaded ≤2 秒、LCP ≤3 秒；终端追加 10 万行 xterm.js 不卡顿（滚动 FPS ≥30）。

## 8. 测试数据种子库与 Fixture 管理

1. 三层种子数据分层。层一 core-seed：条款库 EN18031:2019 的 L1 全量 20 条 + L2 核心 30 条 + L3 示例 10 条、workspace default、默认 Admin 用户（未启用），任何环境首次启动必须存在。层二 demo-seed：5 个内置模组注册、IoT 网络扫描模板（10 步编排）、3 个示例项目（1 PASS、1 FAIL、1 running），用于 staging 演示和 E2E 测试，生产默认不导入。层三 test-fixtures：每个测试模块对应的小型 JSON/YAML fixture（例如 port-check 测试的 nmap -oX XML 原始输出样本、crypto-check 测试的 openssl s_client 输出样本），放在 `__fixtures__/` 目录与测试文件同层，纳入 Git 管理。

2. Fixture 更新原则。nmap、openssl 等 CLI 的输出版本升级后可能格式变化，Fixture 更新必须提交 PR + 附带"为什么旧 Fixture 不再有效"的说明 + 用新 Fixture 跑条款准确度测试仍通过（或对应变更有评审记录），不能随意改 Fixture 让测试变绿。

3. 敏感数据处理。所有测试 Fixture 中的 IP、域名、证书信息必须是虚构的测试数据（192.168.x.x 内网段、.test 域名、自签名证书），严禁把真实客户项目的 IP、固件、证书提交到仓库；真实客户环境的测试必须在客户现场专用实例上跑，不把结果数据带回公共 CI。
