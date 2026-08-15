# en18031-default-cred-check · 默认口令风险筛查

> 内置模组 · `interactionMode=form` · `category=credential-compliance` · `version=1.0.0` · `sdkVersion=^1.0.0`

## 这是筛查模组，不是爆破模组

本模组**不会**尝试任何口令登录、字典爆破、账号枚举或任何可能触发账号锁定 / 服务拒绝的操作。
它只做一件事：探测常见管理服务端口是否开放，把「默认口令风险面」标记出来，
生成需要人工核实的条款判定。判定 fail 的含义是 **「存在默认口令风险面，需人工核实」**，
而不是「已确认存在默认口令」。这一点在每次执行的第一条 `assertion` 证据里都会明确写出。

真正的默认口令验证需要授权后的人工登录测试，或使用独立的授权爆破工具（不在内置模组范围内）。

## 覆盖条款

| clauseId | 条款标题 | 声明严重度 | 判定逻辑 |
| --- | --- | --- | --- |
| `5.1-1` | 默认账户必须强制修改密码 | high | 任一被勾选的管理服务端口开放 → **fail(high)**，reason=「检测到 `<service>(<port>)` 服务开放，需人工核实默认口令是否已修改」；全部未开放 → pass(middle)「未检测到相关管理服务」 |
| `5.3-4` | 默认口令必须修改 | high | 同 `5.1-1`（同一组证据，判定同源） |

`5.3-4` 见《04-Clause-Mapping》第 7.1 节网络通信类条款清单。若条款种子库尚未收录该 ID，
引擎侧会在写入 verdict 时报「条款库找不到」并按契约违规处理 —— 这是预期行为，
说明种子数据需要补齐，而不是模组配置错误。

模组**始终返回 2 条 verdict**，保证声明条款集合与返回条款集合完全一致。

## 服务 → 端口映射

| 服务 | 端口 |
| --- | --- |
| `ssh` | 22 |
| `telnet` | 23 |
| `http` | 80 |
| `https` | 443 |
| `ftp` | 21 |

端口号完全来自模组内部的映射表，**不含任何用户输入**，因此 `nmap -p <ports> --open <ip>`
的端口部分天然无注入风险；`targetIp` 另外通过 `isValidIp()` 严格校验。

## 外部依赖

| 依赖 | 用途 | 缺失后果 |
| --- | --- | --- |
| `nmap` | 端口开放性探测 | 健康检查 `nmap --version` 变红；执行时 exitCode≠0 → `status=fail`，2 条条款 fail(high) |

命令通过 `context.engine.runCommand` 执行，不直接使用 `child_process`。
实际命令形如：

```
nmap -p 21,22,23,80,443 --open 192.168.1.100
```

## 输入参数（formFields）

| id | type | 默认值 | 说明 |
| --- | --- | --- | --- |
| `targetIp` | text / `ip` | — | 必填，单个 IPv4 |
| `servicesToCheck` | multiselect | `[ssh, telnet, http, https, ftp]` | 至少选一项；含未知服务名会被拦截 |
| `timeoutMs` | number | `10000` | 3000–300000 |

## 证据

1. `assertion`（首条，必存在）：筛查性质说明 + 实际命令 + 覆盖服务 + 判定含义声明。
2. `assertion`（每个开放服务一条，severity=high）：服务名/端口/banner + 「需人工核实默认口令」提示。
3. `stdout_line`：nmap 输出尾部 3000 字符。

## 执行状态语义

| 场景 | status | verdicts |
| --- | --- | --- |
| 探测完成（无论是否有开放端口） | `success` | 2 条按开放情况判定 |
| 参数校验失败 | `fail`（exitCode=2） | 2 条 fail(high) |
| nmap 非零退出 | `fail` | 2 条 fail(high) |
| 超时 / 取消 | `timeout` / `cancelled` | 2 条 fail(middle) |
| 模组异常 | `crash` | 2 条 fail(high) |

## 常见问题

- **为什么开放 SSH 也算 fail？** 因为 SSH 上仍可能存在未修改的出厂账号。本条款要求
  「默认账户必须强制修改密码」，模组无法在不登录的前提下证明这一点，因此按「需人工核实」判 fail
  并在报告里作为待人工确认项。人工确认已修改后，可在平台上做 verdict override 并填写理由。
- **想缩小范围**：取消勾选不需要的服务，例如只保留 `telnet`/`ftp` 这类高危明文服务。
