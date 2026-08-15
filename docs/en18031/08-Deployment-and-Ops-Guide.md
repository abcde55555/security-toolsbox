# EN18031 合规测试平台 · 部署与运维指南

> **文档版本**：v1.0
> **产出日期**：2026-08-15
> **适用读者**：运维工程师、DevOps、部署负责人、单机便携部署的审计员
> **读完后你能做的事**：把平台部署到一台 Linux 无头服务器上并对外提供 HTTPS 访问、配置自动备份与日志轮转、做 SQLite 到 PostgreSQL 的平滑迁移、理解如何用 Docker Compose 一键拉起整套服务、需要时如何打包 Electron 便携版。

## 1. 部署形态总览

1. 生产推荐形态（Web-First）。一台或多台 Linux x86_64 服务器，Node.js 后端进程常驻（通过 systemd 或 pm2 守护），前端静态资源由 Nginx 托管或后端直接托管，Nginx 做反向代理 + HTTPS 终止 + WebSocket 协议升级透传，SQLite 本地文件存储（单实例 ≤10 并发审计员场景完全够用），文件证据与报告导出用本地磁盘目录，后端与目标测试设备在同一内网网段以保证合规测试流量可达。

2. 团队协作高并发形态（Milestone 3+ 可切换）。数据库切换为 PostgreSQL 14+，文件证据与报告导出切对象存储（MinIO 自建或 AWS S3 / 阿里云 OSS），后端可水平扩展为多实例（Socket.IO 适配器切 Redis Adapter 保证多实例间 WebSocket 消息同步），Nginx 做负载均衡。

3. 离线便携形态（Electron 可选，非首期范围）。将同一套后端与前端静态资源用 Electron 包装为单文件 .exe / .dmg / .AppImage，审计员自带笔记本电脑时双击运行即可，目标设备用网线直连笔记本网口；该形态不涉及服务器部署，仅做独立打包说明，不作为本指南重点。

4. 部署前必须确认的三个前提。前提一：后端部署机到目标测试设备的网络连通性（至少 ICMP ping 通、且计划开放的 TCP/UDP 端口不被防火墙阻隔），合规测试流量必须从后端部署机发出，不能从浏览器端发出；前提二：后端部署机上允许安装 nmap、masscan、binwalk、python3、g++ 等系统依赖（合规模组会调用这些 CLI）；前提三：如需要对外网暴露访问，必须启用 HTTPS 且 WAF/安全组仅开放 80/443 端口，绝不将后端 API 端口直接暴露。

## 2. 系统依赖与环境准备（Debian/Ubuntu 示例）

1. Node.js 运行时。安装 Node.js 18 LTS 或更高稳定 LTS，推荐用 NodeSource APT 源而不是系统自带（自带通常版本太旧）；安装后 `node --version` 与 `npm --version` 验证版本，生产环境不建议用 nvm 管理，改用系统级安装以便 systemd 服务能找到二进制。

2. CLI 工具依赖。`apt-get install -y nmap masscan binwalk binutils-arm-none-eabi openssl` 安装合规测试必需的命令行工具；`apt-get install -y python3 make g++` 安装 node-pty 编译依赖；`apt-get install -y curl gnupg ca-certificates` 安装 HTTPS 与包管理辅助；`apt-get install -y sqlite3` 虽然 better-sqlite3 自带绑定，但系统 sqlite3 命令行可用于运维排查。

3. 系统内核参数调整。`fs.file-max = 65536` 提高文件句柄上限（长任务多进程并行跑 nmap 会开大量 socket）；`net.ipv4.ip_local_port_range = 1024 65535` 扩大临时端口范围；`net.core.somaxconn = 1024` 提高 TCP 连接队列；这些参数写入 `/etc/sysctl.d/99-en18031.conf` 然后 `sysctl -p` 生效。

4. 运行用户与目录权限。创建专用系统用户 `useradd -r -s /usr/sbin/nologin en18031`，不要用 root 跑后端进程；创建 `/opt/en18031/` 作为部署根目录，owner 设为 en18031；数据子目录 `/opt/en18031/data/sqlite/` 放数据库文件、`/opt/en18031/data/files/` 放文件证据与导出、`/opt/en18031/data/logs/` 放后端应用日志，三个子目录权限必须 700，且备份用户单独加入 en18031 组以便只读访问。

## 3. Docker Compose 一键部署（推荐首选）

1. 单文件 docker-compose.yml 结构。services 分 4 个：en18031-server（Node 后端，基于 node:18-alpine 或 debian-slim 自定义镜像，内置 nmap/binwalk 等 CLI）、en18031-web（Nginx 托管前端静态资源，反代 /api 和 /ws 到后端、也可以直接由 server 托管前端）、en18031-db（Milestone 3+ 才启用的 PostgreSQL，首期注释掉）、en18031-redis（Milestone 3+ 多实例水平扩展的 Socket.IO 适配器，首期注释掉）。volumes 声明 data-sqlite、data-files、data-logs 三个命名卷映射到容器内对应路径。networks 用默认 bridge 即可。

