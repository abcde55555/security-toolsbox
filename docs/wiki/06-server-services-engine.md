# 06 · server 业务服务与执行引擎（@en18031/server 中篇）

> 覆盖：`packages/server/src/services/`（13 个文件）与 `engine/`（4 个文件）。
> 服务容器装配见 [02-架构](./02-architecture.md) §5；数据层见 [05](./05-server-foundation.md)；REST 入口见 [07](./07-api-reference.md)。

## 1. 领域概念与业务全景

```
Standard(EN18031:2019)
 └─ Clause 条款树(L1/L2/L3) ─┬─ ClauseMappingRule 输出映射规则
                             └─ TemplateClauseBinding 模板条款绑定(aggregation)

Template(revision 乐观锁, mode: ad-hoc|compliance)
 ├─ TemplateVariable[] 变量声明
 ├─ TemplateStep[]     步骤 DAG(dependsOn/onFailure/verdictRule/groupKey/exportVars)
 └─ TemplateToolRef[]  工具引用(toolVersionLock locked|follow + 快照)

Tool(form=模组 | cmd=命令手册; healthStatus; referenceCount)
Project(templateId+版本快照+variables) → ProjectRun → StepRun(stepSnapshot)
                                            ├→ Evidence 证据
                                            └→ ClauseVerdict 判定 → Report 报告
CommandRun 独立命令运行(可 attach 到 project/clause)
AuditLog 几乎所有写操作的审计旁路
```

典型流程：**建模板(DAG 校验/引用计数) → 建项目(变量播种+版本快照) → preflight 预检(变量缺失/工具可用性，非致命软跳过) → startRun 编排运行(DAG 调度+判定聚合) / CommandRunner 手工命令 → 条款判定 → 人工复核/改判 → 报告(snapshot + Excel)**。

## 2. 执行引擎 engine/

### 2.1 commandExecutor.ts —— 进程级命令执行

`CommandExecutor.runCommand(command, opts): Promise<CommandResult>`：

| 机制 | 实现 |
| --- | --- |
| spawn | `spawn(command, {shell:true, detached:非Win, windowsHide})` 整串交给 shell；detached 使子进程为组长便于整组击杀 |
| 超时 | 默认 30 分钟；到点 `killProcessTree(child, true)` → status='timeout', exitCode=124（GNU timeout 惯例码） |
| 进程树击杀 | Unix `process.kill(-pid, SIGKILL/SIGTERM)` 杀进程组，失败回退 child.kill；Windows taskkill /t /f —— 防 shell 孙进程存活 |
| 取消协议 | 订阅 cancelToken.promise：触发即强杀 → 'cancelled'/130；已请求则立即返回；取消后仍 0 退出也统一改判 cancelled |
| 输出捕获 | 逐 chunk 监听 + 按行回调 `onProgress({logLine, stream})`；内存缓冲**只留尾部 2MB**（appendLimited）；`collectOutput:false` 时仅行回调（流式落盘场景） |
| 结算 | close: code===0→success 否则 fail；error(spawn 失败)→crash/1；settled/closed 双布尔保证只结算一次 |

### 2.2 executionEngine.ts —— 统一出口门面

```ts
class ExecutionEngine {
  constructor(private moduleLoader: ModuleLoader)
  runCommand(command, opts): Promise<ExecutionResult>   // 包装 executor，补 runId/时间戳，输出收敛为单条 stdout_line 证据
  runModule(moduleId, params, ctx: RunContext): Promise<ExecutionResult>
}
```

runModule 流程：moduleLoader.get 未命中 → crash(`MODULE_NOT_FOUND`)；组装 `ModuleExecuteContext`（engine.runCommand 桥接回自身，让模块能起子进程并继承 cancelToken）→ `module.execute()` 异常兜底为 crash(`UNCAUGHT_EXCEPTION`) + 全条款 fail(high) → **`sanitizeAndEnforceResult(rawResult, runId)` 做 SDK 契约清洗**（warnings 逐条 logger.warn）→ 统一盖章 runId/projectId/stepId/moduleId/toolId/时间戳。

> 引擎是纯粹的无状态执行单元：状态流转、事件、并发控制都在 orchestratorService / commandRunnerService。

### 2.3 cancelToken.ts / moduleLoader.ts

