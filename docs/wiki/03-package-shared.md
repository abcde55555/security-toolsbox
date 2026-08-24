# 03 · shared 共享包（@en18031/shared）

> 位置：`packages/shared` · 版本 1.0.0 · 唯一运行时依赖 `zod`
> 定位：**前后端共享契约层**。以 TypeScript 源码直出方式发布（`main/types/exports` 直接指向 `src/index.ts`，无需构建），被 server、web、modules 三包共同依赖，保证类型与校验规则单一来源。

## 1. 导出结构

```
src/
├── index.ts     # re-export 全部 + 通用工具：nowIso/uuid/占位符提取/命令模板渲染/变量插值
├── enums.ts     # 30 个 const 数组枚举（as const + 派生 union type）
├── types.ts     # 50+ 领域接口 + ERROR_CODES 错误码表
└── schemas.ts   # zod Schema + 校验函数（格式校验/模块契约双层防线）
```

## 2. 枚举清单（enums.ts）

全部采用 `const ARR = [...] as const; export type X = typeof ARR[number]` 模式：

| 枚举 | 成员 | 用途 |
| --- | --- | --- |
| `EXECUTION_STATUSES` | success / fail / timeout / crash / partial / cancelled | 单次执行终态 |
| `STEP_RUN_STATUSES` | pending / scheduled / running / success / fail / fail_abort_triggered / skipped / timeout / cancelled / partial | 步骤运行状态机 |
| `PROJECT_RUN_STATUSES` | pending / running / success / fail / partial / cancelled / aborted | 项目运行状态 |
| `PROJECT_STATUSES` | draft / running / success / fail / partial / cancelled | 项目状态 |
| `COMMAND_RUN_STATUSES` | pending / running / success / fail / timeout / crash / cancelled | 工具库命令运行 |
| `HEALTH_STATUSES` | green / yellow / red / unknown | 工具健康灯 |
| `TOOL_TYPES` | module / custom | 内置模块 vs 自定义命令工具 |
| `INTERACTION_MODES` | form / cmd | 表单交互 vs 命令行交互 |
| `VERSION_LOCK_MODES` | locked / follow | 模板对工具版本的锁定策略 |
| `FAILURE_STRATEGIES` | abort / continue / retry | 步骤失败策略 |
| `COMPLIANCE_LEVELS` | L1 / L2 / L3 | EN18031 合规等级 |
| `SEVERITIES` | high / middle / low | 严重度 |
| `USER_ROLES` | admin / template_manager / auditor / anonymous | 角色模型 |
| `EVIDENCE_TYPES` | stdout_line / assertion / validation_error / file_pointer / screenshot | 证据类型 |
| `FORM_FIELD_TYPES` | text / number / textarea / select / checkbox / multiselect / file / stepper | 动态表单字段类型 |
| `FIELD_FORMATS` | plain / ip / cidr / port-range / hostname / path | 字段格式（驱动前端校验） |
| `MATCHER_TYPES` | regex / contains / js-expression | 条款映射匹配器 |
| `ON_MATCH_ACTIONS` | verdict-pass / verdict-fail / evidence-only | 匹配命中动作 |
| `REPORT_FORMATS` | pdf / excel / snapshot | 报告格式（当前实现 excel） |
| `REPORT_GRADES` | PASS / CONDITIONAL_PASS / FAIL / INCOMPLETE | 报告总评等级 |
| `TOOL_CATEGORIES` | network-compliance / crypto-compliance / credential-compliance / firmware-analysis / authentication / reconnaissance / device-interaction / other | 内置工具分类 key |
| `AGENT_PHASES` | onboarding / collection / adjudication / review | Agent 会话四阶段 |
| `AGENT_SESSION_STATUSES` | planning / running / waiting_human / waiting_confirm / review / done / aborted / error | 会话状态 |
| `STEP_TYPES` | tool_exec / human_instruction / evidence_attach / analysis | Agent 步骤类型 |
| `VERDICT_REVIEW_STATUSES` | pending_review / approved / rejected / skipped | AI 判定人工复核状态 |
| `NOTIFICATION_TYPES` | tool_sediment / skill_sediment / evidence_gap / template_save / config_fix / review_hint | 通知类型 |
| `NOTIFICATION_STATUSES` | unread / read / accepted / dismissed / snoozed | 通知状态 |
| `AGENT_EVENT_TYPES` | model_message / tool_call / tool_result / human_step / phase_change / verdict_draft / notification / error / user_message | Agent 事件流类型 |
| `SKILL_STATUSES` | draft / approved / archived | 技能沉淀状态 |
| `PROJECT_MODES` | template / agent_guided | 项目驱动模式 |

## 3. 核心类型（types.ts）

### 3.1 API 通用

- `ApiEnvelope<T>`：统一响应信封 `{ code, message, data, meta?{paging} }`；`ApiError {code,message,details?}`；`Paging {total,page,pageSize,totalPages}`。
- `ERROR_CODES` 常量表：`OK:0`；通用错误 `9001 未授权 / 9002 禁止 / 9003 校验失败(兼 invalid host) / 9004 未找到 / 9005 冲突 / 9999 内部`；业务错误 `1001 工具被引用 / 2001 模板使用中 / 3001 项目变量缺失 / 4001 编排环 / 4002 非法步骤 / 4003 工具不健康 / 5001 条款非法 / 6001 报告生成失败`。

