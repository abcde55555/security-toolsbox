# Phase 1「工作台一屏」验收清单

> 用途：reviewer 照单逐项验收 Phase 1 交付（蓝图 [ux-redesign-plan.md](./ux-redesign-plan.md) §4.3/§5.0/§7）。
> 形态：每项给出 操作路径 + 可机读断言（文本/选择器），可直接翻译为 Playwright 用例。
> **R4 修订（captain 二次裁决；依据 api-eng 已落地实现：8 级推导 + 110 例全绿 + ui-eng normalize 一一对应，此前"6 级"裁决作废）**：服务端 `nextSuggestion` 为 **8 级**口径——固定字段 `priority+action+title+reason`，定位字段（runId/percent/sessionId/todoStepRunId/verdictId/verdictCount/gapCount/missingVariables/templateId）见 [api-workbench.md](./api-workbench.md) §4 规则表。两条细化照准：① R1"进行中"按绑定会话状态判定，`waiting_human` 让位 R2/R8；② R6 fix_preflight 为廉价只读估算，**不发健康检查命令**。R5 export_report 服务端永不返回、仅前端回退路径生效。
> 约定：`{BASE}` = 验收实例地址（下文环境为 `http://127.0.0.1:3100`）；总览 Tab 默认激活，路由 `/projects/{projectId}`（实现若用 `?tab=overview` 亦可，两者都认）。
> 测试钩子要求（验收前置条件，**维持不变**）：ui-eng 实现时必须挂以下 `data-testid`——`overview-next-action`（主行动卡容器）、`overview-next-action-btn`（主按钮）、`overview-kpis`（KPI 条）、`overview-events`（最近事件摘要）、`overview-todos`（本项目待办清单）、`overview-stepper`。缺钩子的项按 FAIL 记。

---

## 0. 环境准备（一次性，非编号项）

```bash
cd /home/kali/Desktop/Code/security-toolsbox
pnpm --filter @en18031/web run build          # 产出 packages/web/dist，供 :3100 静态托管
rm -f /tmp/p1-accept.db*                       # 干净库
DB_PATH=/tmp/p1-accept.db \
DATA_DIR=/tmp/p1-accept-data STORAGE_LOCAL_DIR=/tmp/p1-accept-data/files \
REPORTS_DIR=/tmp/p1-accept-data/reports LOG_DIR=/tmp/p1-accept-data/logs \
PORT=3100 pnpm --filter @en18031/server run dev   # 临时后端（前台或 job 均可）
curl -s http://127.0.0.1:3100/api/standards | head -c 200   # 健康检查，期望 code:0
```

说明：鉴权默认关闭（authzService 本地 admin 直通），API无需请求头；服务端经 `@fastify/static` 托管 `WEB_DIST_DIR`，Playwright 直连 `:3100` 单源即可，无需另起 Vite。

## 0.1 种子数据（SQL 造数，附录 A 有完整脚本）

按服务端 8 级推导规则（api-workbench.md §4 规则表）造样本项目（同一临时库内并存，互不干扰）：

| 样本 id | 模拟状态 | 命中级别 |
| --- | --- | --- |
| `p1-R1-run` | project_runs(`running`,45%,triggerMode=manual) + 活跃会话 | **R1 monitor_run**·模板 run 变体（runId+percent） |
| `p1-L3-follow` | 仅活跃会话 `running`、无 run、无待办无草案 | **R1 monitor_run**·agent 会话变体（sessionId） |
| `p1-R2-todo` | agent_sessions(`waiting_human`) + step_runs(`human_instruction`,`running`) | **R2 handle_human_todos**（waiting_human 不算进行中，让位 R2——口径细化①的反例对照） |
| `p1-R3-verdict` | done 会话(adjudication) + clause_verdicts×2 `pending_review` | **R3 review_verdicts** |
| `p1-R4-noreport` | done 会话 + run=success，无 reports 行 | **R4 generate_report** |
| `p1-R5-report` | 同上 + reports 行(isLatest=1) | R8 兜底实显；**B5 用它验证服务端不返回 export_report + 前端回退轮转** |
| `p1-R6-preflight` | 绑定含必填变量的模板 `tpl-p1-req`，项目 variables=`{}` | **R6 fix_preflight**（gapCount=1, missingVariables=['targetIp']） |
| `p1-R7-start` | 新建项目、无 run、无缺口（模板 tpl-p1 无必填变量） | **R7 start_run** |
| `p1-R8-deeptest` | run=success(终态) + 报告已生成、无会话、无缺口 | **R8 agent_or_config** 兜底 |