- `createCancelToken()`：闭包实现 `{isRequested, promise, cancel()}`，一次性 resolve；`alreadyCancelledToken()` 用于"生而已取消"。取消是协作式的——真正杀进程在 CommandExecutor 的订阅里完成。
- `ModuleLoader`：私有 `Map<string, BaseModule>`；`loadBuiltins()` 动态 import('@en18031/modules')（失败仅 warn 不阻断启动）；`register()` 先过 `moduleConfigSchema.safeParse` 再检查 execute 是函数；查询 get/has/list/listConfigs（has 被 preflight 与调度器用于"模组未加载→软跳过"判断）。

## 3. 服务层逐个说明

### 3.1 基础设施类

| 文件 | 内容 |
| --- | --- |
| errors.ts | `AppError{code,message,details,httpStatus}` + 工厂对象 `Errors.*`（notFound/conflict/toolReferenced/templateInUse/variablesMissing/cycle/invalidStep/toolUnhealthy/clauseInvalid…），中文文案 |
| context.ts | `ServiceContext{repos, engine, moduleLoader, bus, userId}` + `BUS_EVENTS` 常量表（5 个事件名） |
| authzService.ts | ROLE_RANK 匿名0<auditor1<template_manager2<admin3；getCurrentUser 硬编码 local-admin/admin；assertRole any-of，AUTH_ENABLED=false 时放行 |
| redact.ts | 正则命中 password/passwd/secret/token/apikey/api_key/credential/private_key 的环境变量值替换 '***'（工具审计脱敏 redactEnvVars） |

### 3.2 orchestratorService.ts —— 编排核心（约 1100 行）

**startRun(projectId, {stepIds?, concurrencyOverride?, fromStepId?})**：
变量合并（项目变量+模板默认补缺）→ 步骤裁剪（白名单/从指定步骤按原顺序切片）→ DAG 校验 → **硬闸门**：工具 healthStatus==='red' 直接抛 toolUnhealthy（与 preflight 软跳过形成对比）→ createRun（snapshotVariables）+ 每 step 建 StepRun（stepSnapshot 冗余定义，模板后续修改不影响进行中的 run）→ 合规模板先 initComplianceRun 清信号表 → fire-and-forget executeRun。

**driveScheduler —— 事件驱动 tick 调度器**：
- 依赖门槛：依赖未全终态等待；依赖出现 fail/fail_abort_triggered/timeout/cancelled → 本步置 skipped（失败传播）；
- `onFailure==='abort'` 的步骤失败 → 全局 abortTriggered，其后所有 pending 置 skipped；
- 并发按 `concurrencyLimit` 门控；
- **加权进度** percent = Σ(w×percent)/Σw，ETA = 平均时长×剩余数，emit `run:batchProgress{projectId,runId,percent,eta}`；
- 每 tick 轮询 cancelToken 双保险；
- 成功且声明 exportVars → `extractExportVars` 存入 stepOutputs 供下游插值。

**executeSingleStep**：
1. `substituteObject(step.params, projectVariables, templateDefaults, stepOutputs)` 三作用域插值（project.*/template.*/step.<id>.<field>），missing 非空 → fail(`UNRESOLVED_PLACEHOLDER`)；
2. form 工具未加载 → cancelled「已跳过」（软跳过）；
3. 分派：form → engine.runModule；cmd → buildCommandForStep（具名 ToolCommand 渲染优先，legacy `path --flag value` 兜底，shellQuote 白名单 `/^[a-zA-Z0-9_./:@%+=,-]+$/`）→ engine.runCommand（timeoutMs 缺省 config.executionTimeoutMs）；
4. persistResult：stdout/stderr 整文写 `files/evidence/{stepRunId}.stdout.log|.stderr.log` 登记 fileRef；调用 clauseMapping.processAndPersist（合规模式步骤自带 verdictRule 时 skipMapping 避免重复判定）+ recordComplianceSignal。

**合规定罪流水 finalizeComplianceVerdicts**：
- 信号表 `complianceSignals: Map<runId, Map<stepId,{pass,severity?,reason}>>`（来自 evaluateStepVerdict 对 verdictRule 求值）；
- `dedupeGroupedSteps`：合规模式下 `${clauseId}::${groupKey}` 相同的步骤共享一次执行（首个为 owner，其余 ephemeral 并依赖 owner）；
- 按 clauseId 分组取 clauseBindings 的 aggregation 聚合出每条款最终判定 insertVerdict（verdictGroup=`clause:${clauseId}`），并发 `[条款 X] ✓通过/✗不通过` 日志行。

**retryStep**（手动重试，也是 retry 策略的唯一落地）：新建 StepRun（retryOf 链保留历史）→ 以每 stepId 最新尝试重建整图验 DAG → `computeDescendants` 求**传递闭包下游**全部重置 pending 重跑 → run 回 running。