2. Dockerfile 要点。后端镜像必须分多阶段构建：builder 阶段装所有编译依赖（python3 make g++）跑 `npm ci && npm run build`；runtime 阶段只复制 node_modules（或再跑一次 prune 去掉 devDependencies）、dist 产物、package.json；runtime 阶段必须安装 nmap/binwalk 等 CLI 运行依赖；镜像入口 `CMD ["node", "dist/server/index.js"]`，USER 切换到非 root。前端镜像 builder 阶段 `npm ci && npm run build` 产出 dist，runtime 阶段用 nginx:alpine 把 dist 复制到 /usr/share/nginx/html，附带自定义 nginx.conf。

3. 环境变量清单。所有可配置项必须通过环境变量或 .env 文件注入，不允许硬编码到仓库。后端的关键变量：NODE_ENV=production、PORT 默认 3000、DATABASE_URL（SQLite 填 file:/data/sqlite/app.db?_journal=WAL，PostgreSQL 填 postgres://user:pass@host:5432/db）、STORAGE_TYPE=local|s3、STORAGE_LOCAL_DIR=/data/files、STORAGE_S3_BUCKET、STORAGE_S3_ENDPOINT、STORAGE_S3_ACCESS_KEY、STORAGE_S3_SECRET_KEY、JWT_SECRET（首期即使关闭登录也要设一个强随机字符串，Milestone 4 不用改配置）、AUTH_ENABLED=true|false（首期 false）、DEFAULT_ADMIN_PASSWORD、WORKSPACE_ID_DEFAULT=default、EXECUTION_CONCURRENCY_DEFAULT=2、EXECUTION_TIMEOUT_DEFAULT_MS=1800000（30 分钟）、LOG_LEVEL=info、LOG_DIR=/data/logs、AUDIT_LOG_RETENTION_DAYS=180。前端的关键变量打包时注入：VITE_API_BASE_URL=/api、VITE_WS_BASE_URL=/ws、VITE_APP_TITLE=EN18031 合规测试平台、VITE_DEPLOY_MODE=server|desktop。

4. 首次启动初始化。容器启动脚本里必须做幂等初始化：检查数据库文件不存在则执行 Kysely migrate latest、检查条款库表为空则导入种子条款、检查 tools 表为空则注册内置模组元数据、检查默认 Admin 用户不存在则创建（首期 AUTH_ENABLED=false 时可跳过用户创建但 Workspace default 必须写入）；幂等性保证了容器重启、升级、备份恢复后不会重复执行初始化逻辑。

## 4. 裸机部署与 systemd 服务（无 Docker 场景）

1. 部署目录结构。`/opt/en18031/server/` 放后端 dist 与 package.json + production node_modules；`/opt/en18031/web/dist/` 放前端静态资源；`/opt/en18031/data/` 同第 2 节；`/opt/en18031/config/` 放 .env 文件；`/opt/en18031/scripts/` 放 backup.sh、restore.sh、health-check.sh 运维脚本。每次发版用 rsync 同步 server 和 web 的新 dist，保留前一版 dist 的 .bak 副本以便回滚。

2. systemd 服务文件 `/etc/systemd/system/en18031.service`。User=en18031、Group=en18031、WorkingDirectory=/opt/en18031/server、EnvironmentFile=/opt/en18031/config/.env、ExecStart=/usr/bin/node dist/server/index.js、Restart=on-failure、RestartSec=5、TimeoutStopSec=60（给执行引擎留时间优雅退出、清理子进程）、KillMode=mixed（先 SIGTERM 等超时后 SIGKILL，防止 nmap 等子进程泄漏）、StandardOutput=append:/opt/en18031/data/logs/server.log、StandardError=append:/opt/en18031/data/logs/server-error.log；别忘了 `systemctl daemon-reload && systemctl enable en18031.service` 设置开机自启。

3. 优雅停机钩子。后端进程监听 SIGTERM 信号，收到后：OrchestratorService 拒绝接受新 run 请求、向所有正在运行的 StepRun 广播 cancelToken 请求、等待最多 30 秒让已启动的模组做资源清理、持久化所有内存中未落库的 evidence/verdict、写一条审计日志"系统正常停机"，然后退出。SIGKILL 只有优雅超时后才由 systemd 触发。

