# 项目工作台 API（GET /api/projects/:id/workbench）

> 供 ui-eng 直接对接。端点实现于 `packages/server/src/routes/projects.ts`，
> 聚合与建议推导在 `packages/server/src/services/workbenchService.ts`，分支测试见
> `packages/server/src/__tests__/projectWorkbench.test.ts`。
>
> **nextSuggestion 字段口径以 docs/ux-redesign-plan.md §4.3 的 8 级优先级规则表为准**：
> 服务端按同表求值并输出主建议（本端点），前端 `useNextAction` 仅在 workbench
> 不可用/字段缺失时走客户端回退。

## 1. 现有 API 面盘点：工作台一屏原来要发几次请求

"项目工作台"一屏需要的数据目前分散在以下端点（前端按依赖串行/并行发起）：

| 数据 | 现有端点 | 备注 |
| --- | --- | --- |
| 项目本体 + 最新运行 | `GET /api/projects/:id` | 返回 `{...project, latestRun}` |
| 运行历史 | `GET /api/projects/:id/runs` | ProjectDetail 页加载即取 |
| 最新运行的步骤 | `GET /api/projects/:id/runs/:runId/steps` | 需先拿到 latestRun.id（串行第 2 跳） |
| 步骤详情+证据+判定 | `GET /api/projects/:id/runs/:runId/steps/:stepRunId` | 每个步骤一次（N+1） |
| Agent 会话列表 | `GET /api/agent/sessions?projectId=` | 含 status/phase |
| 每会话步骤 | `GET /api/agent/sessions/:id/steps` | 每会话一次（N+1） |
| 人工待办 | `GET /api/agent/human-todos` | 全局列表，前端需自行按项目过滤 |
| 待审核判定草案 | `GET /api/agent/projects/:projectId/pending-verdicts` | |
| 项目证据计数 | 无直接端点 | 只能逐步骤拉 evidences 再数 |
| 最新报告 | `GET /api/projects/:id/reports/latest` + `GET .../reports/:reportId` | 两跳 |

**合计：一屏至少 6~10+ 次请求**（含两处 N+1、一处全局列表过滤、报告两跳），且
"下一步该做什么"完全由前端拼装。新聚合端点把以上数据压成 **1 次请求**。
现有端点全部保留不变，聚合端点是纯增量（只读）。

## 2. 端点定义

```
GET /api/projects/:id/workbench
权限: auditor（与其它项目读接口一致；authEnabled=false 时放行）
成功: 200 { code: 0, message: 'ok', data: WorkbenchPayload }
失败: 404 { code: 9004, message: "项目 '<id>' 不存在" }
```

## 3. 响应字段字典（类型与空值语义）

### 顶层 WorkbenchPayload

| 字段 | 类型 | 空值语义 | 说明 |
| --- | --- | --- | --- |
| `project` | `Project` | 永不为 null（404 兜底） | 项目全量字段，同 `GET /api/projects/:id` 的 project 部分 |
| `latestRun` | `ProjectRun \| null` | **null = 该项目从未运行过**（无任何 project_run 行） | 按 startedAt 最近的一条；agent 触发的运行也计入 |
| `sessions` | `Array<WorkbenchSession>` | 空数组 = 项目下没有 Agent 会话 | 按 createdAt 倒序，最多 50 条；元素见下表 |
| `humanTodos` | `Array<WorkbenchHumanTodo>` | 空数组 = 本项目没有未完成人工步骤 | 本项目各会话的未完成人工步骤（跨会话汇总）；全局列表已按项目过滤 |
| `verdictDrafts` | `Array<ClauseVerdict>` | 空数组 = 没有 pending_review 判定 | reviewStatus=pending_review 的判定草案全量（本项目） |
| `evidenceCount` | `number` | 0 = 无证据 | 该项目 evidences 表总条数（COUNT，非分页长度） |
| `latestReport` | `Report \| null` | **null = 从未生成过报告** | isLatest=1 的报告（含 grade/summary/narrative，narrative 可缺省） |
| `nextSuggestion` | `WorkbenchSuggestion` | 永不为 null（兜底 R8） | 服务端推导的下一步建议，见 §4 |