**finishRun**：只用最新尝试聚合——有 fail/fail_abort_triggered → fail；有 timeout/partial → partial；并非全 success/skipped → partial；否则 success。

**其他**：cancelRun（token+DB cancelRequested 双保险）、runToolManually（项目内手动执行工具，triggerMode='manual'）、rebuildStepOutputs（重试场景从 stdoutFileRef 重抽导出变量）、extractExportVars 四型规则（field/regex/jsonpath 轻量点路径含 key[n] 与 key[*]/file）。

### 3.3 commandRunnerService.ts —— 命令手册运行器

与 executor 的分工：executor 管 spawn/超时/取消/捕获；本服务管**参数渲染校验、队列限流(MAX_CONCURRENCY=8 信号量)、日志落盘、DB 状态机、socket 事件、结果锚定项目**。

- `start(toolId, commandId, body)`：schema 校验 → 平台闸门(cmd.platforms) → applyDefaults → validateFormValues → rawKeys 防注入黑名单 `/[;|&$`<>\n\r{}()\\!#]/` → renderCommandTemplate 渲染 resolvedCommand → commandRuns.create → 审计 → 后台 execute。
- `execute`：日志流式追加 `data/files/cmdruns/{runId}.stdout.log|.stderr.log`；超时钳制 ≤600s；logLine → 写文件 + emit `run:logLine`（Socket.IO 实时终端数据源）；结束 markFinished(stdoutPreview 尾 4KB)。
- **重启自愈 reconcileOrphans**：构造时把 listRunning() 遗留全部改判 cancelled/130(`INTERRUPTED`)。
- `processProjectResult`：带 projectId 且成功时补建 triggerMode='manual_command' 的 ProjectRun/StepRun 锚点走条款映射，并重新生成报告。
- `cancel/get(尾部 200KB 回读)/list/waitFor/attachToProject`。

### 3.4 toolRegistryService.ts —— 工具注册中心

create/update/delete（builtin 只读禁改禁删；删除前 countReferences 检查 → toolReferenced）/references；**registerBuiltinModule(config)**：内置模组进入关系库的唯一入口（upsert builtin:true）；**runHealthCheck(id)**：跑 healthCheck 命令（默认 5s），timeout→yellow、退出码≠0→red、成功则正则抽版本号与 tool.version 比对定 green/yellow，finally emit `tool:health`；recalculateReferenceCounts 全量对账。

### 3.5 templateService.ts / projectService.ts

- **TemplateService**：validateDag（唯一 stepId/依赖存在/DFS 环检测 Errors.cycle）；create/update 维护引用计数差分与版本快照（locked 无快照补当前 version）；clone（深拷贝+inheritParent 父子链）；confirmUpgrade（follow→locked 或刷新快照清 upgradePending）；notifyToolUpgrade（markUpgradePending 通知链路）；coverage（覆盖率 = module 条款 ∪ mapping 规则覆盖 vs 标准全集，返回 covered/uncovered/百分比）。
- **ProjectService**：create（模板必须存在；变量=模板默认∪入参；templateVersionSnapshot；创建时不强制必填变量）；update 带 variables 时做必填校验（variablesMissing 3001）；**preflight** 返回 `{ready, variables:{ok,missing,empty}, tools:[available/healthStatus], skippedSteps, warnings}` —— form 工具可用 ⇔ moduleLoader.has；工具不可用非致命进 skippedSteps。

### 3.6 clauseMappingService.ts —— ExecutionResult → Evidence + Verdict