### 3.2 工具与模块契约（SDK 核心）

- `FormField`：动态表单字段（id/label/type/required/format/regex/min/max/options/accept/maxSizeMb/steps 多步表单）。
- `ModuleConfig`：模块声明 —— `{ id, name, version, sdkVersion, type:'module', interactionMode:'form', tags, category, healthCheck?, formFields, clauses: ModuleClauseDecl[], path?, envVars? }`。`clauses` 声明该模块覆盖的条款（clauseId/title/severity）。
- `BaseModule`：模块实现契约 —— `readonly config: ModuleConfig` + `execute(params, context): Promise<ExecutionResult>`。
- `ModuleExecuteContext`：引擎注入的执行上下文 —— `{ projectId, stepId, userId, variables, onProgress(p: CommandProgress), cancelToken: CancelToken, engine.runCommand(command, opts) }`。模块自身也能通过 `engine.runCommand` 发起子命令（nmap/openssl 等）并享受超时/取消/进度回调。
- `CancelToken`：`{ promise: Promise<void>, isRequested: boolean }` 取消令牌。
- `ToolCommand`：自定义工具命令模板 `{ id, name, commandTemplate, params: FormField[], rawParams?, relatedClauses?, timeoutMs?, workingDir?, envVars?, requiresRoot?, platforms? }`。
- `Tool`：完整工具实体（含 referenceCount、healthStatus/healthMessage/healthCheckedAt、builtin、revision 乐观锁、软删除 deletedAt）。

### 3.3 执行结果链

- `Evidence`：`{ type: EvidenceType, content, severity, path?, hash? }`。
- `ClauseVerdictOutput`：模块返回的单条判定 `{ clauseId, pass, reason, severity, evidenceRefs: number[] }` —— refs 指向 evidence 数组下标。
- `ExecutionResult`：执行结果总装 `{ runId, projectId?, stepId?, toolId?, moduleId?, status, exitCode, stdout, stderr, durationMs, startedAt, finishedAt, evidence[], verdicts[], error? }`。
- `ExecutionError`：`{ code, message, stack? }`。

### 3.4 模板与编排 DSL

- `Template`：`{ id, workspaceId, name, mode: 'ad-hoc'|'compliance', variables: TemplateVariable[], concurrencyLimit, steps: TemplateStep[], toolRefs: TemplateToolRef[], clauseBindings: TemplateClauseBinding[], parentTemplateId?, inheritParent?, revision, ... }`。
- `TemplateStep`：步骤全量声明 —— 工具绑定（toolId/toolVersion）、参数（params）、依赖 DAG（dependsOn）、失败策略（onFailure）、retry/retryBackoffMs/timeoutMs、输出变量导出（exportVars: `Record<string, ExportVarRule>`，规则 type ∈ jsonpath/regex/field/file）、权重 weight、展开模式 expandMode（cartesian 笛卡尔积 / for_each_json 逐 JSON 展开）、ephemeral、position、合规模式专属的 `clauseId`、`verdictRule`、`groupKey`。
- `StepVerdictRule`（判定 DSL 第一层，步骤级）：
  - `{ kind:'module', mapClauseId? }` —— 模块自带 verdict，按 clauseId 取用；
  - `{ kind:'command', passOnExitCode?, passOnOutputContains?, passOnOutputRegex?, failOnExitCode?, failOnOutputContains?, failOnOutputRegex?, severity? }` —— 命令型工具用退出码/输出特征判定。
- `ClauseAggregation`（第二层，条款级聚合）：
  - `cross_check` 并联投票：strategy ∈ all_pass / any_pass / any_fail / majority；
  - `chain` 串联链：按 dependsOn 顺序执行、上游失败则下游跳过且条款 fail，由 `finalVerdict: FinalVerdictRule` 终裁。
- `FinalVerdictRule` / `FinalCondition`：可视化终裁条件 —— `passAll[]` 必须全满足、`failAny[]` 任一即败；条件类型 `exit_code(step,eq/ne,value)`、`output_contains(step,value,negate?)`、`output_regex(step,value,negate?)`。

### 3.5 运行时记录

- `Project` / `ProjectRun`（progressPercent、cancelRequested、snapshotVariables）/ `StepRun`（stepSnapshot 保存执行时的步骤快照；stdoutFileRef/stderrFileRef 指向落盘日志；Agent 扩展字段 stepType/phase/functionModule/instruction/expectedOutcome/artifacts/agentSessionId）。
- `ClauseVerdict`：落库判定（evidenceRefs 为字符串 id；`overridden/overrideReason` 人工覆盖；Agent 复核扩展 reviewStatus/reviewedBy/reviewedAt/reviewNote/aiGenerated）。
- `CommandRun` / `CommandRunDetail`：命令直跑记录（resolvedCommand 解析后的实际命令、stdoutPreview、stdout/stderr 文件引用）。
- `Report` / `ReportSummary`：报告实体与统计（applicable/pass/fail/notCovered/conditional、byChapter 分布、failBySeverity）。
- `Standard` / `Clause` / `ClauseNode` / `ClauseMappingRule` / `AuditLog` / `User` / `AuthUser`。

