# 项目工作台 API（GET /api/projects/:id/workbench）

> 供 ui-eng 直接对接。端点已实现于 `packages/server/src/routes/projects.ts`，
> 聚合逻辑在 `packages/server/src/services/workbenchService.ts`，分支测试见
> `packages/server/src/__tests__/projectWorkbench.test.ts`。

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
"下一步该做什么"完全由前端拼装。

新聚合端点把以上数据压成 **1 次请求**，并给出服务端推导的 `nextSuggestion`。
现有端点全部保留不变，聚合端点是纯增量。

## 2. 端点定义

```
GET /api/projects/:id/workbench
权限: auditor（与其它项目读接口一致；authEnabled=false 时放行）
成功: 200 { code: 0, message: 'ok', data: WorkbenchPayload }
失败: 404 { code: 9004, message: "项目 '<id>' 不存在" }
```

### 响应结构（WorkbenchPayload）

```jsonc
{
  "project": { /* Project 全量字段，同 GET /api/projects/:id 的 project 部分 */ },
  "latestRun": { /* ProjectRun | null，最近一次运行（含 agent 触发的运行） */ },
  "sessions": [
    {
      /* AgentSession 全量字段（含 status、phase、selectedClauses、rollbackCount…） */
      "status": "waiting_human",       // planning|running|waiting_human|waiting_confirm|review|done|aborted|error
      "phase": "collection",           // onboarding|collection|adjudication|review
      "pendingHumanStepCount": 1       // ★ 扩展字段：该会话未完成人工步骤数
    }
  ],                                    // 按 createdAt 倒序，最多 50 条
  "humanTodos": [                       // 该项目各会话未完成的人工步骤（跨会话汇总）
    {
      "stepRunId": "…",
      "sessionId": "…",
      "sessionName": "指令前 40 字摘要",
      "instruction": "请插入 U 盘并拍照",
      "phase": "collection",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "verdictDrafts": [ /* ClauseVerdict[]，reviewStatus=pending_review 的判定草案 */ ],
  "evidenceCount": 12,                  // 该项目 evidences 总条数
  "latestReport": { /* Report | null，isLatest 的报告（含 grade/summary/narrative） */ },
  "nextSuggestion": {
    "action": "handle_human_todos",     // 见下方动作表
    "title": "处理人工待办",             // 可直接做主按钮文案
    "reason": "有 1 个人工步骤等待你处理，会话正在等待结果。",
    "sessionId": "…",                   // 可选，按 action 而定
    "todoStepRunId": "…",               // 可选，handle_human_todos 时存在
    "verdictId": "…",                   // 可选，review_verdicts 时存在
    "reportId": "…"                     // 可选，view_report 且已有报告时存在
  }
}
```

## 3. nextSuggestion 推导规则（优先级从高到低）

| # | 条件 | action | 附加字段 | title |
| --- | --- | --- | --- | --- |
| 1 | 项目下没有任何 Agent 会话 | `create_session` | — | 创建 Agent 会话 |
| 2 | 有 `waiting_human` 会话或 humanTodos 非空 | `handle_human_todos` | sessionId, todoStepRunId | 处理人工待办 |
| 3 | 有进行中会话（planning/running/waiting_confirm/review） | `follow_session` | sessionId | 跟进运行中的会话 |
| 4 | verdictDrafts 非空 | `review_verdicts` | verdictId | 审核判定草案 |
| 5 | 有 done 会话或已有最新报告 | `view_report` | reportId（有报告时） | 查看/生成评估报告 |
| 6 | 兜底（如只剩 aborted/error 会话且无报告） | `create_session` | — | 新建 Agent 会话 |

前端落地建议：

- 主按钮 = `nextSuggestion.title`，点击路由：
  - `create_session` → 新建会话页（带 projectId）
  - `handle_human_todos` → 会话页 `/agent/sessions/{sessionId}` 并定位待办卡片 `todoStepRunId`
  - `follow_session` → `/agent/sessions/{sessionId}`
  - `review_verdicts` → 会话页审核面板（首条 `verdictId`）
  - `view_report` → 报告页（`reportId` 缺省表示需先生成）
- `reason` 用于副标题/tooltip；不要在前端重复实现推导逻辑。

## 4. 对接后可省掉的请求

工作台首屏只需 `GET /api/projects/:id/workbench` 一次；
实时更新继续走既有 Socket.IO 房间（`run:{runId}` / `agent:{sessionId}`），
事件到达后再重新拉本端点刷新即可。其余明细页（步骤 stdout/stderr、事件回放等）
仍用原有端点。
