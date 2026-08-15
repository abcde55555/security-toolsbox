# EN18031 合规测试平台 · 执行编排与模板流程 DSL

> **文档版本**：v1.0
> **适用读者**：OrchestratorService 开发工程师、模板管理员、高级审计员
> **读完后你能做的事**：设计一个能跑通"主机发现→端口枚举→版本探测→合规模组→报告生成"完整流水线的模板，按步骤依赖与并发执行，理解变量传递与产物引用。

## 1. 编排设计的三个原则

1. 显式依赖优于隐式顺序。不要把步骤序号 1、2、3、4 当作执行顺序，必须显式声明每个步骤的 dependsOn 集合；这样才能支持第 2、3 步无依赖时并行跑，才能把 DAG 的拓扑排序权交给 OrchestratorService，而不是写死在模板上。

2. 失败策略在步骤级声明，不是全局一刀切。"端口扫描失败就终止整套流程"和"单个弱加密 cipher 检测失败继续跑后面的固件分析"显然不同，每个步骤必须可配置 onFailure 枚举 abort、continue、retry。

3. 步骤之间的变量传递必须可追溯。第 4 步的参数如果来自第 1 步的输出，必须通过声明式的 `{{step.stepId.output.field}}` 占位符引用，不能要求模组开发者通过全局状态或文件路径去猜；OrchestratorService 在跑前做占位符校验，找不到来源的占位符直接报错而不是带着空值跑。

## 2. 模板编排根结构（TemplateFlow）

字段 schemaVersion 固定字符串 'v1'，用于后续 DSL 升级兼容；字段 name、字段 description；字段 variables 对象，描述模板声明的"项目级必填变量集"，每个变量含 label 展示名、type 枚举 text/number/ip/cidr/list、required 布尔、default 可空、format 同 SDK 文档，例如 targetIp、targetCidr、complianceLevel、targetList 这些，模板跑前 OrchestratorService 会校验 Project Variables 面板是否把必填变量填完；字段 steps 数组，见下一节；字段 concurrencyLimit 数字，默认 2，表示同批可并行的步骤数量上限，审计员在执行时可以临时覆盖但不得超过模板配置的 1.5 倍，避免瞬间打爆目标或本机。

## 3. 步骤对象 Step

字段 stepId 字符串，模板内唯一，驼峰命名，如 hostDiscovery、portScan、portCompliance；字段 title 展示名；字段 toolId 字符串，引用全局工具库；字段 toolVersion 字符串或 'latest' 或 'locked'；字段 interactionModeOverride 可空，默认按工具定义，如模组支持 cmd 和 form 两种模式可在此强制切换；字段 params 对象，按工具 formFields 或命令模板的占位符填，支持变量占位符；字段 selectedCommands 数组，命令行型工具用，选中的预设命令 id 列表或 'all'；字段 dependsOn 字符串数组，引用其它 stepId；字段 onFailure 枚举 abort 立即中止整个编排流程、continue 继续执行后续步骤、retry 重试；字段 retry 数字，onFailure=retry 时必填，最大重试次数，默认 3；字段 retryBackoffMs 数字，重试间隔毫秒，默认 2000；字段 timeoutMs 数字，单步骤超时，不填则继承工具默认超时或全局 30 分钟；字段 exportVars 对象，可选，定义如何从本步骤执行结果中抽出变量供给后续步骤引用，每个 key 是变量名（如 discoveredHosts），每个 value 是一个提取表达式对象，type 枚举 jsonpath、regex、field、file，参数由具体 type 决定，例子 { type: 'jsonpath', path: '$.discovered.hosts[*].ip' }。

## 4. 变量占位符与作用域

1. 占位符风格。统一 mustache 风格 `{{scope.name.field...}}`，只支持三种 scope。project 作用域，对应项目变量面板的用户赋值，例 `{{project.targetIp}}`；template 作用域，对应 TemplateFlow.variables 中声明了 default 值的变量，例 `{{template.complianceLevel}}`；step 作用域，对应前置步骤 exportVars 导出的变量，例 `{{step.hostDiscovery.discoveredHosts}}`。

2. 作用域查找优先级。当一个变量名同时存在于 project 和 template 作用域时，project 覆盖 template；step 作用域必须写明 stepId，不存在命名冲突问题。

3. 解析时机。project 和 template 作用域在编排启动前一次性解析完毕；step 作用域的占位符不能在启动前解析，必须在 dependsOn 指定的所有步骤都成功完成后，轮到该步骤执行的前一刻才解析；如果引用的 step 失败，则所有依赖它的步骤自动置为 skipped 状态，不会尝试解析。

4. 列表型变量的批量展开。如果 `{{step.hostDiscovery.discoveredHosts}}` 实际值是长度 12 的 IP 数组，而本步骤 params 中 targetIp 填的是这个占位符，有两种展开策略由步骤字段 expandMode 声明：默认 cartesian（笛卡尔积）表示将该步骤复制成 12 份，每份一个 IP，按并发度排队跑；可选 for_each_json 表示把整个数组作为一个 JSON 字符串传给该步骤，由模组或命令内部处理。

## 5. 产物引用与文件传递