⚠️ 四个易踩坑（均已核实源码/契约）：① `clause_verdicts.reviewStatus` 默认 `'approved'`，草案必须显式写 `'pending_review'`；② phase-guard 触发器——verdict 引用的 step_run 若带 `agentSessionId`，该会话 `phase` 必须为 `'adjudication'`，否则 INSERT 被中止（R3 样本按"先建会话后插草案"排序）；③ R6 缺口=缺失必填模板变量数+引用不存在/red 工具的步骤数，且**不发健康检查命令**（廉价只读）；④ 规则取第一个命中：R7 要求"无 run 且模板就绪"，故兜底样本必须带终态 run+报告才能落到 R8，否则会被 R7 截胡。

---

## 1. 验收清单（20 项）

格式：编号 | 检查点 | 操作 | 预期 | 对应蓝图章节

### A. 交付物与 API 兼容

| 编号 | 检查点 | 操作 | 预期 | 章节 |
| --- | --- | --- | --- | --- |
| A1 | workbench 端点契约 | `curl -s {BASE}/api/projects/p1-R7-start/workbench` | HTTP 200 `code:0`；`data` 含 `project/latestRun/sessions/humanTodos/verdictDrafts/evidenceCount/latestReport/nextSuggestion`；`nextSuggestion` 满足：`priority=7`、`action='start_run'`、`title='开始测试'`、`reason` 非空、`templateId='tpl-p1'`（字段与枚举以 api-workbench.md §4 为准） | §4.3/api-workbench §4 |
| A2 | 只加法不改旧 | 浏览器 DevTools Network 观察 OverviewTab 加载期间的请求 | 仅新增 `*/workbench` 一类请求；既有端点（projects/runs/steps/reports/latest 等）的 URL 与响应结构不变（对照 A3 抽样 diff） | §8.1/§8.3 |
| A3 | 既有端点回归抽查 | 对 p1-R5-report 依次 curl `GET /api/projects/:id`、`/api/projects/:id/runs`、`/api/projects/:id/reports/latest` | 三者均 200 且字段结构与 Phase 1 改动前快照一致（评审现场可用 git stash 前后各取一次对比） | §8.3 |

### B. Next Best Action：服务端 6 级规则 + 回退（每级一行；编号沿用 R2 旧版以便对照）

> 口径：`title` 为服务端定稿文案，主按钮断言用**精确匹配**；点击去向按 api-workbench.md §3「前端落地建议」+ 附录 C 终裁。

