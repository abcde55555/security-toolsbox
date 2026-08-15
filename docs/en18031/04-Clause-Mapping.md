# EN18031 合规测试平台 · 条款映射规范 v1

> **文档版本**：v1.0
> **适用读者**：ClauseMappingService 开发工程师、合规模组开发者、合规报告撰写人员
> **读完后你能做的事**：维护 EN18031 条款数据、将工具/命令/模组输出正确映射到条款、理解报告页的证据追溯链如何生成。

## 1. 为什么需要结构化条款映射

1. 现状问题。原型 v6 的工具描述和工具输出只有自然语言文本，报告端无法自动判定「某条 EN18031 条款是否被覆盖、是否通过」，仍然需要人工把 nmap 结果的"23/tcp open"手动抄到 5.3-2 不得开放 Telnet 条款下，效率低下且容易漏判。

2. 结构化目标。EN18031 条款库作为一等数据实体存在，每条工具/命令/模组都能映射到一个或多个条款编号；执行结果直接产出 verdict（含条款编号、pass/fail、证据引用），报告页 100% 基于 verdict 和证据库自动生成，不需要人工写报告正文。

3. 条款版本。不同年份版本的 EN18031 条款编号可能有调整；条款库必须带标准版本字段，项目创建时选择一个标准版本锁定，后续即使条款库升级也不影响已完成项目的历史报告。

## 2. 条款数据模型 Clause Entity

字段 clauseId 字符串，主键，格式约定为章节号-序号，如 5.3-2、4.1-11、6.2-1，父级章节用 5.3 形式不带横杠；字段 standardVersion 字符串，如 EN18031:2019；字段 chapter 字符串章节号；字段 title 字符串条款短标题；字段 description 字符串条款原文或完整中文翻译，支持多行 Markdown；字段 level 枚举，合规等级阈值 L1 基础或 L2 标准或 L3 增强，表示"至少哪一级的产品才要求覆盖本条款"；字段 testingMethod 字符串，标准里规定的测试方法描述，给审计员作为方法论参考；字段 defaultSeverity 枚举 high/middle/low，作为本条款默认严重度，模组可以在 verdict 中覆盖但建议保持一致；字段 parentId 字符串可空，引用父级 clauseId 构成章节树；字段 tags 字符串数组，可打 认证类、网络通信、加密传输、固件安全、身份认证 等维度标签。

## 3. 三层映射机制（命令级 / 模组判定级 / 自定义规则级）

1. 命令级映射。针对命令行型工具的具体预设命令，一条预设命令可以带 0~N 个 mappingRule。每个 mappingRule 结构包含 clauseId、matcher 类型 regex 或 contains 或 js-expression、pattern 匹配表达式、onMatch 枚举 verdict-pass 或 verdict-fail 或 evidence-only、severity 可覆盖。例子：nmap 的「-p 23 --script telnet-brute」预设命令配一条 mappingRule，regex 为 `23/tcp\s+open`，onMatch 为 verdict-fail，clauseId=5.3-2，表示命令输出匹配到 23 端口开放则判定该条款失败。

2. 模组判定级映射。针对表单交互型内置模组，执行结果的 verdicts 数组已经是「clauseId + pass + reason + evidenceRefs」结构；这是优先级最高、语义最准确的映射，不需要 ClauseMappingService 再做任何二次解析，直接落库为 ClauseVerdict 实体。

3. 自定义规则级映射。面向高级用户和 Audit 复核人员，允许在项目级临时追加一条映射规则，形状同命令级 mappingRule 但挂在 projectId 下；项目级规则只在该项目生效，可用于临时修正"模组漏判的某条条款"，但必须带 reason 并写审计日志，Admin 可看到哪些项目加了临时规则。

4. 命中优先级。模组判定级最高，命中后不再跑命令级和自定义级；命令级次之；自定义级最后，若已被高优先级判定过则自定义级的相同 clauseId 只能追加证据、不能覆盖 pass/fail 结论。

## 4. 判定产出 ClauseVerdict 实体

字段 verdictId 主键；字段 projectId、字段 runId、字段 stepId 三者关联到具体执行；字段 clauseId，对应条款库；字段 pass 布尔最终结论；字段 severity high/middle/low；字段 reason 一句话判定理由；字段 evidenceRefs 引用 evidence 的数组；字段 overridden 布尔，是否被自定义规则覆盖；字段 overrideReason 字符串，覆盖时必填并触发审计日志；字段 createdAt。

1. 未覆盖条款的报告处理。如果模板中的所有步骤跑完后，条款库里 level<=项目合规格的所有条款仍然没有对应 verdict，则报告页将这些条款标记为 not-covered 状态，合规定级计算时按 fail 处理。

2. 多次执行的条款结论合并。同一项目同一 clauseId 可能有多次执行的多条 verdict；报告页合并策略默认取最新一次，可选取"历史最佳"或"历史最差"，具体策略可在项目设置里切换。

## 5. 证据实体 Evidence Entity（配合 SDK 文档的 evidence 数组）