### sessions 元素（WorkbenchSession = AgentSession 扩展）

| 字段 | 类型 | 空值语义 | 说明 |
| --- | --- | --- | --- |
| （继承 AgentSession 全部字段） | — | — | 含 `status`、`phase`、`selectedClauses`、`rollbackCount` 等；`projectRunId` 在会话创建即有值 |
| `status` | `'planning' \| 'running' \| 'waiting_human' \| 'waiting_confirm' \| 'review' \| 'done' \| 'aborted' \| 'error'` | 必有 | planning/running/waiting_confirm/review/waiting_human 为未终态 |
| `phase` | `'onboarding' \| 'collection' \| 'adjudication' \| 'review'` | 必有 | 会话阶段机 |
| `pendingHumanStepCount` | `number` | 0 = 该会话当前无未完成人工步骤 | ★ 扩展字段；与 humanTodos 一致口径 |
| `projectName` | `string \| undefined` | 缺省 = 项目已被软删等极端情况 | listSessions 联查附带 |
| `finishedAt` | `string \| undefined` | 缺省 = 会话未结束 | 终态会话才有 |

### humanTodos 元素（WorkbenchHumanTodo）

| 字段 | 类型 | 空值语义 | 说明 |
| --- | --- | --- | --- |
| `stepRunId` | `string` | 必有 | 人工步骤 run id（完成待办时用它调 complete 接口） |
| `sessionId` | `string` | 必有 | 所属会话 |
| `sessionName` | `string` | 非空字符串 | 指令前 40 字摘要（会话名未持久化，后端生成） |
| `instruction` | `string` | 可为空串 | 完整人工指令 |
| `phase` | `string \| null` | null = 步骤未记录阶段 | 产生该步骤时的会话阶段 |
| `updatedAt` | `string` | 可为空串 | COALESCE(startedAt, finishedAt, '') |

## 4. nextSuggestion：§4.3 八级规则的服务端求值

**结构 WorkbenchSuggestion：**

| 字段 | 类型 | 空值语义 |
| --- | --- | --- |
| `priority` | `1\|2\|3\|4\|6\|7\|8` | 必有；命中的规则行号。**5 由服务端保留但永不返回**（见下） |
| `action` | 见下方动作表 | 必有；机器可读动作名 |
| `title` | `string` | 必有；主按钮文案，已含计数/百分比动态片段，可直接渲染 |
| `reason` | `string` | 必有；一句话依据（副标题/tooltip） |
| `runId` | `string \| undefined` | 仅 action=monitor_run(模板 run) 或 generate_report 时存在 |
| `percent` | `number \| undefined` | 仅 monitor_run 且目标为模板 run 时存在；agent 会话目标时缺省 |
| `sessionId` | `string \| undefined` | monitor_run(agent 目标)/handle_human_todos 时存在 |
| `todoStepRunId` | `string \| undefined` | 仅 handle_human_todos 时存在（高亮卡片用） |
| `verdictCount` | `number \| undefined` | 仅 review_verdicts 时存在（= verdictDrafts.length） |
| `verdictId` | `string \| undefined` | 仅 review_verdicts 时存在（首条草案 id） |
| `reportId` | `string \| undefined` | 当前服务端不会设置（generate_report 只在报告缺失/过期时给出，此时无 id；export_report 不产出）。保留给未来扩展 |
| `gapCount` | `number \| undefined` | 仅 fix_preflight 时存在 |
| `missingVariables` | `string[] \| undefined` | 仅 fix_preflight 时存在；**可为空数组**（缺口全部来自工具） |
| `templateId` | `string \| undefined` | 仅 fix_preflight/start_run 时存在（项目绑定模板 id） |