| 编号 | 检查点 | 操作 | 预期 | 章节 |
| --- | --- | --- | --- | --- |
| B1 | ~~R1 编排运行中~~ **SKIP** | 打开 `{BASE}/projects/p1-R1-run` 仅人工核对头部 | **SKIP**：服务端 6 级不含编排运行态（终裁同 C-2 逻辑）；运行进度由项目头部既有进度条呈现，主行动卡按服务端规则显示该样本实况（无会话→L1）。运行态引导移 Phase 2 增强 | §4.3/C-2 |
| B2 | L2 处理人工待办（waiting_human 样本） | 打开 `/projects/p1-R2-todo` | 主按钮文案=「处理人工待办」（精确匹配）；副标题 reason 含待办数 `1`；点击后进入 sess-R2 会话详情，DOM 存在 `#human-card-sr-R2` 且卡片带琥珀色脉冲样式 | api-workbench §3-#2 |
| B3 | L4 审核判定草案（过渡去向按 C-4 已裁） | 打开 `/projects/p1-R3-verdict` | 主按钮文案=「审核判定草案」（精确匹配）；点击进入 sess-R3 会话详情，右侧 Sider「判定审核」Tab 可见且含 2 条待审卡片。Phase 5 工作台内建审核视图后此去向改链内，本项断言随之升级 | api-workbench §3-#4 + C-4 |
| B4 | L5 报告·生成变体（原 R4；文案循环按 C-3 已裁） | 打开 `/projects/p1-R4-noreport` | 主行动 action=`view_report` 且 **reportId 缺省**；按钮文案精确匹配「生成评估报告」（若服务端发合并文案「查看/生成评估报告」亦放行）；点击触发 `POST /api/projects/:id/reports`（Network 可见）；成功后重拉 workbench，主按钮携带新 reportId——即「生成→查看」循环 | api-workbench §3-#5 + C-3 |
| B5 | L5 报告·查看变体（原 R5 并入，按 C-3 不单列导出级） | 打开 `/projects/p1-R5-report` | 主行动 action=`view_report` 且携带 `reportId='rep-R5'`；按钮文案匹配 `/查看.*报告\|查看/生成评估报告/`（精确或合并式均可）；点击打开报告视图（报告 Tab 或 HTML 预览任一）。导出入口保留在报告 Tab 内原样不变，不在主行动卡重复 | api-workbench §3-#5 + C-3 |
| B6 | ~~R6 预检缺口~~ **SKIP** | — | **SKIP**：captain 终裁——预检缺口不在服务端 6 级内，移 Phase 2 增强；前端 useNextAction 回退同步裁到 6 级。`p1-R6-preflight` 种子保留备用 | C-2 |
| B7 | L1 创建会话（无任何会话样本） | 打开 `/projects/p1-R7-start` | 主按钮文案=「创建 Agent 会话」（精确匹配）；点击打开新建会话向导并携带 projectId 上下文。备注：「开始测试」入口仍在执行采集 Tab 头部原样保留（E2 覆盖），不属主行动卡职责 | api-workbench §3-#1 |
| B8 | L3 跟进会话（进行中会话样本） | 打开 `/projects/p1-L3-follow` | 主按钮文案=「跟进运行中的会话」（精确匹配）；点击进入 sess-L3 会话详情页 | api-workbench §3-#3 |
| B9 | L6 兜底 + 回退注入 | (a) 打开 `/projects/p1-L6-aborted` 断言主按钮=「新建 Agent 会话」；(b) Playwright `page.route('**/api/projects/*/workbench**', r => r.abort())` 后打开任一样本项目页 | (a) 兜底文案精确命中；(b) 页面不白屏（ErrorBoundary 不触发）、主行动由客户端 6 级裁剪版回退规则渲染出合理按钮、console 无未捕获异常 | api-workbench §3-#6 / §4.3 |

### C. OverviewTab 信息元素

| 编号 | 检查点 | 操作 | 预期 | 章节 |
| --- | --- | --- | --- | --- |
| C1 | 必备信息元素齐全 | 打开 p1-R5-report 项目页逐区核对 | 五个钩子容器均存在且非空：`overview-kpis` 含 适用条款/通过/失败/未覆盖(+证据数/待审数 至少四项数字)、`overview-events` ≥1 条事件摘要、`overview-todos` 渲染待办区（空态给明确空文案而非空白）、NextAction 卡、Stepper | §5.3-总览 |
| C2 | 补采提醒 Alert（条件性） | 给 p1-R7-start 的模板塞一条 custom 命令步骤后刷新 | 总览出现警告 Alert，文案含「命令手册/不会被执行/补采」语义（匹配 `/命令手册\|单独执行/`）；删除该步骤后 Alert 消失 | §5.3-总览 |
| C3 | Stepper 高亮同步 + Tab 内跳转 | 在 p1-R1-run 页观察 `overview-stepper`，「执行采集」步为 process 高亮；点击「合规报告」步 | 高亮步与 nextSuggestion 一致；点击后仅切换 Tab（URL hash/query 变化），**不发生整页刷新**（window performance.navigation 无 reload；原 `window.location.href='/agent'` 行为已消除） | §7-P1 |

### D. 防退化红线回归（§5.0，Phase 1 不得破坏；后续阶段持续复用本节）

| 编号 | 检查点 | 操作 | 预期 | 章节 |
| --- | --- | --- | --- | --- |
| D1 | 待办抽屉 + 卡片闭环三态 | 进入 p1-R2-todo 会话详情 → 右上「人工待办」打开 Drawer → 点击待办项 → 流内对应卡片获得焦点（滚动+脉冲）→ 在卡内填写成果说明并提交 | Drawer 列表项含指令摘要与「需上传证据」Tag（该步 evidenceRequired 时）；点击定位后 `#human-card-{id}` 进入视口并有 box-shadow 脉冲动画；提交后卡片背景变绿（`#f0fdf4`）且横幅按会话状态三选一：「Agent 已收到，继续执行中」/「已提交，正在恢复执行」/「已提交，结果已保存」，并显示成果说明与提交时间 | §5.0-① |
| D2 | 假等待自愈（状态漂移静默恢复） | 两个 Playwright context 同开会话页；ctx-B 中完成该人工步骤；回 ctx-A 点击同一步骤的提交 | ctx-A **不出现** `.ant-message-error`（3s 内断言）；界面静默对齐：卡片转绿、待办计数减一（内部为全量重拉，用户无感）；若服务端处于 planning 恢复期则显示「已提交：执行链正在自动恢复，稍候将继续」 | §5.0-② |
| D3 | 流式推理显示（条件项） | 前置：Settings 中 AI Provider 连通性测试通过；发起新会话并发送一条消息，观察生成期间 | 出现「正在生成…」区域：💭 reasoning 为斜体灰字增量追加、正文实时变长、区域 maxHeight 内滚动；生成结束后归位为正式消息卡。无可用 Provider 时记 SKIP 并在验收报告注明原因 | §5.0-③ |