4. Nginx 反向代理配置要点。前端静态资源 try_files 走 SPA history fallback；`location /api/` proxy_pass 到 http://127.0.0.1:3000 并带上 X-Real-IP、X-Forwarded-For、X-Forwarded-Proto 头；`location /ws/` 额外加 `proxy_http_version 1.1`、`proxy_set_header Upgrade $http_upgrade`、`proxy_set_header Connection "upgrade"`、`proxy_read_timeout 86400s`（WebSocket 长连接不能默认 60 秒超时断开）；HTTPS 证书用 Let's Encrypt certbot 自动续期，TLS 配置禁用 SSLv3 和弱套件，HSTS 开启；上传文件大小 `client_max_body_size 500M`（固件上传场景需要）；访问日志开，审计日志走后端自己的 append-only，Nginx 访问日志是运维排查辅助不是合规审计依据。

## 5. 备份与恢复策略（强制执行，合规要求）

1. 三类必须备份的对象，缺一不可。对象一：SQLite/PostgreSQL 数据库文件（所有业务数据、条款判定、审计日志元数据）；对象二：data/files 目录下的文件证据、导出报告 PDF/Excel、固件上传临时文件；对象三：应用日志与 Nginx 访问日志（虽然审计日志在数据库里，但故障排查仍需要应用日志）。三类对象的备份频率、保留周期、存储介质必须写在运维操作手册里。

2. 备份频率建议。数据库：每小时一次增量（WAL 模式下 SQLite 的 -wal 文件配合 Litestream 连续复制到对象存储），每天凌晨 3 点一次全量快照，全量保留 30 天、增量保留 7 天；文件证据：新增的文件同步到对象存储（S3/MinIO 版本桶开启），本地磁盘保留 30 天在线，30 天后自动迁移到冷存储归档；应用日志：按天轮转保留 30 天本地，同步到日志系统（ELK/Loki）保留 180 天。

3. 备份脚本要点。数据库备份必须走 SQLite `.backup` 命令或 pg_dump，不能 cp 原文件（热拷贝可能损坏）；备份前检查后端是否处于低峰期（简单做法是判断当前 running 的 project_run 数量，非零则延迟 10 分钟重试，连续 6 次失败则报警）；备份完成后立即计算 SHA-256 哈希、写入独立的备份审计日志、验证备份文件大小与上次相比偏差不超过 ±20%（偏差异常意味着数据可能损坏或丢失）；备份文件传输加密，至少走 TLS 不能明文 FTP。

4. 恢复演练必须每季度做一次。从最新备份恢复到一台临时环境，跑完整的 Milestone 2 E2E 套件，断言能打开一周前的项目、查看当时的判定详情、重新导出 PDF、审计日志连续性没有断点；演练结果写运维报告归档，任何不一致都要开 Issue 修备份脚本，不能只当演练失败记下来。

5. 审计日志永不删除原则。即使超过 180 天在线窗口，也只能迁移到冷存储归档，冷存储的归档包必须带哈希签名，任何人需要查询归档日志时必须通过 Admin 申请、写审计日志、记录"谁、何时、查了哪段时间、为什么"；严禁在任何场景下执行 `DELETE FROM audit_logs` 或物理删除归档文件，数据库层触发器 + 应用层 Repository 接口不提供 delete 方法双保险。

## 6. 监控、告警与日志轮转

1. 健康检查端点。后端暴露 `GET /health` 接口返回 200 + JSON，包含字段 status=ok|degraded|down、databaseStatus、storageStatus、engineStatus、runningRunsCount、uptimeSeconds、version；Nginx /api/health 不鉴权公开访问，用于负载均衡健康探测和 systemd watchdog。健康检查返回 degraded 或 down 时，systemd 根据 Restart=on-failure 策略自动重启。

2. 四类必须告警的场景。场景一：后端进程连续 3 次健康检查失败（间隔 30 秒），发 P1 告警到值班运维；场景二：数据库连续 10 分钟无法写入（审计日志写不进意味着合规破坏，属最高优先级），发 P0 电话告警；场景三：磁盘使用率超过 85%（文件证据堆积最常见），发 P2 告警提前清理或扩容；场景四：任何一次审计日志的触发器拦截尝试（即有人直接连数据库尝试 UPDATE/DELETE audit_logs），发 P0 安全告警，立即冻结该数据库账号并通知安全负责人。

3. 应用日志轮转。后端日志用 pino 或 winston，自带按天轮转 + 大小轮转；也可以交给 logrotate 系统级处理，`/etc/logrotate.d/en18031` 配置按日、保留 30 天、compress、delaycompress、missingok、notifempty、copytruncate（避免 node 进程持有的文件句柄不释放导致新日志写不进）。Nginx 日志走系统自带 logrotate 即可。

