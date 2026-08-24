# 07 · API 接口参考

> 全部路径前缀 `/api`；响应统一信封 `ApiEnvelope {code, message, data, meta?{paging}}`（`code=0` 为成功）。
> 角色列 = `requireRole(...)` preHandler；角色等级 `anonymous(0) < auditor(1) < template_manager(2) < admin(3)`，断言为 any-of「实际等级 ≥ 要求」。当前默认身份硬编码 `local-admin`(admin)，且 `AUTH_ENABLED=false` 时校验直接放行。

## 0. 路由层通用机制（routes/helpers.ts）

| 函数 | 行为 |
| --- | --- |
| `ok(reply, data, paging?)` | 成功响应；传 paging 时追加 `meta.paging {total,page,pageSize,totalPages}` |
| `fail(reply, code, message, httpStatus?, details?)` | 失败响应 `{code,message,details?}` |
| `parseBody(schema, body)` | zod safeParse，失败拼 `path: message` 抛 `AppError(9003,…,400)` |
| `handleError(reply, err)` | 统一出口：AppError 按其码值；裸 ZodError→9003/400；其他→9999/500 |
| `pagingFromQuery(query)` | page≥1 默认 1；pageSize 夹在 [1,200] 默认 20 |
| `requireRole(role|roles)` | 角色 preHandler（authzService.getCurrentUser + assertRole，附着 req.user） |

错误码表（@en18031/shared ERROR_CODES + services/errors.ts 工厂）：

| code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200 | 成功 |
| 9001 | 401 | 未授权 |
| 9002 | 403 | 权限不足 / invalid host |
| 9003 | 400 | 参数校验失败（含上传超限、Host 非法） |
| 9004 | 404 | 资源不存在 |
| 9005 | 409 | 冲突（乐观锁 stale、重复 id、状态非法等） |
| 1001 | 409 | 工具被模板引用不可删除 |
| 2001 | 409 | 模板存在运行中项目不可删除 |
| 3001 | 400 | 项目变量缺失 |
| 4001/4002 | 400 | 编排环依赖 / 非法步骤 |
| 4003 | 400 | 工具不健康 |
| 5001 | 400 | 条款非法 |
| 9999 | 500 | 内部错误兜底 |

## 1. 健康检查

| 方法 路径 | 说明 |
| --- | --- |
| GET `/api/health` | 免角色。返回 `{status:'ok', version:'0.1.0', time}` |

## 2. tools.ts —— 工具与分类（15 个）

| 方法+路径 | 角色 | 用途与要点 |
| --- | --- | --- |
| GET `/api/tool-categories` | auditor | 分类列表 |
| POST `/api/tool-categories` | admin | 新建分类 `{label}`（key 缺省取 label，key 自动归一化小写连字符；重复 409） |
| PUT `/api/tool-categories/:key` | admin | 改名 |
| DELETE `/api/tool-categories/:key` | admin | 删除（内置禁删；下属工具自动回落 other，返回 reassigned 数） |
| POST `/api/tool-categories/:key/reorder` | admin | 上移/下移 `{dir:-1|1}`（相邻交换 sortOrder） |
| GET `/api/tools` | auditor | 分页列表：query `keyword,type,interactionMode,category,healthStatus,tag` + paging |
| GET `/api/tools/:id` | auditor | 详情 |
| POST `/api/tools` | admin | 创建自定义工具（zod customToolCreateSchema：commands 占位符↔参数一致性 superRefine 校验） |
| PUT `/api/tools/:id` | admin | 更新（**乐观锁**：body.revision 过期 → 409「已被其他地方修改」） |
| DELETE `/api/tools/:id` | admin | 删除（被模板引用 → 409/code 1001） |
| POST `/api/tools/:id/health-check` | template_manager | 执行 healthCheck 命令并 setHealth，bus 发 `tool:health` |
| GET `/api/tools/:id/references` | template_manager | 被模板引用清单 |
| GET `/api/tools/:id/verdict-capabilities` | auditor | 模块工具可产出的条款判定（读 tool.clauses） |
| POST `/api/test-command` | template_manager | 试跑命令模板不落库：`{{param}}` 替换缺参 9003 → CommandExecutor.runCommand → 附带 mapping rules 匹配结果 matchedRules[] |
| POST `/api/test-command/stream` | template_manager | 同上的 **NDJSON 实时流**（非 Socket.IO）：逐行写 `application/x-ndjson`，事件 `{type:'start'\|'stdout'\|'stderr'\|'done'\|'error'}` |

## 3. templates.ts —— 合规模板（8 个）

