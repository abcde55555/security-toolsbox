# 04 · modules 测试模块包（@en18031/modules）

> 位置：`packages/modules` · 版本 0.1.0 · 依赖 `@en18031/shared`(workspace) + `fast-xml-parser` + `zod`
> 定位：平台**内置安全检测模块**的官方实现集。四个模块均为只读、非破坏性检查，通过 `ModuleLoader` 在服务启动时注册为 `builtin=true` 工具。

## 1. 包结构

```
src/
├── index.ts                        # 汇出 builtInModules 清单（顺序固定）
├── __tests__/built-in-modules.test.ts   # SDK 契约回归测试（6 类断言）
└── en18031-{port-check|crypto-check|default-cred-check|firmware-secret-scan}/
    ├── module.config.ts            # ModuleConfig 声明（export default config）
    ├── index.ts                    # BaseModule 实现（export default 单例）
    ├── README.md                   # 模块文档（契约测试强制存在且覆盖条款 id）
    └── __tests__/*.test.ts         # 纯函数单测（解析器/检测函数）
```

入口 `src/index.ts`：

```ts
export const builtInModules: BaseModule[] = [
  portCheck, cryptoCheck, defaultCredCheck, firmwareSecretScan,
];
```

启动时由 server 的 `ModuleLoader.loadBuiltins()` 读取，逐个过 `moduleConfigSchema` 校验后注册为工具；`runSeed()` 再把它们 upsert 进 tools 表。

## 2. 模块契约（SDK）

### 2.1 配置侧 —— `module.config.ts`

导出满足 `ModuleConfig`（来自 @en18031/shared）的常量：

```ts
interface ModuleConfig {
  id: string;                       // 全局唯一，如 'en18031-crypto-check'
  name: string;                     // 中文展示名
  version: string;                  // 均为 '1.0.0'
  sdkVersion: string;               // 兼容 SDK 区间，均为 '^1.0.0'
  type: 'module'; interactionMode: 'form';
  tags: string[]; category: ToolCategory;
  healthCheck?: { command: string; timeoutMs?: number };  // 健康检查命令
  formFields: FormField[];          // 参数表单声明 → 前端 DynamicForm 渲染
  clauses: ModuleClauseDecl[];      // [{ clauseId, title, severity }] 覆盖的条款
}
```

### 2.2 实现侧 —— `index.ts`

每个模块导出一个实现 `BaseModule` 的类单例：

```ts
class XxxModule implements BaseModule {
  readonly config: ModuleConfig;
  execute(params: Record<string, unknown>,
          context: ModuleExecuteContext): Promise<ExecutionResult>;
}
```

`context.engine.runCommand(command, opts?)` 是模块执行外部命令（nmap/openssl/strings/binwalk…）的**唯一通道**——统一获得超时、取消、逐行进度回调与审计。契约测试静态扫描源码，禁止模块直接 `import child_process` 或使用 `require(`。

### 2.3 四模块共同工程模式（铁律）

| 模式 | 说明 |
| --- | --- |
| `CLAUSE_IDS` 常量 | 「本模组声明并且必须全量返回的条款集合」——每次 execute 返回的 verdict clauseId 集合必须与 `config.clauses` 完全一致（SDK 契约校验拦截） |
| `pushEvidence(list,type,content,severity,path?)` | 追加证据并返回下标，该下标即 verdict 的 `evidenceRefs` 引用值 |
| `allClauses(pass,severity,reason,refs)` | 把同一判定复制给全部条款（校验失败/取消/超时/崩溃等全局分支用），保证「声明的 == 返回的」 |
| `finish()` 闭包 | 发送 percent=100 进度后组装 ExecutionResult（`runId:''` 由引擎回填） |
| 取消竞速 | `Promise.race([engine.runCommand(...), cancelToken.promise.then(()=>({status:'cancelled',exitCode:137,...}))])` |
| 失败保守判定 | 参数非法/工具缺失→fail(high)；取消/超时→fail(middle)「结果未知，建议补测」；内部异常→crash + 全条款 fail(high)，绝不让判定"静默通过" |

## 3. 四个内置模块详解

### 3.1 en18031-port-check · 端口合规检测

| 项 | 内容 |
| --- | --- |
| 条款 | **5.3-1** 不必要网络服务禁用(middle)、**5.3-2** 明文管理协议不得开放(high)、**5.3-3** 必须加密管理协议(middle)、**5.3-5** 服务发现端口不外暴(middle) |
| 分类 / 健康检查 | network-compliance / `nmap --version` |
| 表单参数 | `targetIp`(ip,必填)、`portRange`(port-range,默认 1-10000)、`scanType`(sS/sT/sU)、`timeoutMs`(默认300000)、`includeServiceVersion`(默认 true→加 `-sV`) |

