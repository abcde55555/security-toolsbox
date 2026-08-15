# en18031-crypto-check · 加密传输合规检测

> 内置模组 · `interactionMode=form` · `category=crypto-compliance` · `version=1.0.0` · `sdkVersion=^1.0.0`

对目标设备的 TLS 服务做两件事：用 `openssl s_client` 抓取证书元数据，用
`nmap --script ssl-enum-ciphers` 枚举支持的协议版本与加密套件，据此判定 EN18031 第 5.4 节的
弱加密与证书合规要求。全程只读、非破坏性，不做任何降级攻击或握手爆破。

## 覆盖条款

| clauseId | 条款标题 | 声明严重度 | 判定逻辑 |
| --- | --- | --- | --- |
| `5.4-1` | 通信加密套件不得使用已知弱算法 | high | 命中任一弱特征 → **fail(high)**；成功枚举且无命中 → pass(middle)；未能枚举（nmap/NSE 不可用、端口非 TLS）→ fail(middle)「无法证明不存在弱算法，要求补测」 |
| `5.4-2` | TLS 证书必须合法有效且正确配置 | middle | 证书过期 / 尚未生效 / 自签名（subject==issuer）/ 无法获取 → **fail(middle)**；均正常 → pass(middle) |

`5.4-3`（固件升级完整性校验与签名验证）属于固件升级流程，不在本模组范围内，由固件类模组覆盖。

模组**始终返回 2 条 verdict**，保证声明条款集合与返回条款集合完全一致。

### 弱加密特征库

判定基于「把输出行按非字母数字字符切分成 token 集合」再匹配，不用裸正则，
避免 `TLS_RSA_WITH_DES_CBC_SHA` 下划线写法漏检、以及 `AES_128_CBC_SHA256` 被 CBC-SHA1 规则误检。

| 特征 | 命中条件（token 集合） |
| --- | --- |
| RC4 流密码 | `RC4` / `RC4128` / `RC440` |
| 3DES（Sweet32） | `3DES` / `EDE3` / `DESEDE3` |
| 单 DES（56bit） | 含 `DES`/`DES40` 且不含 3DES 标记 |
| CBC + SHA1（Lucky13/BEAST） | 同时含 `CBC` 与 `SHA`/`SHA1` |
| NULL 加密/认证 | `NULL` |
| EXPORT 级弱密钥 | `EXPORT` / `EXP` |
| 匿名密钥交换 | `ANON` / `ADH` / `AECDH` / `DHANON` / `ECDHANON` |
| 不安全协议版本 | 行匹配 `SSLv2:` / `SSLv3:` / `TLSv1.0:` / `TLSv1.1:` |

只扫描 nmap NSE 输出行（以 `|` 开头的行），避免在无关文本上误报。

## 外部依赖

| 依赖 | 用途 | 缺失后果 |
| --- | --- | --- |
| `openssl` | `s_client` + `x509` 抓取证书有效期/subject/issuer/serial | 5.4-2 判 fail(middle)「无法获取证书」，status 至少降为 `partial` |
| `nmap` + `ssl-enum-ciphers` NSE 脚本 | 枚举协议版本与套件 | 5.4-1 判 fail(middle)「无法枚举」，status 至少降为 `partial` |

健康检查命令为 `openssl version`。两个命令都通过 `context.engine.runCommand` 执行，
不直接使用 `child_process`。

实际执行的两条命令：

```
openssl s_client -connect <ip>:<port> -servername <ip> </dev/null 2>/dev/null | openssl x509 -noout -dates -subject -issuer -serial 2>/dev/null
nmap --script ssl-enum-ciphers -p <port> <ip>
```

## 输入参数（formFields）

| id | type / format | 默认值 | 说明 |
| --- | --- | --- | --- |
| `targetIp` | text / `ip` | — | 必填，单个 IPv4 |
| `port` | number | `443` | 1–65535，TLS 服务端口 |
| `timeoutMs` | number | `30000` | 每条命令各自的超时上限 |

`targetIp` 必须通过 `isValidIp()`；`port` 必须是 1–65535 整数并通过 shell 元字符黑名单；
任一失败则不执行任何命令，直接 `status=fail` / `exitCode=2` + `validation_error` 证据，
2 条条款判 fail+high。

## 执行状态语义

| 场景 | status |
| --- | --- |
| 证书与套件都取到 | `success` |
| 只取到其中一项 | `partial`（另一条条款判 fail(middle) 并要求补测） |
| 两项都没取到（目标不可达 / 端口非 TLS / 工具缺失） | `fail` + `error.code=TLS_TARGET_UNREACHABLE` |
| 任一命令超时 / 被取消 | `timeout` / `cancelled`，2 条条款 fail(middle) |
| 参数校验失败 | `fail`，`exitCode=2`，2 条条款 fail(high) |
| 模组异常 | `crash`，2 条条款 fail(high) |

## 常见问题

- **自签名证书一定 fail 吗？** 是。EN18031 要求证书「合法有效且正确配置」，自签名无法建立信任链。
  设备出厂自签名属于常见现状，需要在合规评审中作为例外单独记录。
- **只支持 TLSv1.2 但套件里有 CBC-SHA1**：仍判 5.4-1 fail(high)，建议关闭 CBC 套件、只保留 AEAD（GCM/CHACHA20）。
- **只想看证书不跑 nmap**：当前版本两条命令都会跑；若目标环境没装 nmap，结果会是 `partial` 而非失败。