### 3.6 Agent 与配置

- `AgentSession`：设备档案 deviceProfile、selectedClauses、authorizedTools、phase/status、planningModel/narrativeModel、rollbackCount、lastError。
- `AgentEvent`：会话事件流（seq 序号、type、role/content、toolName/toolArgs/toolStatus、model/tokenUsage/latencyMs）—— append-only 存储。
- `Artifact`：`type ∈ device_profile | network_topology | onboarding_result | other`。
- `KnowledgeNote` / `Skill`：知识笔记与技能沉淀（skillKey、frontmatter、sourceNoteIds、isCurrent、status 草稿→批准→归档）。
- `Notification`：站内通知（type、payload、snoozedUntil 等）。
- `AiProviderConfig` / `AiProviderInput`：多 Provider 配置 —— `protocol: 'openai'|'anthropic'`、baseUrl、apiKey（API 返回时脱敏）、planningModel/narrativeModel 双模型、timeoutMs、maxRetries、isActive、hasKey（仅表示「已配 key」非连通性）。

## 4. Zod Schema 与校验防线（schemas.ts）

### 4.1 格式校验工具（被前后端共用）

```ts
ipV4Regex / cidrRegex / portRangeRegex          // 正则常量
isValidIp(s) / isValidCidr(s) / isValidPortRange(s) / isValidHostname(s)
validateFieldFormat(format, value): string|null // 按 FIELD_FORMATS 校验值
validateFormValues(fields, values)              // 按 FormField[] 批量校验表单值
```

### 4.2 实体 Schema

`severitySchema`、`executionStatusSchema`、`healthStatusSchema`…（枚举镜像）、`formFieldSchema`（递归 `z.lazy`，支持 steps 多步表单）、`moduleConfigSchema`、`moduleClauseDeclSchema`、`healthCheckConfigSchema`。

**`toolCommandSchema`**（重点）：在基础字段上用 `.superRefine()` 做「模板↔参数一致性」校验：
- `commandTemplate` 中每个 `{{placeholder}}` 必须在 `params[].id` 中有对应形参；
- 反向检查 `rawParams` 引用的形参存在；
- 占位符名只允许 `[A-Za-z0-9_-]`（防注入的第一道闸）。

**`executionResultSchema` + 双层防线函数**：
- `validateExecutionResult(raw)`：schema 校验后追加语义规则 —— ① 每条 verdict 的 `evidenceRefs` 不能为空；② refs 下标不得越界（必须指向真实 evidence）；③ `pass=true` 时 severity 不允许为 high。返回 `{valid, errors, data?}`，**只报错不修改**。
- `sanitizeAndEnforceResult(raw, fallbackRunId)`：**修复式降级** —— 无效 refs 的 verdict 强制降级为 `pass=false, severity='high', reason='判定缺失证据'`；`pass=true+severity=high` 改为 middle；非法 status 降级为 crash；缺失字段补默认值。返回 `{result, warnings}`。两者构成「严格验收 + 容错兜底」的双保险，供 ModuleLoader 在调用第三方/不可信模块时选用。

其余：`customToolCreateSchema` / `customToolUpdateSchema`（自定义工具创建更新）、`commandRunStartSchema` / `commandRunAttachSchema`(挂载到项目/条款)、`evidenceSchema` / `verdictOutputSchema` / `executionErrorSchema`。

## 5. 通用工具函数（index.ts）

| 函数 | 签名要点 | 说明 |
| --- | --- | --- |
| `nowIso()` | `(): string` | ISO 时间戳（仓库统一时间格式） |
| `uuid()` | `(): string` | 优先 `crypto.randomUUID`，退化手写 v4 |
| `extractPlaceholders(tpl)` | `string[]` | 提取 `{{name}}` 占位符（去重） |
| `renderCommandTemplate(tpl, params, opts?)` | → `{command, missing, unused}` | **安全插值**：默认 shellQuote（白名单字符集 `A-Za-z0-9_@%+=:,./-` 直通，否则单引号包裹转义）；`rawKeys` 可豁免引号；布尔 false/空串渲染为空（用于开关型 flag）；返回缺失/未用参数便于上层告警 |
| `renderTemplateString(str, project, templateVars?, stepOutputs?)` | → `{value, missing}` | 三作用域插值：`{{project.x}}` / `{{template.x}}`(回落 project) / `{{step.stepId.field}}`（取上游步骤导出变量），支持多级属性访问，缺失记入 missing |
| `substituteObject(obj, ...同上)` | 深度递归版本 | 对任意对象/数组/字符串做整体插值 |

> 这组函数是编排系统变量体系的地基：orchestratorService 在调度每个步骤前用它把 params/commandTemplate 中的占位符替换为项目变量、模板变量和上游步骤输出。