**执行流程**：

1. **注入防护三重硬校验**（在 SDK format 校验之上再加一道）：`targetIp` 过 `isValidIp()`；`portRange` 同时过白名单 `/^[0-9,-]+$/`、shell 元字符黑名单 `SHELL_META=/[;&|`$(){}<>\\'"\s\n\r*?!#~[\]]/` 与数值区间校验；`scanType ∈ {sS,sT,sU}`。任一失败 → 不执行任何命令，status=fail/exitCode=2/`VALIDATION_ERROR`。
2. 构造命令：`nmap <scanFlag> [-sV] -p <range> --open -oX <tmpdir>/en18031-port-check-<safeStepId>-<ts>.xml <targetIp>`，与 cancelToken 竞速执行。
3. 解析三件套（导出供测试）：`parseNmapXml()`（fast-xml-parser，取 `nmaprun.host[].ports[].port[]` 中 state=open 的条目）、`parseNmapText()`（正则解析文本输出）、`parseOpenPorts()`（自动识别 XML/文本，XML 读盘失败回退 stdout）。
4. **四条判定逻辑**：
   - 5.3-2：`isTelnetOpen()`(23/telnet) 或 `isPlainHttpOpen()`(80/http/http-alt/http-proxy，显式排除 https/443/8443 防误判) → fail+high；
   - 5.3-1：开放端口超出白名单 `WHITELIST_PORTS=[22,443]` → fail+middle 并逐一列举；
   - 5.3-3：`hasSsh()` ∨ `hasHttps()` 任一成立 → pass；两者皆无 → **fail+high**；
   - 5.3-5：命中 `DISCOVERY_PORTS=[1900,5353,5000]` → fail+middle。

关键导出：`CLAUSE_IDS`、`parseNmapXml`、`parseNmapText`、`parseOpenPorts`、接口 `OpenPort{port,proto,service,version}`。

### 3.2 en18031-crypto-check · 加密传输合规检测

| 项 | 内容 |
| --- | --- |
| 条款 | **5.4-1** 弱加密套件/协议(high)、**5.4-2** TLS 证书合法有效(middle) |
| 分类 / 健康检查 | crypto-compliance / `openssl version` |
| 表单参数 | `targetIp`(ip,必填)、`port`(number,默认443,1–65535)、`timeoutMs`(默认30000) |

**执行流程**：

1. 参数校验（isValidIp + port 整数域 + SHELL_META）后依次跑两条命令：
   - 证书抓取：``openssl s_client -connect ip:port -servername ip </dev/null | openssl x509 -noout -dates -subject -issuer -serial``
   - 套件枚举：``nmap --script ssl-enum-ciphers -p port ip``
2. **证书解析** `parseCertInfo(): CertInfo{reachable,selfSigned,expired,notYetValid,notBefore,notAfter,subject,issuer,serial}` —— subject 与 issuer 归一化相等即自签名；notAfter<now 即过期。
3. **弱加密检测** `detectWeakCrypto(): {findings,hasCipherInfo,protocols}`：
   - 只分析以 `|` 开头的 nmap NSE 输出行（`scriptLines()`）；
   - **token 化匹配而非裸正则**：按非字母数字切分大写，规避下划线写法漏检与误检；
   - 特征库 `WEAK_PATTERNS` 7 条：RC4 / 3DES(Sweet32) / 单DES / CBC+SHA1(Lucky13/BEAST) / NULL / EXPORT / 匿名密钥交换(ANON/ADH/AECDH…)；
   - 弱协议正则捕获 SSLv2/SSLv3/TLSv1.0/TLSv1.1；
   - **分段状态机**排除 `compressors:` 段的 NULL（未启用压缩是安全配置，否则必误报）。
4. 判定：有 findings → fail+high；拿不到套件信息 → fail+middle（要求补测 openssl -cipher/testssl.sh）；证书不可达/过期/未生效/自签名 → 5.4-2 fail。两条探测全空 → status=fail + `TLS_TARGET_UNREACHABLE`；只有其一 → partial。

关键导出：`detectWeakCrypto`、`parseCertInfo`、接口 `WeakFinding`、`CertInfo`。

### 3.3 en18031-default-cred-check · 默认口令风险筛查

| 项 | 内容 |
| --- | --- |
| 条款 | **5.1-1** 默认账户必须改密(high)、**5.3-4** 默认口令必须修改(high) |
| 分类 / 健康检查 | credential-compliance / `nmap --version` |
| 表单参数 | `targetIp`(ip,必填)、`servicesToCheck`(multiselect: ssh/telnet/http/https/ftp)、`timeoutMs`(默认10000) |