字段 evidenceId 主键；字段 runId；字段 stepId；字段 type 枚举 stdout_line、assertion、validation_error、file_pointer、screenshot；字段 content 字符串或文件地址；字段 severity；字段 createdAt；关联到 clause verdict 的 evidenceRefs。

1. 文件型证据。binwalk 解出的固件镜像、nuclei 导出的报告、抓包文件，都写入文件存储，evidence 中只存 file_pointer 路径和 hash 值，不可篡改；报告页导出 PDF 时按引用把关键文件作为附件打包或在 PDF 中给出 hash。

2. 不可删除约束。与审计日志同级别，evidence 一旦落库永不物理删除，软删除标记仅隐藏显示不抹除。

## 6. 合规定级计算规则（ReportService 内置）

1. 定级因子。因子 A：项目声明的目标合规格 L1/L2/L3；因子 B：条款库该规格下全部条款清单；因子 C：执行结果的 verdict；因子 D：任何一条 high severity 且 pass=false 的条款直接触发降级；因子 E：not-covered 条款数量。

2. 规则举例。目标 L3；条款库里 L3 适用的条款总数 N；若存在任意 1 条 high severity 条款 fail → 最终定级 FAIL；若 not-covered 条款数 > N×5% → 最终定级 CONDITIONAL PASS（条件通过，补完测试可升）；若所有适用条款 pass 且 not-covered 占比 ≤5% → 最终定级 PASS；若适用条款 fail 的总数在 N×10% 以内且无 high severity fail → 可评为 CONDITIONAL PASS 并列出整改项。具体数字阈值在 ReportService 的配置中集中管理，文档里只描述原则，上线前由合规负责人按甲方实际标准调整配置。

3. 定级透明。报告页除显示最终定级外，必须展示"本次定级是怎么算出来的"可视化分解图：适用条款数、通过/失败/未覆盖/条件通过各多少、触发降级的关键条款。

## 7. 种子条款库（首期 MVP 必须覆盖的最小集合）

1. 网络通信类。示例条款 5.3-1 所有不必要网络服务必须禁用；5.3-2 明文管理协议 Telnet/HTTP 不得开放；5.3-3 必须使用加密管理协议 SSH/HTTPS；5.3-4 默认口令必须修改；5.3-5 UPnP/SSDP/MDNS 等服务不得对外网暴露。

2. 加密传输类。示例条款 5.4-1 通信加密套件不得使用已知弱算法；5.4-2 TLS 证书必须合法有效且正确配置；5.4-3 固件升级过程必须完整性校验和签名验证。

3. 固件安全类。示例条款 5.5-1 固件中不得存在硬编码密钥或凭据；5.5-2 固件必须有防止逆向读取的保护措施；5.5-3 调试接口 JTAG/UART 默认关闭。

4. 身份认证与授权类。示例条款 5.1-1 默认账户必须强制修改密码；5.1-2 口令策略必须包含复杂度、长度、过期要求；5.1-3 登录失败次数锁定机制；5.2-1 权限分离至少区分管理员与普通用户。

5. 说明。以上条款编号和内容仅作种子数据结构示例，正式上线前必须对照 EN18031 原始条文逐条核对校准，条款库导入脚本单独维护、不写死在代码中，便于按最新版本修订。

## 8. 报告页的数据需求（供 ReportService 使用，最小字段集）

1. 项目元数据区。项目名、创建人、创建时间、运行时间范围、目标清单、绑定模板名与版本、标准版本、目标合规格、最终定级。

2. 仪表板区。适用条款总数、PASS 数、FAIL 数、NOT_COVERED 数、CONDITIONAL 数、按章节分类的通过率条形、按严重度分类的 FAIL 分布。

3. 条款详情区。按 chapter 分组展开，每个条款显示 clauseId、title、level、status、pass/fail/not-covered/conditional、默认严重度、判定 reason、关联证据列表（点开可查看 evidence 详情，文件类可下载或预览）、追溯执行（哪一步、什么命令或模组、执行时间、退出状态、运行的人）。

4. 整改建议区。所有 FAIL + NOT_COVERED 条款列出：条款引用、当前问题、整改建议、推荐的工具或模组、预计工作量 S/M/L。

5. 附录区。工具版本清单、审计日志摘要、执行过程中的异常记录（timeout/crash/partial）、证据文件清单哈希、导出日期、导出人。

## 9. 条款版本升级对已完成项目的策略

1. 新项目选新版本。条款库升级后，新建项目可选择新版本，旧版本继续保留归档。

2. 存量项目不自动迁移。已完成或进行中的项目按创建时锁定的 standardVersion 继续，不回溯变更 verdict；管理员可手动触发"尝试重新映射到新版条款库"的一次性操作，操作后写入审计日志，且保留历史报告快照不可丢失。

## 10. 与模组 SDK 的联调校验点

1. 模组返回 verdict 的 clauseId 必须在项目锁定的标准版本条款库中存在，否则 ClauseMappingService 写入一条 warning 日志并把该 verdict 的 pass 置 false、reason 写为"判定引用了无效条款编号，需联系模组开发者"。

2. 模组返回 evidenceRefs 必须指向本次执行收集到的 evidence 有效下标或 id，空数组或越界引用同样触发自动降级处理。