### E. 零回归冒烟

| 编号 | 检查点 | 操作 | 预期 | 章节 |
| --- | --- | --- | --- | --- |
| E1 | 既有五 Tab 无回归 | 依次打开 p1-R5-report 的 flow/vars/term/cmdruns/log/report 六个旧 Tab | 各 Tab 正常渲染，console 无 error 级日志；flow Tab 的步骤列表与 StepDetailDrawer 可打开 | §7-P1 |
| E2 | 全链路冒烟 | UI 全新走一遍：新建项目 → 开始测试（执行采集 Tab 头部，预检）→ 等待 run 终态 → 发起会话/完成待办 → 生成报告 | 全程可走通；总览主行动随阶段在 L1 创建会话→L3 跟进→L5 查看/生成报告 间切换，与人工判断一致；「开始测试」等编排操作不受主行动卡影响仍可用 | §3/api-workbench §3 |

---

## 附录 A：种子 SQL（sqlite3 /tmp/p1-accept.db）

> 时间戳一律 `datetime('now')`；所有 id 带 `p1-` 前缀防撞。先起一次空库后端让迁移跑完再执行本脚本（迁移会给 step_runs/clause_verdicts 补列）。

```sql
-- 公共：模板（各项目共用）
INSERT INTO templates (id,name,createdBy,createdAt,updatedAt) VALUES
 ('tpl-p1','P1验收模板','local-admin',datetime('now'),datetime('now'));

-- R1 编排运行中（B1 SKIP 后仅供头部进度条人工核对与 E2；按服务端规则实显 L1）
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R1-run','R1运行中','tpl-p1',1,'EN18031:2019','L2','running','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO project_runs (id,projectId,status,startedAt,startedBy,progressPercent) VALUES
 ('run-R1','p1-R1-run','running',datetime('now'),'local-admin',45);

-- R2 waiting_human + 人工步骤 → L2 handle_human_todos
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R2-todo','R2人工待办','tpl-p1',1,'EN18031:2019','L2','running','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO project_runs (id,projectId,status,startedAt,startedBy,progressPercent) VALUES
 ('run-R2','p1-R2-todo','success',datetime('now'),'local-admin',100);
INSERT INTO agent_sessions (id,projectId,phase,status,currentStepId,createdBy,createdAt,updatedAt)
VALUES ('sess-R2','p1-R2-todo','collection','waiting_human','sr-R2','local-admin',datetime('now'),datetime('now'));
INSERT INTO step_runs (id,projectRunId,stepId,stepSnapshot,status,startedAt,stepType,instruction,expectedOutcome,agentSessionId,evidenceCount,percent)
VALUES ('sr-R2','run-R2','step-human-1','{}','running',datetime('now'),'human_instruction',
        '手动核对设备调试串口是否关闭','串口处于关闭状态','sess-R2',0,0);

-- L3 进行中会话（无待办无草案）→ L3 follow_session
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-L3-follow','L3跟进会话','tpl-p1',1,'EN18031:2019','L2','running','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO agent_sessions (id,projectId,phase,status,currentStepId,createdBy,createdAt,updatedAt)
VALUES ('sess-L3','p1-L3-follow','collection','running',NULL,'local-admin',datetime('now'),datetime('now'));

-- R3 判定草案 ×2 → L4 review_verdicts
-- 顺序敏感：先建 adjudication/done 会话，再插关联它的 step_run 与草案，满足 phase-guard 触发器
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R3-verdict','R3待审判定','tpl-p1',1,'EN18031:2019','L2','review','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO project_runs (id,projectId,status,startedAt,finishedAt,startedBy,progressPercent) VALUES
 ('run-R3','p1-R3-verdict','success',datetime('now'),datetime('now'),'local-admin',100);
INSERT INTO agent_sessions (id,projectId,phase,status,currentStepId,createdBy,createdAt,updatedAt)
VALUES ('sess-R3','p1-R3-verdict','adjudication','done',NULL,'local-admin',datetime('now'),datetime('now'));
INSERT INTO step_runs (id,projectRunId,stepId,stepSnapshot,status,finishedAt,stepType,agentSessionId,evidenceCount,percent)
VALUES ('sr-R3a','run-R3','step-mod-1','{}','success',datetime('now'),'module','sess-R3',1,100),
       ('sr-R3b','run-R3','step-mod-2','{}','success',datetime('now'),'module','sess-R3',1,100);
INSERT INTO clause_verdicts (id,stepRunId,projectRunId,projectId,clauseId,pass,severity,reason,verdictGroup,reviewStatus,aiGenerated,createdAt) VALUES
 ('cv-R3a','sr-R3a','run-R3','p1-R3-verdict','5.3.2-1',0,'high','检出默认凭据','C','pending_review',1,datetime('now')),
 ('cv-R3b','sr-R3b','run-R3','p1-R3-verdict','4.2.1-1',1,'low','加密算法符合要求','A','pending_review',1,datetime('now'));

-- R4 成功但无报告（带 done 会话避免被 L1 截胡）→ L5 view_report·生成变体
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R4-noreport','R4待出报告','tpl-p1',1,'EN18031:2019','L2','testing','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO project_runs (id,projectId,status,startedAt,finishedAt,startedBy,progressPercent) VALUES
 ('run-R4','p1-R4-noreport','success',datetime('now'),datetime('now'),'local-admin',100);
INSERT INTO agent_sessions (id,projectId,phase,status,currentStepId,createdBy,createdAt,updatedAt)
VALUES ('sess-R4','p1-R4-noreport','review','done',NULL,'local-admin',datetime('now'),datetime('now'));

-- R5 已有报告（reports.format 为 NOT NULL，必须带上）→ L5 view_report·查看变体（补 done 会话防 L1 截胡）
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R5-report','R5已有报告','tpl-p1',1,'EN18031:2019','L2','completed','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO project_runs (id,projectId,status,startedAt,finishedAt,startedBy,progressPercent) VALUES
 ('run-R5','p1-R5-report','success',datetime('now'),datetime('now'),'local-admin',100);
INSERT INTO agent_sessions (id,projectId,phase,status,currentStepId,createdBy,createdAt,updatedAt)
VALUES ('sess-R5','p1-R5-report','review','done',NULL,'local-admin',datetime('now'),datetime('now'));
INSERT INTO reports (id,projectId,projectRunId,format,grade,summary,generatedBy,generatedAt,isLatest)
VALUES ('rep-R5','p1-R5-report','run-R5','xlsx','B','{"applicable":10,"pass":8,"fail":1,"notCovered":1}','local-admin',datetime('now'),1);

-- L6 兜底：只剩 aborted 会话、无报告无草案 → L6 create_session「新建 Agent 会话」
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-L6-aborted','L6兜底','tpl-p1',1,'EN18031:2019','L2','draft','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO agent_sessions (id,projectId,phase,status,currentStepId,createdBy,createdAt,updatedAt)
VALUES ('sess-L6','p1-L6-aborted','onboarding','aborted',NULL,'local-admin',datetime('now'),datetime('now'));

-- R6 变量缺口样本（B6 SKIP，种子留作 Phase 2 预检增强）
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R6-preflight','R6预检缺口','tpl-p1',1,'EN18031:2019','L2','draft','{}','local-admin',datetime('now'),datetime('now'));

-- R7 新项目无 run 无会话 → L1 create_session
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R7-start','R7待启动','tpl-p1',1,'EN18031:2019','L2','draft','{}','local-admin',datetime('now'),datetime('now'));

-- R8 全流程完成、无会话（仅用于 E1/E2 冒烟；按规则实显 L1）
INSERT INTO projects (id,name,templateId,templateVersionSnapshot,standardVersion,targetComplianceLevel,status,variables,createdBy,createdAt,updatedAt)
VALUES ('p1-R8-deeptest','R8已完成','tpl-p1',1,'EN18031:2019','L2','completed','{}','local-admin',datetime('now'),datetime('now'));
INSERT INTO project_runs (id,projectId,status,startedAt,finishedAt,startedBy,progressPercent) VALUES
 ('run-R8','p1-R8-deeptest','success',datetime('now'),datetime('now'),'local-admin',100);
INSERT INTO reports (id,projectId,projectRunId,format,grade,summary,generatedBy,generatedAt,isLatest)
VALUES ('rep-R8','p1-R8-deeptest','run-R8','xlsx','A','{"applicable":10,"pass":10,"fail":0,"notCovered":0}','local-admin',datetime('now'),1);
```