1. 文件型变量导出。步骤 A 解包固件产出一个 bin 文件路径，步骤 B 要拿这个 bin 去跑 binwalk，不能用占位符写相对路径；通过 exportVars 的 type=file，OrchestratorService 在工作目录建立一个 StepRunId 命名的子目录，导出的文件路径是绝对路径且带哈希，后续步骤引用的是这个绝对路径，不会因为工作目录切换而找不到。

2. 产物保留策略。每个步骤执行后默认保留所有 stdout/stderr 和导出的文件；若某步骤只需要中间产物，可设置字段 ephemeral=true，整个项目的所有步骤全部 PASS 后，OrchestratorService 清理 ephemeral 步骤的临时文件，但 evidence 不受影响仍保留。

## 6. 执行状态与流转枚举

每个步骤实例 StepRun 的状态枚举：pending 等待执行中；scheduled 已入执行队列；running 正在跑；success 成功；fail 失败且 onFailure=continue；fail_abort_triggered 失败并触发整批中止；skipped 因前置依赖失败跳过；timeout 超时；cancelled 用户取消；partial 部分成功，后续步骤可继续但报告页标黄。

整批次 ProjectRun 的状态枚举：pending、running、success、fail、partial、cancelled、aborted。

## 7. DAG 构建与拓扑排序算法要点

1. 合法性校验。编排启动前必须做三件事：检查 stepId 是否唯一；检查 dependsOn 是否引用不存在的 stepId；检查是否存在环，若环存在直接报错拒绝启动。

2. 初始就绪集合。所有 dependsOn 为空的步骤是第一批就绪集合。

3. 运行时调度。维护一个 running 计数器，上限是 concurrencyLimit；只要 running < concurrencyLimit 且就绪集合非空，就挑一个执行；一个步骤 success 或 fail+continue 后，检查它的所有下游步骤，其所有依赖都已完成且成功，则加入就绪集合；如果依赖里有任何一个 fail 且该步骤 onFailure=abort，下游全部置为 skipped。

## 8. 执行进度聚合

1. 单步骤进度。来自模组的 onProgress.percent 或命令型自定义估算（按已输出行数 vs 预估总行数、或超时时间线性估算兜底）。

2. 整批进度。整批 ProjectRun 的进度 = sum(每个 StepRun.weight × StepRun.percent) / sum(所有 StepRun.weight)；每个步骤 weight 默认 1，可在 Step 上配置，长任务（如全端口扫描、固件解包）推荐权重 3~5，保证进度条不"前面很快后面卡死"。

3. ETA 估算。整批 ETA = 已耗时 × (100 / 当前进度 - 1)；并随进度每超过 10% 更新一次系数，避免早期估算严重偏离。

## 9. 编排 UI（v7 原型补充）

1. 模板编排页。左栏是当前引用的工具卡片拖拽源（或点击"→ 添加为步骤"按钮，首期不强求拖拽）；中间是步骤列表，每步有序号、标题、关联工具、状态徽章、依赖标签（显示"依赖 portScan"）、上下移动按钮（仅调整显示顺序，不影响实际依赖关系但影响 Orchestrator 显示顺序）；点击一个步骤展开右侧的步骤配置抽屉（params、dependsOn 多选框、onFailure、timeout、exportVars、weight、expandMode 等所有字段）。

2. 执行进度页（项目侧）。Project 页在「工具详情」和「报告」Tab 之间新增「编排进度」Tab，显示 DAG 概览（拓扑图或时间轴，首期用时间轴即可），每一步显示当前状态色、运行耗时、进度条、异常状态的详情展开，且提供单步骤重试、单步跳过、整批取消、整批暂停（P1 能力）控制。

## 10. 持久化与可恢复

1. 断点续跑。ProjectRun 每一步完成后立刻持久化 StepRun 结果；如果中途应用崩溃或机器断电，重启后打开项目可看到进度停在哪一步并支持"从第一个未成功的步骤继续跑"或"从头跑"或"从 step X 继续"。

2. 不可重跑污染的保护。历史 StepRun 结果永远不覆盖；用户点"重试某步骤"时生成一个新的 StepRun 并带 retryOf 字段指向旧 StepRun，条款报告页在合并 verdict 时按项目策略取最新或取最差，不会丢失历史证据。

## 11. 一个最小完整流程 DSL 示例

给出一个 6 步完整流程的 DSL JSON 片段，作为模板作者的参考样板。步骤一 hostDiscovery，使用内置模组 host-scan，依赖空，params 取 `{{project.targetCidr}}`，exportVars 导出 discoveredHosts；步骤二 portScan，使用 nmap，依赖 hostDiscovery，params 中 targetIp 填 `{{step.hostDiscovery.discoveredHosts}}` 并 expandMode=cartesian；步骤三 versionDetect，使用 nmap 脚本集，依赖 portScan，exportVars 导出 serviceVersions；步骤四 portCompliance，使用 en18031-port-check 表单交互模组，依赖 portScan，params 中端口列表填 `{{step.portScan.openPorts}}`；步骤五 cryptoCompliance，使用 en18031-crypto-check，依赖 versionDetect；步骤六 reportCompile，这是一个虚拟步骤，标记"所有前置完成后自动生成报告快照"，type 设为 virtual，dependsOn 包含 step3、4、5，无实际执行逻辑但触发报告服务写入一次 ProjectReportSnapshot。
