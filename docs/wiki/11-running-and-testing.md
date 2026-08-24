# 11 · 运行与测试指南

## 1. 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | **>= 18**（engines 约束；冒烟脚本依赖内置 fetch） |
| 包管理器 | pnpm（workspace 协议 `workspace:*`） |
| 操作系统 | Linux 推荐（内置模块与种子命令工具均为*nix CLI）；macOS/Windows 可跑服务但检测模块功能受限 |
| 检测工具（可选，按需） | nmap、openssl、strings(binutils)、grep；可选 binwalk |
| LLM API Key（可选） | DeepSeek 或任意 OpenAI 兼容端点 / Anthropic 兼容网关 |

## 2. 安装

```bash
cd security-toolsbox
pnpm install
```

注意：`pnpm-workspace.yaml` 设置了 `allowBuilds: {better-sqlite3: false, esbuild: false}`（根 package.json 中 `onlyBuiltDependencies` 同义），即**禁用这两个包的 postinstall 构建脚本**；better-sqlite3 使用预编译二进制。若环境无匹配的预编译产物而报加载错误，需在受控环境下放开构建或本地重建。

## 3. 启动方式

### 3.1 开发模式（推荐日常开发）

```bash
pnpm dev:server   # = pnpm --filter @en18031/server run dev → tsx watch src/index.ts
pnpm dev:web      # = pnpm --filter @en18031/web run dev → vite
```

- 后端监听 `http://0.0.0.0:3000`，启动时自动：跑迁移建库 → 种子数据（工作空间/local-admin/19 条条款/4 个内置模块注册/2 个演示工具）→ 加载内置模块；
- 前端 Vite DevServer 监听 `http://localhost:5173`，`/api` 与 `/socket.io`(ws) 自动代理到 `127.0.0.1:3000`；
- 浏览器访问 **http://localhost:5173**。

### 3.2 生产模式（单进程托管前端）

```bash
pnpm build        # 递归构建各包：server/modules 用 tsc，web 用 tsc -b + vite build → packages/web/dist
pnpm start        # = node --import tsx src/index.ts
```

server 检测到 `WEB_DIST_DIR`（默认 `packages/web/dist`）存在时以 `@fastify/static` 托管并做 SPA fallback，直接访问 **http://host:3000**。

### 3.3 仅初始化数据

```bash
pnpm seed         # = node --import tsx src/db/seed.ts（幂等，可重复执行）
```

### 3.4 类型检查

```bash
pnpm typecheck    # 各包 tsc --noEmit
```

## 4. 测试

| 命令 | 内容 |
| --- | --- |
| `pnpm test` | 各包 vitest 单测（modules 的契约测试+各模块解析器测试；server 的迁移/乐观锁/路由守卫/阶段机/仓库/重试等 10+ 套件） |
| `pnpm --filter @en18031/server run test:e2e` | 冒烟一：模板编排全链路（建模板→建项目→运行→轮询→判定→报告→Excel），需 server 已在 :3000 运行且完成 seed |
| `node scripts/smoke-commands.mjs` | 冒烟二：手工命令链路（建 cmd 工具→ping 127.0.0.1→轮询→挂载项目）。可用 `SMOKE_BASE` 覆盖目标地址 |

> 冒烟脚本断言响应信封 `code===0`；第一个脚本依赖内置工具 `en18031-port-check` 已注册（即 seed 已执行）。

## 5. 环境变量速查（常用子集）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `HOST` | 3000 / 0.0.0.0 | 监听地址端口 |
| `DATA_DIR` / `DB_PATH` | `<repo>/data` 及其 sqlite/app.db | 数据位置 |
| `ALLOWED_HOSTS` | localhost,127.0.0.1,::1 | Host 白名单（绑 0.0.0.0 时私网自动放行） |
| `AUTH_ENABLED` | false | 认证开关（当前恒 local-admin/admin 身份） |
| `AI_ENABLED` | false | AI Agent 总开关 |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` | https://api.deepseek.com / 空 | LLM 端点与密钥（亦可在设置页配置，settings 表优先） |
| `AI_PLANNING_MODEL` / `AI_NARRATIVE_MODEL` | deepseek-chat | 双模型 |
| `AGENT_MAX_ITERATIONS` | 50 | 规划循环硬上限 |
| `AGENT_HUMAN_STEP_TIMEOUT_MS` | 1800000 | 人工步骤超时 |
| `EXECUTION_CONCURRENCY_DEFAULT` / `EXECUTION_TIMEOUT_DEFAULT_MS` | 2 / 1800000 | 引擎并发/超时 |
| `UPLOAD_MAX_BYTES` | 209715200 | 上传上限 |
| `LOG_LEVEL` | info | 日志级别 |

完整清单见 [05-server-foundation](./05-server-foundation.md) §2。

## 6. 验证安装是否成功

1. `curl http://localhost:3000/api/health` → `{"code":0,...,"data":{"status":"ok"}}`；
2. 打开前端「工具库」页：应看到 4 个 builtin 模块（端口合规检测/加密传输合规检测/默认口令风险筛查/固件硬编码密钥扫描）与 2 个 demo 工具；
3. 「标准条款」页应显示 EN18031:2019 条款树（第 5 章共 19 条）；
4. 对 127.0.0.1 跑一次端口扫描步骤验证 nmap 可用性（未装 nmap 时模块会返回保守 fail 并提示补测——这是预期行为而非故障）。

## 7. 数据与运维要点

- 所有运行时数据集中在 `<repo>/data/`：`sqlite/app.db`（WAL，会生成 -wal/-shm 伴生文件）、`files/cmdruns/*.log`（命令输出）、`files/evidence/*`（Agent/模块证据日志）、`files/tmp`（上传暂存）、`reports/*.xlsx`、`logs/`；
- 数据库 schema 由启动期迁移自动升级（当前 v9），无手工 DDL；
- 进程崩溃后重启：orchestrator/commandRunner 通过 `listIncompleteRuns()`/`listRunning()` 恢复或收敛悬挂状态；
- SIGINT/SIGTERM 优雅关闭（io→fastify→db 顺序释放）；
- 生产部署必须覆盖 `JWT_SECRET`，如暴露到非本机网络请收紧 `ALLOWED_HOSTS` 并启用认证。

## 8. 故障速查

| 现象 | 排查方向 |
| --- | --- |
| better-sqlite3 加载报错（NODE_MODULE_VERSION 不符） | 预编译二进制与本机 Node 不匹配：切换 Node 版本或在允许构建的环境重装 |
| 前端页面空白/接口 404 | dev 模式确认两个进程都在跑且 Vite 代理指向 127.0.0.1:3000；生产模式确认 `packages/web/dist` 存在（先 `pnpm build`） |
| 403 invalid host | Host 头不在 ALLOWED_HOSTS：用 IP/白名单域名访问，或追加 `ALLOWED_HOSTS` |
| Agent 会话启动 503 | 未配置任何可用 AI Provider：设置页填 baseUrl+apiKey 或设 `DEEPSEEK_API_KEY` 且 `AI_ENABLED=true` |
| 判定全部「不通过·建议补测」 | 检测主机缺 nmap/openssl 等工具，或目标不可达 —— 属模块保守设计 |
| 上传 413 | 文件超过 `UPLOAD_MAX_BYTES`（默认 200MB） |
