# EN18031 合规测试平台 · 数据模型与 API 接口清单

> **文档版本**：v1.0
> **适用读者**：全栈开发工程师、后端架构师、前端联调工程师
> **读完后你能做的事**：按本文建表、按 REST 接口实现前后端对接；在接口层正确保留用户管理权限钩子；理解 Electron 单机版和 C/S 版的 API 差异如何通过一层适配器平滑过渡。

## 1. 设计约束与版本策略

1. 接口形态。首期 Electron 单机版可直接走进程内 Service 调用，但接口形状必须与 REST 完全一致（方法名、参数结构、返回结构、错误对象），由 IPC 适配层做薄封装，保证切 C/S 时 Controller 代码零修改。

2. 返回统一信封。所有成功响应统一返回 { code: 0, message: 'ok', data: <payload>, meta: { paging? } }；失败响应 { code: <非零错误码>, message: <人类可读原因>, details: <可选结构化错误明细> }；前端只按 code 是否为 0 判成功，不按 HTTP 状态码判。

3. 分页约定。所有列表接口支持 query 参数 page 默认 1、pageSize 默认 20、sortBy 默认 createdAt、sortOrder 默认 desc；返回 meta 中填 total、page、pageSize、totalPages。

4. 错误码分段。1 位业务前缀 3 位序号；1xxx 工具库、2xxx 模板、3xxx 项目、4xxx 编排执行、5xxx 条款映射、6xxx 报告、9xxx 通用（鉴权、参数、未找到、权限不足）；例子 9001=未授权、9002=权限不足、9003=参数校验失败、9004=资源不存在、9005=并发冲突。

5. 授权钩子。所有接口的 Controller 层第一行调用 `AuthzService.assertRole(req, requiredRoles)`；首期实现可以放行，但 requiredRoles 必须写对，后续接用户系统时不需要再逐个补接口。

## 2. 数据表清单（实体与核心字段）

1. tools 工具表。字段 id 主键；workspaceId 默认 default；name；type module/custom；interactionMode form/cmd；version semver；author；description；tags 数组 JSON；category；path；envVars JSON；healthCheck JSON；formFields JSON 数组；clauses JSON 数组（本模组可能判定的条款声明）；referenceCount 数字；healthStatus 枚举 green/yellow/red/unknown；healthMessage 可空；healthCheckedAt；createdAt；updatedAt；deletedAt 软删除。

2. templates 模板表。id；workspaceId；name；description；icon；color；schemaVersion 编排 DSL 版本；variables JSON 数组（必填变量声明）；concurrencyLimit；createdBy；createdAt；updatedAt；deletedAt。

3. template_tools 模板-工具引用表。id；templateId；toolId；toolVersionLock 枚举 locked/follow；toolVersionSnapshot 当 locked 时保存版本号；selectedCommands JSON 数组；stepParams JSON；createdAt。

4. template_steps 模板编排步骤表。id；templateId；stepId 模板内唯一；title；toolId；toolVersion；interactionModeOverride；params JSON；selectedCommands JSON；dependsOn 数组 JSON；onFailure；retry；retryBackoffMs；timeoutMs；exportVars JSON；weight；expandMode；ephemeral；position 显示顺序。

5. projects 项目表。id；workspaceId；name；description；templateId；templateVersionSnapshot；standardVersion EN18031 版本；targetComplianceLevel L1/L2/L3；variables JSON（用户赋值的项目变量）；status 枚举 draft/running/success/fail/partial/cancelled；createdBy；createdAt；updatedAt；finishedAt；deletedAt。

6. project_runs 项目执行批次表。id；projectId；status；startedAt；finishedAt；startedBy；progressPercent 0~100；eta；triggerMode 枚举 manual/scheduled/retry；cancelRequested 布尔；snapshotVariables JSON（执行当时的变量快照）。

7. step_runs 步骤执行实例表。id；projectRunId；stepId；stepSnapshot JSON（执行当时的步骤定义快照，防止模板变更污染历史）；status；startedAt；finishedAt；retryOf 可空；exitCode；stdoutFileRef；stderrFileRef；durationMs；error JSON；evidenceCount；verdictCount。

8. evidences 证据表。id；stepRunId；projectRunId；type；content 或 fileRef；hash；severity；createdAt。

9. clause_verdicts 条款判定表。id；stepRunId；projectRunId；projectId；clauseId；pass 布尔；severity；reason；evidenceRefs JSON；overridden 布尔；overrideReason；createdAt；verdictGroup 同一步多次重试时相同。

10. clauses 条款库表。clauseId 复合主键（standardVersion+clauseId）；standardVersion；chapter；title；description；level；testingMethod；defaultSeverity；parentId；tags JSON；createdAt；updatedAt。

11. clause_mapping_rules 命令级映射规则表。id；toolId；commandId；clauseId；matcherType；pattern；onMatch；severityOverride；priority；createdAt。