| 方法+路径 | 角色 | 用途与要点 |
| --- | --- | --- |
| GET `/api/templates` · GET `/api/templates/:id` | auditor | 列表/详情（聚合 steps/toolRefs/clauseBindings） |
| POST `/api/templates` | template_manager | 创建（单事务写主表+子表） |
| PUT `/api/templates/:id` | template_manager | 更新（body.revision 乐观锁；冲突整体回滚） |
| DELETE `/api/templates/:id` | template_manager | 删除（活跃项目占用 → 409/code 2001） |
| POST `/api/templates/:id/clone` | template_manager | 克隆/派生 `{newName, inheritParent?}`（父子继承链） |
| GET `/api/templates/:id/coverage` | auditor | 条款覆盖率统计（query standardVersion?）—— 前端 TemplateCoverage 组件数据源 |
| POST `/api/templates/:id/confirm-upgrade` | template_manager | 工具升级确认 `{toolId, lock}`（follow→locked 或保持跟随） |

## 4. projects.ts —— 项目与编排运行（20 个）

| 方法+路径 | 角色 | 用途与要点 |
| --- | --- | --- |
| GET `/api/projects` | auditor | 列表附 latestRun（相关子查询防 N+1） |
| GET `/api/projects/:id` | auditor | 详情 |
| POST `/api/projects` · PUT `/api/projects/:id` | auditor | 创建/更新 |
| DELETE `/api/projects/:id` | **template_manager** | 删除（删项目权限高于建项目） |
| GET `/api/projects/:id/runs` | auditor | 运行列表 |
| GET `/api/projects/:id/runs/:runId` | auditor | 运行详情（冒烟脚本轮询此端点） |
| POST `/api/projects/:id/runs` | auditor | **启动编排运行** `{stepIds?, concurrencyOverride?, fromStepId?}` → orchestrator.startRun |
| POST `/api/projects/:id/runs/:runId/cancel` | auditor | 取消运行（cancelToken 传播） |
| POST `/api/projects/:id/runs/:runId/steps/:stepRunId/retry` | auditor | 重试失败步骤（rerun 目标步骤、重置下游、重算 run 状态） |
| GET `/api/projects/:id/runs/:runId/steps` | auditor | 步骤列表 |
| GET `/api/projects/:id/runs/:runId/steps/:stepRunId` | auditor | 步骤详情 + evidences + verdicts + stdout/stderr 尾部（各 10 万字符，文件缺失静默置空） |
| GET `/api/projects/:id/variables` · PUT（`{variables}` 整体替换） | auditor | 项目变量读写 |
| GET `/api/projects/:id/preflight` | auditor | 运行前检查（变量完整性/工具健康）—— 前端 PreflightModal 数据源 |
| POST `/api/projects/:id/tools/:toolId/execute-cmd` | auditor | 项目上下文手动执行指定命令 `{commandId?, params?, timeoutMs?}` |
| POST `/api/projects/:id/tools/:toolId/execute-module` | auditor | 手动执行整个模块 `{params?, timeoutMs?}` |
| GET `/api/projects/:id/executions` | auditor | **统一执行历史**（编排步骤+手动命令合并倒序分页，条目 source='orchestration'\|'manual'） |
| GET `/api/projects/:id/logs` | auditor | 项目日志（复用审计表按 entityId 过滤） |

## 5. clauses.ts —— 条款库与映射规则（11 个）

| 方法+路径 | 角色 | 用途与要点 |
| --- | --- | --- |
| GET `/api/clauses` | auditor | 平铺列表（standardVersion 默认 'EN18031:2019'，level/chapter 过滤） |
| GET `/api/clauses/tree` | auditor | parentId 树渲染（数字感知排序） |
| GET `/api/clauses/:clauseId` | auditor | 单条（存在性守卫） |
| POST `/api/clauses` | admin | 创建（重复 409；parentId 自身/缺失/成环 → 400；审计 clause.create） |
| PUT `/api/clauses/:clauseId` | admin | 更新（level/severity 再校验） |
| DELETE `/api/clauses/:clauseId` | admin | 删除（有子条款 409） |
| POST `/api/clauses/batch-import` | admin | 批量导入（数组 body，单事务逐条容错返回 errors[{index,clauseId,error}]；query standardVersion 实现跨标准复制） |
| GET `/api/clause-mapping-rules` | auditor | 输出映射规则列表（toolId 过滤） |
| POST `/api/clause-mapping-rules` | template_manager | 新建规则（matcherType regex/contains/js-expression → onMatch verdict-pass/fail/evidence-only） |
| DELETE `/api/clause-mapping-rules/:id` | template_manager | 删规则 |
| POST `/api/clause-verdicts/:id/override` | auditor | **人工改判** `{pass, reason}`（置 overridden=1） |

