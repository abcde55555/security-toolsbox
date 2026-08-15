# en18031-firmware-secret-scan · 固件硬编码密钥扫描

> 内置模组 · `interactionMode=form` · `category=firmware-analysis` · `version=1.0.0` · `sdkVersion=^1.0.0`

对固件镜像做**静态**字符串扫描：检出硬编码口令 / API Key / Token / 私钥等敏感凭据，
识别 JTAG/UART/debug console 等调试接口线索，并（可选）用 binwalk 枚举内嵌组件。
全过程只读固件文件，不解包、不刷写、不执行固件内代码。

## 覆盖条款

| clauseId | 条款标题 | 声明严重度 | 判定逻辑 |
| --- | --- | --- | --- |
| `5.5-1` | 固件中不得存在硬编码密钥或凭据 | high | 命中任一凭据特征 → **fail(high)**，证据为命中行（每行截断至 120 字符脱敏）；无命中 → pass(middle) |
| `5.5-3` | 调试接口 JTAG/UART 默认关闭 | middle | 命中 `jtag`/`uart`/`debug console` → **fail(middle)**，要求人工确认量产固件是否已关闭调试接口；无命中 → pass(middle) |

`5.5-2`（防逆向读取保护）需要硬件侧检测，不在本模组范围内。
模组**始终返回 2 条 verdict**，保证声明条款集合与返回条款集合完全一致。

### 特征规则

```
凭据：(password|passwd|api[_-]?key|secret|token|private[_-]?key|aws_|BEGIN RSA|BEGIN PRIVATE)
调试：(jtag|uart|debug console)
```

两条规则都以 `grep -iE` 大小写不敏感匹配。命中即判 fail —— 这是**保守策略**：
特征字符串可能来自第三方库的字段名而非真实凭据，因此证据里保留原始上下文供人工复核，
确认为误报后可在平台做 verdict override 并填写理由。

## 脱敏

- 每条命中行先压缩连续空白，再截断到 **120 字符**，超出部分替换为 `…[已截断,原长N]`。
- 结果按脱敏后的文本去重，避免同一行重复占用证据体积。
- 命中行数上限：`quick` 100 条 / `full` 1000 条（调试特征 50 / 200 条）。

## 外部依赖

| 依赖 | 必需性 | 用途 | 缺失后果 |
| --- | --- | --- | --- |
| `strings`（binutils）+ `grep` + `head` | **必需** | 字符串抽取与特征匹配 | `status=fail`，`error.code=STRINGS_UNAVAILABLE`，2 条条款 fail(high) |
| `binwalk` | 可选 | 枚举内嵌文件系统/压缩组件 | **不影响整体结论**：写入一条 `assertion`（severity=middle）说明「binwalk 未安装，未产出内嵌组件清单，建议安装后复测」，`status` 仍为 `success` |

健康检查命令为 `strings --version`。所有命令通过 `context.engine.runCommand` 执行
（`cwd` 设为固件文件所在目录），不直接使用 `child_process`。

实际执行的命令（`quick` 模式）：

```
strings '<file>' | grep -iE '(password|passwd|api[_-]?key|secret|token|private[_-]?key|aws_|BEGIN RSA|BEGIN PRIVATE)' | head -100 > '<tmp>/en18031-fw-secrets-*.txt'
strings '<file>' | grep -iE '(jtag|uart|debug console)' | head -50 > '<tmp>/en18031-fw-debug-*.txt'
binwalk '<file>'
```

`full` 模式额外加 `strings -a -n 4`，并把命中上限提高到 1000 / 200 条。
结果写临时文件而非 stdout，避免超大输出压垮日志通道；临时文件在读取完成后于 `finally` 中删除。

## 输入参数（formFields）

| id | type / format | 默认值 | 说明 |
| --- | --- | --- | --- |
| `firmwareFile` | file / `path` | — | 必填，`accept=.bin,.hex,.img,.tar,.gz`，`maxSizeMb=200`。服务端处理上传后把**绝对路径**注入该参数 |
| `scanDepth` | select | `quick` | `quick` 仅特征匹配；`full` 加 `-a -n 4` 且提高命中上限 |
| `timeoutMs` | number | `300000` | 30000–3600000，每条命令各自的超时 |

## 安全设计

1. 路径必须是绝对路径，且不得包含 `' " \` $ ; & | < > \n \r \ * ?` 任一字符（空格允许，命令中用单引号包裹）。
2. 扫描前用 `fs.stat` 确认文件存在、是普通文件、非空。
3. 任一校验失败 → 不执行任何命令，`status=fail` / `exitCode=2` + `validation_error` 证据，2 条条款 fail(high)。

## 执行状态语义

| 场景 | status |
| --- | --- |
| 扫描完成（含 binwalk 缺失） | `success` |
| 参数/文件校验失败 | `fail`（exitCode=2） |
| `strings`/`grep` 缺失 | `fail` + `error.code=STRINGS_UNAVAILABLE` |
| 任一 strings 命令超时/取消 | `timeout` / `cancelled`，2 条 fail(middle) |
| 模组异常 | `crash`，2 条 fail(high) |

> 注：需求描述中对「binwalk 缺失」既提到 `partial` 也提到 `success`，本实现按更具体的那条执行
> —— **status 保持 `success`，并追加一条 middle 级 `assertion` 警告证据**，因为 binwalk 只影响
> 补充信息、不影响两条条款的判定依据。

## 常见问题

- **命中的都是库里的字段名，算误报吗？** 很可能是。本模组是保守筛查，证据保留上下文供人工复核，
  确认误报后走 verdict override 流程。
- **加密/压缩固件扫不出东西**：`strings` 对压缩或加密镜像基本无效，需先用 binwalk 解包后再对解出的
  文件系统逐个扫描；当前版本不自动解包（`binwalk -e` 会落盘大量文件，属于有副作用操作）。
- **文件太大**：`maxSizeMb=200` 是表单侧限制；超大镜像建议先解包后分片扫描。