12. audit_logs 审计日志（append-only）。id；workspaceId；userId；action 枚举；entityType；entityId；before JSON 可空；after JSON 可空；ip；userAgent；createdAt。数据库层禁止 UPDATE/DELETE。

13. reports 报告表。id；projectId；projectRunId 可空；format pdf/excel/snapshot；fileRef；hash；grade；summary JSON；generatedBy；generatedAt；isLatest 布尔。

14. users 用户表（首期预留，不做 UI）。id；workspaceId；username；email；passwordHash；role 枚举 admin/template_manager/auditor；status；lastLoginAt；createdAt；updatedAt。

15. workspaces 工作空间表（首期默认 default，不做多租户 UI）。id；name；slug；status；createdAt。

## 3. 工具库 API（前缀 /api/tools）

1. GET /api/tools。列表，query 支持 keyword、type、interactionMode、category、healthStatus、tag、page、pageSize、sortBy、sortOrder。权限最小 auditor。

2. GET /api/tools/:id。详情。权限 auditor。

3. POST /api/tools。创建。权限 admin。Body 形状同表字段，必填校验 name+type+interactionMode+path。

4. PUT /api/tools/:id。更新。权限 admin。Body 同 POST。

5. DELETE /api/tools/:id。删除。权限 admin。实际执行软删除；被模板引用时返回错误码 1001"存在引用，不可删除，可改为禁用"。

6. POST /api/tools/:id/health-check。主动触发一次 --version 校验，异步任务，立即返回 taskId；结果通过 WebSocket 或 GET /api/tasks/:taskId 查询。权限 template_manager 及以上。

7. GET /api/tools/:id/references。查询哪些模板引用了本工具。权限 template_manager。

## 4. 模板 API（前缀 /api/templates）

1. GET /api/templates。列表。权限 auditor。

2. GET /api/templates/:id。详情含 template_tools、template_steps 内嵌。权限 auditor。

3. POST /api/templates。创建模板（含工具引用与步骤可在 body 中一次性传入，后端写事务）。权限 template_manager。

4. PUT /api/templates/:id。更新。权限 template_manager。

5. DELETE /api/templates/:id。删除，软删除。权限 template_manager；若存在正在运行的项目引用则返回 2001。

6. POST /api/templates/:id/clone。克隆，body { newName, inheritParent }，inheritParent=true 时写入 parentTemplateId 字段，后续继承变更通知。权限 template_manager。

7. POST /api/templates/:id/confirm-upgrade。当某工具在跟随模式下升级后，模板有 upgradePending 标记，通过此接口确认兼容或切换为 locked 模式。权限 template_manager。

8. GET /api/templates/:id/diff/:fromRevision/:toRevision。模板变更前后 diff，给审核用。权限 auditor。

## 5. 项目 API（前缀 /api/projects）

1. GET /api/projects。列表。权限 auditor。

2. GET /api/projects/:id。详情含变量、最近一次 run 状态。权限 auditor。

3. POST /api/projects。创建，body { templateId, name, targetComplianceLevel, variables }。权限 auditor。

4. PUT /api/projects/:id。改名、改变量。权限 auditor。

5. DELETE /api/projects/:id。删除软删。权限 template_manager。

6. GET /api/projects/:id/runs。历史批次列表。权限 auditor。

7. GET /api/projects/:id/variables。项目变量单独接口。权限 auditor。

8. PUT /api/projects/:id/variables。批量修改变量。权限 auditor。

## 6. 编排与执行 API（前缀 /api/projects/:id/runs，执行实时事件走 WebSocket）

1. POST /api/projects/:id/runs。启动一批执行。body { stepIds?, concurrencyOverride?, fromStepId?, resumeRunId? }，stepIds 空表示跑全部启用步骤；fromStepId 表示断点续跑；resumeRunId 表示续跑指定旧批次；返回 { runId }。权限 auditor。

2. POST /api/projects/:id/runs/:runId/cancel。申请取消。Orchestrator 向所有 running 的 StepRun 发 cancelToken，不保证立即生效。权限 auditor。

3. POST /api/projects/:id/runs/:runId/pause。P1 能力，暂停。权限 auditor。

4. POST /api/projects/:id/runs/:runId/resume。P1 能力，继续。权限 auditor。

5. POST /api/projects/:id/runs/:runId/steps/:stepRunId/retry。单独重试某一步（必须是 aborted/failed/skipped 状态）。权限 auditor。

6. GET /api/projects/:id/runs/:runId。批次详情，含进度、所有 StepRun 状态摘要。权限 auditor。

7. GET /api/projects/:id/runs/:runId/steps。StepRun 列表。权限 auditor。

8. GET /api/projects/:id/runs/:runId/steps/:stepRunId。单步骤详情含 stdout/stderr 片段 + evidences 分页列表。权限 auditor。