**定位**：**筛查模组而非爆破模组** —— 不做口令登录、字典爆破、账号枚举等破坏性操作。fail 含义是「存在默认口令风险面需人工核实」，此性质声明作为第一条 assertion 证据落档。

**算法**：端口完全来自内部映射 `SERVICE_PORTS={ssh:22,telnet:23,http:80,https:443,ftp:21}`（不含用户输入，天然无注入面），去重排序后执行 `nmap -p 21,22,… --open targetIp`；`parseOpenServices()` 正则解析开放服务（含 banner）；任何选中服务开放 → 两条款 fail+high 列出服务清单待人工核实；无开放 → pass+middle。无论结果 status=success。

### 3.4 en18031-firmware-secret-scan · 固件硬编码密钥扫描

| 项 | 内容 |
| --- | --- |
| 条款 | **5.5-1** 固件不得含硬编码密钥/凭据(high)、**5.5-3** JTAG/UART 调试接口默认关闭(middle) |
| 分类 / 健康检查 | firmware-analysis / `strings --version` |
| 表单参数 | `firmwareFile`(file,.bin/.hex/.img/.tar/.gz,maxSizeMb 200,上传后注入绝对路径)、`scanDepth`(quick/full)、`timeoutMs`(默认300000) |
| 外部依赖 | 必需 strings(binutils)+grep+head；可选 binwalk（缺失仅记注记不影响结论） |

**算法**：

1. 文件路径黑名单 `PATH_FORBIDDEN=/['"$;&|<>\n\r\\*?]/` 校验 + `fs.stat` 确认存在且非空；
2. 三条命令（结果写临时文件防 stdout 爆量）：
   ```bash
   strings '<file>' | grep -iE '(password|passwd|api[_-]?key|secret|token|private[_-]?key|aws_|BEGIN RSA|BEGIN PRIVATE)' | head -N > secrets.txt
   strings '<file>' | grep -iE '(jtag|uart|debug console)' | head -M > debug.txt
   binwalk '<file>'
   ```
   quick 上限 N=100/M=50，full 为 1000/200；临时文件读不到时回退解析命令 stdout；
3. `isToolMissing(tool,res)`：exitCode 127 或 stderr 匹配 "not found/No such file" 等 —— strings/grep 缺失 → fail + `STRINGS_UNAVAILABLE`；
4. **脱敏管线** `redactLine()`(压缩空白+截断120字符)/`redactMatches()`(逐行脱敏去重限流) —— 保证真实密钥不进入报告与证据库；
5. binwalk 结果四种情况各记一条注记证据，均不影响整体结论。

## 4. 契约测试（built-in-modules.test.ts）

vitest 用例锁定的 6 类行为，任何新内置模块都必须通过：

1. **数量与顺序**：id 序列严格等于 `[port-check, crypto-check, default-cred-check, firmware-secret-scan]`；
2. **schema 合法**：config 通过 shared 的 `moduleConfigSchema.safeParse`；
3. **纯数据可序列化**：`JSON.parse(JSON.stringify(config))` 深度相等（无函数/Symbol/循环引用，可安全入库快照）;
4. **契约不变式**：id 全局唯一、sdkVersion='^1.0.0'、type='module'、interactionMode='form'、tags 非空、clauses 非空且 clauseId 无重复、execute 是函数；
5. **安全约束**：静态扫描源码禁止 `child_process` 与 `require(`（强制走 engine.runCommand 通道）；
6. **文档完备**：README.md 存在且包含模块 id 与每一个 clauseId（文档与代码同步演进）。

另有各模块 `__tests__/*.test.ts` 对纯函数（parseNmapXml/detectWeakCrypto/parseCertInfo/redactMatches/parseOpenServices 等）做单元验证。

## 5. 如何新增一个内置模块（开发者指南）

1. 在 `packages/modules/src/en18031-<name>/` 下创建 `module.config.ts`（ModuleConfig，clauses 必须存在于条款种子库）与 `index.ts`（实现 BaseModule 单例，遵守 §2.3 铁律）；
2. 编写 `README.md`（覆盖全部 clauseId）与 `__tests__` 纯函数用例；
3. 在包入口注册进 `builtInModules`（注意契约测试锁定顺序，需同步更新断言）；
4. 重启 server：`loadBuiltins()` 自动 schema 校验并注册工具，`runSeed()` upsert 到 tools 表（builtin=true），前端工具库立即可见。