## 附录 B：Playwright 走查要点（playwright-core + 系统 Chromium）

```js
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const page = await (await browser.newContext()).newPage();
const BASE = 'http://127.0.0.1:3100';
```

要点：
1. **导航路径统一**：`await page.goto(`${BASE}/projects/${id}`)` → 等待 `[data-testid=overview-next-action]` 可见（超时 5s 即 FAIL，兼测 C1 钩子存在）。
2. **主按钮断言用服务端定稿 title（精确匹配）**：`expect(page.getByTestId('overview-next-action-btn')).toHaveText('处理人工待办')`——六级各配一条（B1/B6 SKIP 除外）；`reason` 副标题用 `toContainText` 宽松断言。
3. **点击去向断言**：记录 `page.url()` 前后变化；Tab 内跳转断言 `page.url()` 的 query/hash 变化且 `page.evaluate(() => performance.getEntriesByType('navigation').length === 1)`（排除整页刷新）。会话页跳转兼容 `/sessions/{id}` 与 `/agent/{id}` 两种路径形态，以「页面出现会话详情特征（PhaseHeader）」为准。
4. **回退注入（B9b）**：`await page.route('**/workbench**', r => r.abort());` 后再 goto；断言主行动容器仍渲染。
5. **漂移双页签（D2）**：`const ctxA = await browser.newContext(); const ctxB = ...` 两边各自打开 sess-R2 会话详情；ctxB 完成步骤后 ctxA 点提交；`await expect(page.locator('.ant-message-error')).toHaveCount(0)`（3s 窗口）。
6. **动画断言（D1/B2）**：`locator('#human-card-sr-R2')` 断言 `box-shadow` 非 none（脉冲中）或监听一次 animation；绿色态断言 `background-color` ≈ `rgb(240, 253, 244)`。
7. **网络观察（A2/B4）**：`page.on('request', ...)` 收集 `/api/` URL 清单做前后比对；B4 额外断言出现一次 `POST .../reports`。
8. 输出：每个检查点打印 `PASS/FAIL/SKIP + 编号`，汇总成表直接贴进验收报告。