**规则表（取第一个命中）：**

| # | 条件 | action | title（示例） | 附加字段 |
| --- | --- | --- | --- | --- |
| 1 | 存在进行中的执行 | `monitor_run` | 「运行中 · {percent}%」/「Agent 会话进行中」 | runId+percent 或 sessionId |
| 2 | humanTodos 非空 | `handle_human_todos` | 「{n} 个人工步骤等你处理」 | sessionId, todoStepRunId |
| 3 | verdictDrafts 非空 | `review_verdicts` | 「{n} 条判定待你审核」 | verdictCount, verdictId |
| 4 | latestRun 已终态且报告缺失/过期 | `generate_report` | 「生成合规报告」 | runId |
| 5 | 报告存在且有未导出标记 | `export_report` | —— **服务端不产出** | — |
| 6 | 预检有缺口 | `fix_preflight` | 「修复预检问题（{n}）」 | gapCount, missingVariables, templateId |
| 7 | 无 run 且模板就绪 | `start_run` | 「开始测试」 | templateId |
| 8 | 兜底 | `agent_or_config` | 「发起 Agent 会话 / 配置变量」 | — |

**服务端口径说明（两点细化，联调时注意）：**

1. **R1「非终态 run」按有效执行判定**：agent 触发的 project_runs 行在会话结束后
   不会被收尾（只有 orchestrator 写 run 状态），因此其是否"进行中"以绑定会话状态
   为准——会话处于 planning/running/waiting_confirm/review 视为进行中（action 目标
   是会话页，带 sessionId 不带 runId）；waiting_human 不算运行中，交由 R2/R8 处理。
   模板编排触发（triggerMode≠agent）的 run 仍按 run.status 判定。
2. **R5 服务端不产出 export_report**：reports 表无"已导出"标记列且禁止改 schema，
   导出状态目前是纯前端概念。该规则仅在前端 useNextAction 回退路径生效；服务端
   最多跳过 R5 直接落到 R6/R7/R8。

**R6 缺口的计算口径（廉价只读版，区别于 GET /preflight）：**
`gapCount = 缺失/空的必填模板变量数 + 引用了不存在工具或存储健康状态为 red 的步骤数`。
不执行任何健康检查命令（避免聚合端点产生进程派生副作用）；需要完整预检仍调
`GET /api/projects/:id/preflight`。

## 5. 前端对接建议

- 工作台首屏只需 `GET /api/projects/:id/workbench` 一次；主按钮 =
  `nextSuggestion.title`，点击路由：
  - `monitor_run`(runId) → `/projects/:id?tab=execution`（可取消）；(sessionId) → `/sessions/{sessionId}`
  - `handle_human_todos` → `/sessions/{sessionId}` 并 scrollIntoView 高亮 `todoStepRunId`
  - `review_verdicts` → 判定审核视图（定位首条 `verdictId`）
  - `generate_report` → POST `/api/projects/:id/reports {runId}`
  - `fix_preflight` → PreflightModal / 变量 Tab
  - `start_run` → PreflightModal → startRun
  - `agent_or_config` → 发起 Agent 会话入口（`/sessions/new?projectId=`）/ 变量 Tab
- `reason` 用于副标题/tooltip；不要在前端重复实现推导逻辑；
  `useNextAction` 回退仅在 workbench 请求失败或 `nextSuggestion` 缺字段时启用。
- KPI 条可直接取自本响应：适用条款/通过/失败/未覆盖 = `latestReport.summary.*`
  （null 时显示 0 或"—"）、证据数 = `evidenceCount`、待审数 = `verdictDrafts.length`。
- 实时更新继续走既有 Socket.IO 房间（`run:{runId}` / `agent:{sessionId}`），
  事件到达后再重新拉本端点刷新即可。明细页（步骤 stdout/stderr、事件回放等）
  仍用原有端点。