## 6. standards.ts —— 标准 CRUD（4 个）

GET `/api/standards` (auditor)；POST（admin，id 缺省 `${CODE}:${version}` 大写推导）；PUT `/:id`；DELETE `/:id`（有条款 → 409）。均写审计。

## 7. commandRuns.ts —— 手工命令运行（5 个）

| 方法+路径 | 角色 | 用途 |
| --- | --- | --- |
| POST `/api/tools/:id/commands/:commandId/run` | auditor | 发起命令运行 → `{runId}`；实时输出经 Socket.IO 房间 `run:{runId}` 的 `run:logLine` |
| POST `/api/command-runs/:runId/cancel` | auditor | 取消 |
| GET `/api/command-runs` | auditor | 列表（toolId/projectId/status/keyword + 分页） |
| GET `/api/command-runs/:runId` | auditor | 详情（含 stdout/stderr 全文） |
| POST `/api/command-runs/:runId/attach` | auditor | 挂载到项目/条款证据化（zod commandRunAttachSchema） |

## 8. reports.ts —— 报告（8 个）

| 方法+路径 | 角色 | 用途 |
| --- | --- | --- |
| GET `/api/projects/:id/reports` · `/latest` | auditor | 列表/最新 |
| POST `/api/projects/:id/reports` | auditor | 生成报告 `{runId?}`（仅 approved 判定计入 grade） |
| GET `.../:reportId` | auditor | 报告详情（project/report/clauses 结构化） |
| GET `.../:reportId/html` | auditor | HTML 版（严格 CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:` + nosniff） |
| POST `.../:reportId/export` | auditor | 服务端 exceljs 生成 Excel → `{filePath, fileName}` |
| GET `.../:reportId/download` | auditor | 流式下载 xlsx（fileRef 缺失现场导出） |
| GET `.../:reportId/json` | auditor | 机器可读 JSON 导出附件 |

## 9. audit.ts / upload.ts（各 1 个）

- GET `/api/audit-logs`（auditor）：keyword/action/entityType/userId/since/until + 分页。
- POST `/api/upload`（auditor）：multipart 字段 `file` → 存 `files/tmp/{uuid}{ext}`，201 返回 `{path, originalName, size, mimeType}`；双层限流（multipart 插件 + 流式计数）超限清理临时文件返回 413/9003；扩展名白名单防路径穿越。

## 10. settings.ts —— AI Provider 配置（5 个，均已挂 requireRole）

| 方法+路径 | 用途 |
| --- | --- |
| GET `/api/settings/ai/providers` | 列表（stripKey 脱敏，apiKey 不出网）+ activeId（auditor） |
| POST `/api/settings/ai/providers` | 新建/更新（admin；isActive 强制单活；更新空 key 不覆盖旧值） |
| POST `/api/settings/ai/providers/:id/activate` | 激活（缺失 404，admin） |
| DELETE `/api/settings/ai/providers/:id` | 删除（删激活项同时清指针，admin） |
| POST `/api/settings/ai/providers/test` | 连通性测试：动态构建 DeepSeekProvider 发 ping，返回 `{ok,latencyMs,model,sample,maskedKey}` 或 502（admin） |

> v0.2 更新：五个端点已全部补挂 requireRole（读 auditor / 写 admin），原「未挂鉴权」缺口已修复。
> 另见 `scripts/ai-diagnose.mts` —— 诊断网关是否对安全测试类提示词静默过滤（详见 §15）。

## 11. agent.ts —— Agent 会话（14 个，全部 auditor）

详见 [08-Agent 子系统](./08-agent-subsystem.md) §9。速览：

```
POST   /api/agent/sessions                       创建会话
GET    /api/agent/sessions[?]                    分页列表
GET    /api/agent/sessions/:id                   详情
POST   /api/agent/sessions/:id/start             启动/续跑
POST   /api/agent/sessions/:id/abort             中止
POST   /api/agent/sessions/:id/messages          注入消息
GET    /api/agent/sessions/:id/events?sinceSeq=  事件增量回放
GET    /api/agent/sessions/:id/steps             会话步骤
POST   /api/agent/sessions/:id/human-steps/:stepRunId/complete   完成人工步骤
GET    /api/agent/projects/:projectId/pending-verdicts           待审判定
POST   /api/agent/verdicts/:verdictId/approve    通过判定
POST   /api/agent/verdicts/:verdictId/reject     驳回判定（需 reason）
POST   /api/agent/artifacts                      直建工件
GET    /api/agent/artifacts?sessionId=|projectId= 工件查询
```

## 11.5 knowledge.ts / skills.ts / notifications.ts —— 知识沉淀与通知（P1 新增）

| 方法+路径 | 角色 | 用途 |
| --- | --- | --- |
| GET `/api/knowledge-notes[?keyword=]` | auditor | 经验笔记列表（title/content/tags LIKE 检索，上限 200） |
| POST `/api/knowledge-notes` | auditor | 新建笔记（author 取当前用户） |
| PUT `/api/knowledge-notes/:id` | auditor | 更新（sourceUrl 可显式 null 清除） |
| DELETE `/api/knowledge-notes/:id` | admin | 删除 |
| POST `/api/knowledge-notes/:id/compile` | template_manager | **AI 编译**：activeProvider(narrativeModel 优先) 把笔记编译成技能草稿；JSON 解析失败/无 Provider/网关空返回时降级为原文封装并附 warnings（重试 1 次、maxTokens 16384） |
| GET `/api/skills[?keyword=]` | auditor | 当前版本技能列表 |
| GET `/api/skills/:id/versions` | auditor | 同 skillKey 全部版本史（含被替代行） |
| POST `/api/skills/:id/approve` | template_manager | 批准（落 approvedBy/approvedAt；批准后注入 Agent 系统提示词） |
| POST `/api/skills/:id/archive` | template_manager | 归档（不再参与检索与注入） |
| POST `/api/notifications/:id/accept-skill` | template_manager | **采纳 AI 沉淀建议**：payload 中的草稿落地为 draft 技能 + 通知置 accepted |
| GET `/api/notifications[?status=&type=&limit=]` | auditor | 通知列表 |
| GET `/api/notifications/unread-count` | auditor | 未读数（铃铛轮询兜底） |
| POST `/api/notifications/:id/status` | auditor | 状态流转 read/snoozed(带 snoozeHours)/accepted/dismissed |

**skills 版本语义**：同 skillKey 再次保存时旧行 isCurrent→0、新行 version=max+1 —— 升级即替代、永不覆盖历史。

## 12. Socket.IO 实时事件总表

连接地址 `/socket.io`；入房方式：握手 query `?runId=` / `?sessionId=`，或 `subscribe`/`unsubscribe` 消息 `{runId?, sessionId?}`。

| 事件 | 目标房间 | 负载要点 | 发射源 |
| --- | --- | --- | --- |
| `run:status` | run:{runId} | status、stepRunId、percent 等 | commandRunnerService/orchestratorService |
| `run:progress` | run:{runId} | percent/message | 同上 |
| `run:logLine` | run:{runId} | line（stdout/stderr 逐行） | 同上 |
| `run:batchProgress` | run:{runId} | percent/eta/status（整批进度） | orchestratorService |
| `tool:health` | 全局广播 | toolId、status | toolRegistryService.runHealthCheck |
| `agent:*`（17 个） | agent:{sessionId}（无 sessionId 则全局） | 见 [08] §10 | AgentService/plannerLoop/工具处理器 |
| `notification:new` | 全局广播 | `{notification}`（完整通知对象） | notify() 助手：propose_skill 工具、会话完成沉淀建议、后续任何通知源 |
| `report:narrative` | run:{projectRunId}（无则全局） | projectId/reportId/narrative | reportService.generateNarrative 异步成文完成后 |

补充：`POST /api/test-command/stream` 是绕过 Socket.IO 的 NDJSON HTTP 流通道。

## 15. 已知运行时风险：编码类网关的内容静默过滤

火山方舟 Coding Plan（anthropic 协议，`ark-code-latest`）等"编码计划"网关对含安全测试词汇
（nmap/扫描/GATT 等）的请求会返回 **HTTP 200 但输出为空**（content 仅空 text 块、output_tokens≈1-8），
不报错、不区分流式/非流式。实测该行为同样命中 Agent 规划循环的系统提示词风格。

- 检测工具：`packages/server/scripts/ai-diagnose.mts`（4 类探针给出结论）；
- 平台侧兜底：skill 编译与叙述报告均「重试 1 次 + maxTokens 16384 + 失败降级」（编译降级为原文封装草稿、
  叙述保持缺失可手动再生成），Agent 循环的空响应由既有容错路径处理；
- 根治方案：在设置页将激活供应商切换为常规 LLM 端点（官方 DeepSeek / 火山方舟 `/api/v3` openai 协议 /
  Moonshot 等），多供应商配置已原生支持。