4. 审计合规指标看板。Milestone 3+ 引入 Grafana 看板展示：每日执行项目数、条款 PASS/FAIL/未覆盖比例、各模组平均耗时、工具健康灯红绿分布、近 24h 失败率 Top5 步骤、Admin 操作审计日志实时流；看板挂在监控服务器上，合规负责人每周浏览一次，异常趋势提前暴露。

## 7. SQLite 到 PostgreSQL 的平滑迁移流程

1. 触发条件。当出现任一信号时启动迁移评估：单实例并发审计员 ≥10 且接口 P95 延迟超过 1 秒；数据库文件大小 ≥20GB；需要读写分离或多实例水平扩展；企业安全策略统一要求 PostgreSQL。评估通过后定迁移时间窗口，推荐周末低峰期，准备回滚方案。

2. 迁移步骤。步骤一：Milestone 1 已确保所有业务代码都走 Repository 接口、不直接写 SQL，所以后端代码只需要改 DATABASE_URL 环境变量和切换 Repository 的 Kysely 驱动实现（PostgreSQL 的 Dialect），其他业务层代码零修改；改完在 staging 环境跑完整测试套件验证无 SQL 方言问题。步骤二：部署临时 PostgreSQL 实例，跑 Kysely migrate latest 建表结构。步骤三：写一次性迁移脚本，从 SQLite 按表顺序读（先主表 tools/clauses/templates/projects，再关联表，最后 audit_logs 追加），批量 INSERT 到 PostgreSQL，每 1000 条一个事务；迁移过程中对每张表的总行数、主键范围、随机抽样 100 行的哈希做校验，发现不一致立即中止并回滚。步骤四：停止后端 service（`systemctl stop en18031.service`），再次跑增量迁移（只迁移上次时间戳之后的 audit_logs 与 step_runs 新增行），二次校验通过。步骤五：修改 .env 切换数据库连接，启动后端，冒烟测试跑 3 个项目流程，验证通过后切流量。步骤六：保留 SQLite 原文件只读挂载 30 天，30 天后确认 PostgreSQL 稳定再打包归档。

3. 回滚预案。任何一步校验失败或冒烟测试不通过，立即把 .env 的 DATABASE_URL 切回 SQLite，启动后端，不需要回滚数据（迁移过程没写 SQLite 原库，只读）；迁移失败的 PostgreSQL 实例删除重建，下次修正脚本后再试。

## 8. 升级与回滚操作规范

1. 升级流程。每次发版前从最新备份做一次恢复演练（小版本至少抽查一个项目能正常打开）；先在 staging 环境部署新版本，跑 Milestone 2 E2E 套件 + Milestone 3 回归套件；staging 全绿后在生产环境执行：rsync 新 dist 到 .new 临时目录、备份当前 .bak、切换新 dist 原子替换、`systemctl restart en18031.service`、立即调 `/health` 检查、打开一个已知正常的项目详情页做人工冒烟。

2. 回滚触发条件。出现任一条件立即回滚：健康检查连续失败 2 次；重启 2 分钟内仍有接口 500 率 >5%；任何项目的报告导出结果与升级前快照不一致（PDF 对比哈希）；用户反馈严重功能回归。

3. 回滚执行。把 dist 从 .bak 恢复、systemctl restart 后端、验证健康检查恢复、重新跑至少 1 个完整项目、写升级回滚的事故报告（即使回滚成功也要写根因分析报告，避免下次同样问题再次发生）。

## 9. Electron 便携版打包说明（可选）

1. 什么情况下才需要。审计现场无网络、目标设备需本地网线直连笔记本、合规团队有"离线单电脑审计"的硬性要求；有任一情况时才做 Electron 打包，否则 Web-First 足够。

2. 打包思路。Electron 主进程启动时：在用户目录下创建 `.en18031-desktop/` 作为 data 目录（SQLite、文件证据、日志都放这里），找到内置的后端 dist，随机选一个 3000~4000 未被占用的端口起 HTTP/WS 服务，等后端健康检查 ok 后，BrowserWindow 加载 `http://127.0.0.1:<port>/`，VITE_DEPLOY_MODE 设为 desktop，所以前端 Header 显示"本地便携模式"不显示服务器 URL；窗口关闭时主进程给后端发 SIGTERM 等待优雅退出，超时后强制 kill。

3. 注意事项。Electron 版的后端是本机唯一实例，多个窗口共用同一个后端进程；Node.js 原生模块（better-sqlite3、node-pty）必须按 Electron 版本重新预编译（用 electron-rebuild 或 electron-builder 配置 npmRebuild）；Windows 下 nmap 需要额外安装 WinPcap/npcap 驱动，安装包要附带驱动安装器并提示用户管理员权限运行；macOS 下需要代码签名 + 公证，否则用户首次打开会被 Gatekeeper 拦截。