9. WebSocket /ws/projects/:id/runs/:runId/stream。订阅执行实时流。消息类型 logLine（终端一行）、progress（步骤进度）、status（步骤状态变）、batchProgress（批次进度）。权限 auditor。

## 7. 执行引擎单步 API（单工具手动执行用，项目页 Tab1 切工具时用，前缀 /api/projects/:id/tools）

1. POST /api/projects/:id/tools/:toolId/execute-cmd。命令型单次手动执行。body { commandId, commandOverride?, params, timeoutMs }。返回 { runId, stepRunId }。权限 auditor。

2. POST /api/projects/:id/tools/:toolId/execute-module。表单型模组单次手动执行。body { params }。返回同上。权限 auditor。

3. POST /api/tools/:toolId/cancel/:sessionId。手动执行的中断接口。权限 auditor。

## 8. 条款库与映射 API（前缀 /api/clauses）

1. GET /api/clauses。条款列表，query 必须带 standardVersion。权限 auditor。

2. POST /api/clauses/batch-import。批量导入条款库（JSON 或 Excel）。权限 admin。

3. PUT /api/clauses/:standardVersion/:clauseId。更新单条条款。权限 admin。

4. GET /api/clause-mapping-rules。映射规则列表按 toolId/commandId 查询。权限 template_manager。

5. POST /api/clause-mapping-rules。新建。权限 admin。

6. PUT /api/clause-mapping-rules/:id。更新。权限 admin。

7. DELETE /api/clause-mapping-rules/:id。删除。权限 admin。

8. POST /api/projects/:id/clause-verdicts/override。项目级临时覆盖 verdict，触发审计日志。权限 template_manager。

## 9. 报告 API（前缀 /api/projects/:id/reports）

1. GET /api/projects/:id/reports/latest。获取最新快照报告的数据对象（不含导出文件），返回 { grade, summary, chapterVerdicts, appendix, generatedAt }。权限 auditor。

2. POST /api/projects/:id/reports/snapshot。手动触发生成报告快照，即使没有全部跑完也能生成"未完整"报告。权限 auditor。

3. GET /api/projects/:id/reports/:reportId/export。流式导出 PDF 或 Excel，query { format, includeEvidenceFiles }。权限 auditor。注意长任务建议用异步任务模式，避免请求超时。

4. GET /api/projects/:id/reports。历史报告列表。权限 auditor。

## 10. 日志与审计 API（前缀 /api）

1. GET /api/audit-logs。查询审计日志。权限 admin。支持 query：action、entityType、entityId、userId、时间范围、keyword、page、pageSize。严禁提供删除和修改接口。

2. GET /api/projects/:id/logs。项目侧的筛选日志查询。权限 auditor。query 支持 status、toolId、stepId、时间范围、keyword。注意只是查询视图，日志实体不变。

## 11. 用户管理与鉴权 API（首期预留，Controller 层空实现或本地配置版，不做 UI）

1. POST /api/auth/login。body { username, password }。返回 { token, user: { id, username, role } }。首期 token 可为 JWT 或 Electron 本地内存 session。

2. POST /api/auth/logout。返回 200。

3. GET /api/auth/me。查询当前登录用户信息。首期返回默认 { id: 'local-admin', username: 'Admin', role: 'admin' }。

4. GET /api/users。用户列表。权限 admin。首期返回默认单用户。

5. POST /api/users。创建用户。权限 admin。首期接口存在但实现可抛 9002"未开放"，避免误操作。

6. PUT /api/users/:id/role。改角色。权限 admin。首期同上。

7. GET /api/workspaces。工作空间列表。首期返回仅 default。

## 12. Web-First 部署形态与适配器

1. 标准部署。Node.js 独立后端进程，推荐 Linux 服务器，承担 RESTful API + WebSocket 推送 + 命令/模组执行引擎 + 持久化；前端打包为静态资源，可由后端直接托管或挂 Nginx 反代；数据库首期 SQLite 文件存储（单实例、≤10 并发下足够），并发上来后平滑迁移到 PostgreSQL；文件证据与报告导出用本地文件系统目录，后期切对象存储；鉴权用 JWT + 真正的权限中间件打开 assertRole 逻辑。

2. 便携桌面壳（Electron 可选项，非首期范围）。需要离线单台电脑审计时，用 Electron 包装同一套 Node 后端 + 前端静态资源；主进程起 127.0.0.1 随机端口 HTTP/WS 服务，渲染进程访问本地 URL；WebSocket 消息结构、REST 接口、Service 层代码零修改，Electron 壳只做启动器与窗口管理。

3. 为什么以 Web-First 为主。保证 Linux 无头环境可部署（合规测试服务器绝大多数是 Linux）、多人协作零门槛（浏览器直接访问内网 URL 即可）、审计报告在线分享无需安装客户端；Electron 只是"同一套后端打包方式不同"的附加能力，不会因为包装方式造成业务代码分叉。