`processAndPersist` 两条互斥路径：
- **路径 A（模组自带 verdicts）**：证据先入库 → verdict 校验条款存在（无效审计 clause.verdict.invalid 并丢弃）→ evidenceRefs 下标映射成证据 id（越界剔除/空回退首条）→ 自动降级两规则（无证据 → pass=false/high「判定缺失证据」；pass+high → middle）→ verdictGroup=stepRunId。
- **路径 B（无模块判定，走 ClauseMappingRule）**：按 priority 降序对 `stdout+'\n'+stderr` 匹配 matchRule（contains/regex/**js-expression —— v0.4 起为真·受限表达式求值**，safeExpression.ts 白名单解释器：变量 `output`/`exitCode`，支持正则 test/includes/match、逻辑比较算术；禁 eval/new/未知标识符，任何错误安全收敛 false）→ 命中合成 assertion 证据 + 判定 `pass = onMatch==='verdict-pass'`（**v0.4 修正：evidence-only 仅沉淀证据不再产出 pass=false 判定**）。

另有 listClauses/validateClauseExists/**overrideVerdict**（人工改判入口，审计 clause.verdict.override）。

### 3.7 reportService.ts —— 报告与定级

- `generateReport(projectId, runId?)`：条款全集按目标等级（≤语义）→ **只统计 reviewStatus=approved 判定**（AI 草稿被排除）→ 每条款取最新判定 → 父章节节点不计入叶子指标 → ReportSummary{applicable/pass/fail/notCovered/byChapter/failBySeverity}；
- **ReportGrade 算法**（优先级降序）：高危失败>0 → FAIL；未覆盖率>5% → CONDITIONAL_PASS；有失败 → ≤10% CONDITIONAL_PASS 否则 FAIL；有未覆盖 → CONDITIONAL_PASS；否则 PASS；适用条款=0 → INCOMPLETE；
- `exportExcel`（exceljs 三个 sheet：报告摘要 / 条款判定详情(PASS\|FAIL\|NOT_COVERED) / 章节通过率），文件名 `EN18031-report-{name}-{id8}.xlsx` 存 reportsDir，sha256 后二次存档 format:'excel'；
- `renderReportHtml`：自包含 HTML（转义防注入、父章自叶子上卷判定、打印适配）；
- 循环依赖解法：文件尾 `setReportService()` 单例桥，orchestrator/commandRunner 动态 import。

### 3.8 verdictEvaluator.ts —— 判定 DSL 纯函数求值器

| 函数 | 职责 |
| --- | --- |
| `evaluateStepVerdict(rule, result)` | kind='module'：取 result.verdicts 中 mapClauseId 匹配项；kind='command'：拼接 stdout+stderr，**先判 fail 条件再判 pass 条件**（exitCode 精确匹配/contains/regex，safeRegexTest 吞异常），都不中返回 null |
| `aggregateClause(agg, signals, skipped, results?)` | cross_check：any_pass/any_fail/majority(**平票按失败**)/all_pass 投票，失败严重度取最重(sevRank)；chain：有 skipped 直接 fail；**v0.4 起 results（stepId→ExecutionResult）由 orchestrator 传入，finalVerdict 条件真正参与求值**，不传时保持旧兜底 |
| `evaluateChainFinal(rule, results, skipped)` | FinalCondition 三型求值（exit_code eq/ne；contains/regex 支持 negate） |

> 实现现状备注：~~chain finalVerdict 空 Map 未求值~~、~~step.retry/retryBackoffMs 未被自动消费~~ 均已于 v0.4 解决——orchestratorService 新增 complianceResults 缓存并传入聚合；executeSingleStep 经 stepRetry.executeWithRetry 消费 retry 配置（仅 fail/timeout 重试、线性退避 backoff×次数、上限钳 5、重试轨迹写入证据链）。~~expandMode 仅建模存储~~ 已于 v0.5 解决：`stepExpansion.ts` 在 start 路径建 step_run 前做运行时展开——for_each_json 按 expandSource 变量（数组/JSON 数组字符串）逐项生成实例并注入 `{{item}}/{{item.字段}}/{{index}}`；cartesian 对 expandDims 各变量做笛卡尔积（元素同时以变量名与 item.<名> 暴露）；实例 stepId=`原id#k`、groupKey 加 `#i<k>` 后缀防折叠；依赖按序号配对上游实例；单步上限 100 截断；展开说明经 run:logLine 写入时间线。

## 4. 事件与落盘约定小结

| 总线事件 | 发射点 | 房间 |
| --- | --- | --- |
| run:logLine | orchestrator（编排步骤）与 commandRunner（手工命令） | run:{runId} |
| run:progress / run:status | 同上（步骤级与运行级） | run:{runId} |
| run:batchProgress | orchestrator driveScheduler/finishRun（加权进度+eta） | run:{runId} |
| tool:health | toolRegistryService.runHealthCheck finally | 全局 |

落盘目录三处分工：`files/cmdruns/{runId}.*.log`（手工命令流式追加）、`files/evidence/{stepRunId}.*.log`（编排证据整文写）、`reports/*.xlsx`（Excel 报告）。

一致性设计：重启自愈（reconcileOrphans 把中断态改判 cancelled/INTERRUPTED）、乐观锁（tools/templates expectedRevision）、引用计数与软删除联动、审计全覆盖（project.*/template.*/tool.*/command_run.*/run.*/clause.verdict.*/report.generate）。
