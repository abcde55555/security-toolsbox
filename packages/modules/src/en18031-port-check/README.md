# en18031-port-check · 端口合规检测

> 内置模组 · `interactionMode=form` · `category=network-compliance` · `version=1.0.0` · `sdkVersion=^1.0.0`

基于 nmap SYN/Connect/UDP 扫描 + 服务版本探测，检测目标设备暴露的网络端口是否符合 EN18031
第 5.3 节「不必要网络服务必须禁用、明文管理协议不得开放、加密管理协议必须使用」的合规要求。

## 覆盖条款

| clauseId | 条款标题 | 声明严重度 | 判定逻辑 |
| --- | --- | --- | --- |
| `5.3-1` | 不必要网络服务必须禁用 | middle | 开放端口白名单为 `22`、`443`；任何白名单外的开放端口 → **fail(middle)**，逐一列举端口/协议/服务名要求人工核实是否业务必需；无白名单外端口 → pass(middle) |
| `5.3-2` | 明文管理协议 Telnet/HTTP 不得开放 | high | `23` 或 service=`telnet` 开放 → fail；`80` 或 service ∈ {`http`,`http-alt`,`http-proxy`} 开放 → fail，合计 **fail(high)**；均未开放 → pass(middle) |
| `5.3-3` | 必须使用加密管理协议 SSH/HTTPS | middle | 存在 `22`/service 含 `ssh` **或** `443`/`8443`/service 含 `https` → pass(middle)；两者都不存在 → **fail(high)**（无加密管理通道视为高危） |
| `5.3-5` | UPnP/SSDP/MDNS 不得对外网暴露 | middle | `1900`(UPnP/SSDP)、`5353`(mDNS)、`5000`(UPnP HTTP) 任一开放 → **fail(middle)**；均未开放 → pass(middle) |

模组**始终返回全部 4 条 verdict**（含参数校验失败、超时、取消、崩溃分支），保证
`config.clauses` 声明集合与返回的 `verdict.clauseId` 集合完全一致，不会触发 SDK 契约告警。

## 外部依赖

| 依赖 | 用途 | 缺失后果 |
| --- | --- | --- |
| `nmap`（建议 7.80+） | 端口扫描与服务版本探测 | 健康检查 `nmap --version` 变红；执行时 exitCode≠0 → status=fail，4 条条款 fail+high |
| root / 管理员权限 | `-sS` SYN 半开扫描、`-sU` UDP 扫描 | 无权限时请将 `scanType` 切换为 `sT`（Connect 扫描） |

模组通过 `context.engine.runCommand` 调用 nmap，**不直接使用 `child_process`**，因此日志、
审计、超时 kill、取消令牌都由核心执行通道统一接管。

## 输入参数（formFields）

| id | type / format | 默认值 | 说明 |
| --- | --- | --- | --- |
| `targetIp` | text / `ip` | — | 必填，单个 IPv4；多目标请用模板编排展开 |
| `portRange` | text / `port-range` | `1-10000` | 支持 `22`、`1-65535`、`22,80,443` |
| `scanType` | select | `sS` | `sS` SYN / `sT` Connect / `sU` UDP |
| `timeoutMs` | number | `300000` | 60000–3600000 |
| `includeServiceVersion` | checkbox | `true` | 勾选后追加 `-sV` |

实际执行命令形如：

```
nmap -sS -sV -p 1-10000 --open -oX <os.tmpdir()>/en18031-port-check-<stepId>-<ts>.xml 192.168.1.100
```

## 安全设计（命令注入防护）

命令是字符串拼接后交给 `runCommand`（SDK 未提供数组入参形式），因此模组在拼接**之前**做三层硬校验：

1. `targetIp` 必须通过 `@en18031/shared` 的 `isValidIp()`（严格 IPv4 正则）。
2. `portRange` 必须同时满足 `^[0-9,-]+$` 白名单、shell 元字符黑名单、以及 `isValidPortRange()` 的数值区间检查。
3. `scanType` 必须落在 `sS|sT|sU` 枚举内；`stepId` 参与临时文件名时按 `[^A-Za-z0-9_-]` 归一化。

任一校验失败 → 不执行任何命令，直接返回 `status=fail`、`exitCode=2`，
写入一条 `validation_error` 证据，并把 4 条条款判为 fail+high。
已有单测断言 `portRange = "22; rm -rf /tmp/test"` 被拦截且 `runCommand` 从未被调用。

## 证据与状态

- `file_pointer`：nmap `-oX` XML 落盘路径（`evidence.path` 同时携带该路径）。
- `stdout_line`：stdout 末尾 3000 字符，便于人工复核。
- `assertion`：开放端口汇总 + 每条条款的具体判定依据。

XML 在 `finally` 中删除，且**只在读取完成之后**删除；若 XML 读取失败（例如 nmap 未落盘），
模组会回退解析 stdout（同时兼容 XML 文本与 `22/tcp open ssh` 普通文本两种格式），
并在证据里记录回退原因。

| 场景 | status | exitCode | verdicts |
| --- | --- | --- | --- |
| 扫描成功 | `success` | 0 | 4 条按实际端口判定 |
| 参数校验失败 | `fail` | 2 | 4 条 fail + high |
| nmap 非零退出 | `fail` | nmap 退出码 | 4 条 fail + high |
| 超时 | `timeout` | — | 4 条 fail + middle（结果未知，建议补测） |
| 用户取消 | `cancelled` | 137 | 4 条 fail + middle |
| 模组异常 | `crash` | 1 | 4 条 fail + high |

## 与文档骨架的差异（已评审）

1. **修正 5.3-2 的 `https` 误判**：骨架用 `service.includes('http')` 判定明文 HTTP，会把 `https`
   一并判成明文（`'https'.includes('http') === true`），导致「仅开放 22/443」的合规设备被误判 fail。
   本实现改为服务名精确匹配并显式排除 `https`/`ssl*`/`443`/`8443`。
2. **参数校验失败也返回全部 4 条 verdict**（骨架只返回 `5.3-1`），以满足文档第 5 节坑 3
   「声明条款集合必须与返回条款集合完全一致」。
3. **临时文件目录用 `os.tmpdir()`** 而非硬编码 `/tmp`，提升跨平台可移植性。

## 常见问题

- **扫描很慢**：`-sV` 服务探测最耗时；先用小端口范围定位，再全量扫描；`timeoutMs` 上限 1 小时。
- **全部端口都扫不到**：目标可能屏蔽 ping/SYN，或需要 `-Pn`；当前版本未暴露该参数，可在编排层用自定义命令工具补测。
- **`5.3-1` 总是 fail**：白名单硬编码为 22/443，业务必需端口（如 8883 MQTT-TLS）需在合规评审中出具例外说明，或后续版本把白名单做成表单参数。