## 附录 C：契约裁决记录（captain 终裁，已全部落档生效）

| # | 事项 | captain 终裁 | 落点 |
| --- | --- | --- | --- |
| C-1 ✅ 已裁 | `nextSuggestion` 字段口径 | 以 [api-workbench.md](./api-workbench.md) §2–§3 定稿为准：`{ action: 'create_session'\|'handle_human_todos'\|'follow_session'\|'review_verdicts'\|'view_report', title（服务端定稿，可直接做按钮文案）, reason, sessionId?/todoStepRunId?/verdictId?/reportId? }` | A1 与 B 组全部断言口径 |
| C-2 ✅ 已裁 | R6 预检缺口 | api-eng 实现的 6 级规则不含预检；Phase 1 以服务端 6 级为准，前端 useNextAction 回退规则同步裁到 6 级；预检增强移 Phase 2 | B6 记 SKIP（注明"移 Phase 2"）；B1 同理 SKIP |
| C-3 ✅ 已裁 | 报告导出标记 | reports 数据模型无导出标记字段（已 grep 核实）；R5 并入 R4：文案循环「生成报告→查看报告」，不单独设 R5 级 | B4/B5 改为 L5 双变体循环断言 |
| C-4 ✅ 已裁 | 判定审核过渡去向 | 会话详情页右侧「判定审核」Tab（/sessions/:sessionId 现有 Tabs）；待 Phase 5 工作台内建审核视图后改链内 | B3 点击去向断言 |

> 裁决与蓝图 §4.3 八级表的关系：八级表降级为 Phase 2+ 增强提案池；本清单 B 组编号保留原位以便对照，SKIP 两项（B1/B6）即差额。ui-eng 的 6 个 data-testid 钩子要求不变。
