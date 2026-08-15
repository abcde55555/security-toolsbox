# EN18031 合规测试平台 · 内置模组 SDK 契约 v1

> **文档版本**：v1.0（MVP 首个稳定版，禁止破坏性变更；只能向后加字段与可选枚举值）
> **适用读者**：内置合规模组开发工程师、自定义表单型工具的企业用户、SDK 维护者
> **读完后你能做的事**：按本文契约开发一个新的合规模组，无需询问核心层工程师即可跑通「参数表单 → 执行 → 条款判定 → 报告汇总」全流程。

## 1. SDK 设计原则

1. 契约优先。所有接口、枚举、数据结构在本文定义，SDK 版本号与契约严格对齐；核心层只按 v1 契约解析模组返回值，不做容错性猜测解析，避免模组返回"看起来差不多"的结构导致报告页 silently 漏数据。

2. 模组 = 纯业务 + 标准接口。模组不需要关心 UI 渲染、终端显示、日志存储，这些由平台核心层处理；模组只需：提供一份 JSON-Schema 格式的表单定义、一个 execute 方法、方法内按需调用 onProgress 和读取 cancelToken，最后返回标准化 ExecutionResult。

3. 执行不可中断的责任在模组。如果模组内部起了子进程或长时间循环，必须注册 cancelToken 的回调并主动清理；平台核心层只会触发 cancelToken 并等待最多 30 秒，超时后将强制终止但不保证模组侧的资源释放。

4. 自定义工具也能用表单模式。本文约定的 SDK 不仅适用于内置模组 type='module'，也同样适用于用户注册的自定义工具 type='custom'，只要在工具注册时提供 formFields schema 并实现一段标准 execute 包装（Electron 侧可以是子进程调用 + JSON 输出解析，或自定义 JS 包装类）。

## 2. 模组定义文件（module.config.js / module.config.json）

每个模组的顶层配置文件声明如下字段。字段 id 是字符串，全局唯一，推荐命名风格 `domain-scope-action`，例子 en18031-port-check、en18031-crypto-check、firmware-unpack-check；字段 name 是展示名；字段 version 遵循 semver x.y.z；字段 type 固定枚举内置 module 或自定义 custom；字段 interactionMode 固定枚举 form 或 cmd，表单交互型必须写 form；字段 author 可选；字段 description 是一句话描述；字段 tags 是字符串数组，首期推荐包含 EN18031-ch5、非破坏性、固件分析、网络扫描 等约定标签；字段 healthCheck 是个对象，含 command 字段如 `nmap --version` 和 timeoutMs 字段，默认 5000；字段 formFields 是 JSON-Schema 子集数组，见下一节；字段 clauses 数组是「本模组可能产出的条款判定集合」，每个元素含 clauseId 字符串、title 一句话说明、severity 枚举 high/middle/low。

## 3. 表单定义 FormFields JSON-Schema 子集

formFields 数组的每一项是一个字段描述对象，通用字段包含 id 字符串、label 展示名、type 枚举、placeholder 字符串、required 布尔、value 默认值、description 字段说明。以下是 type 及各自专属字段的完整枚举，模组开发不得使用下列未列出的 type 值。

1. type=text 单行文本。专属字段 regex 正则字符串，不填表示不做正则校验；专属字段 format 枚举，可取值 plain、ip、cidr、port-range、hostname、path，plain 表示原样，其它值由 SDK 校验器按格式规则校验，例如 ip 按 IPv4 格式、cidr 按 x.x.x.x/n。

2. type=number 数字。专属字段 min、max，不填表示不限制。

3. type=textarea 多行文本。行数默认 4，无需额外字段。

4. type=select 单选下拉。专属字段 options 数组，每项是字符串或 label+value 对象。

5. type=checkbox 布尔开关。无额外专属字段。

6. type=multiselect 多选下拉。专属字段 options 数组同上，返回值为字符串数组。

7. type=file 文件上传。专属字段 accept 字符串，例如 `.bin,.hex`，专属字段 maxSizeMb 数字，默认 100 MB。

8. type=stepper 分步字段。专属字段 steps 数组，每步的 title 和 fields 子数组，子数组中的字段类型同样是本节定义的 8 种之一。返回值以 stepId 为 key 的嵌套对象。

## 4. 参数校验规范

1. 校验责任。核心层在调用 execute 前会按 formFields 定义和 format/regex 跑一遍通用校验并返回给用户错误提示；模组内部仍必须做业务级的二次校验，例如"端口范围 1-65535 中不能为 22+80+443 的组合"这种业务语义校验，核心层校验器做不到。

2. 通用校验失败返回。核心层返回 `{ errors: [{ fieldId, message }] }` 结构给前端表单逐项高亮；模组内部校验失败时则在 execute 的返回值中把 status 设为 fail，并在 evidence 数组中追加一条类型为 validation_error 的证据记录。

3. 变量替换。formFields 中所有默认值或用户输入值中如果包含 `{{project.xxx}}`、`{{step.prevStepId.output.xxx}}` 占位符，核心层在传给 execute 之前已经全部替换为实际值；模组拿到的 params 全是可用最终值，不需要再处理占位符。

## 5. Module Base Class 与 execute 方法签名

1. BaseModule 接口。所有模组必须实现一个满足以下形状的类或工厂对象。字段 config 引用前面的 module.config 对象；方法 async execute(params, context)，返回值为 Promise<ExecutionResult>。

2. context 传入字段。context 固定包含 projectId 字符串、stepId 字符串、userId 字符串、variables 对象（完整的项目变量全集）、onProgress 回调函数、cancelToken 对象，字段 engine 类型为 ExecutionEngine 引用（当模组需要内部再调用命令行型工具时通过 engine.runCommand 复用同一套执行通道，而不是自己起子进程）。

3. onProgress 回调签名。`onProgress({ percent: 0..100 number, message: string, logLine?: string })`。percent 表示当前步骤总进度，message 是给用户看的一句话描述，logLine 可选字段会原样追加到终端实时输出。

4. cancelToken 使用。`cancelToken.promise` 是一个在用户点击终止时 resolve 的 Promise，模组内部在所有长循环处应当 `await Promise.race([myWork, cancelToken.promise])`，并在被取消时清理资源后返回 status=cancelled 结果。cancelToken.isRequested 同步布尔字段可用于轮询式检查。

## 6. ExecutionResult 返回结构（强制）

所有执行路径必须返回完全一致形状的对象。字段 runId 由核心层注入不需要模组生成；字段 status 枚举 success、fail、timeout、crash、partial、cancelled 六种；字段 exitCode 数字，命令行型写真实退出码，纯表单型如果没起子进程写 0 成功非 0 失败；字段 stdout 字符串，命令行型可原样写，表单型建议把关键步骤的可读文本串起来给审计看；字段 stderr 字符串，出错时必填；字段 durationMs 毫秒；字段 startedAt 和 finishedAt ISO 时间字符串；字段 array evidence，每个元素是 { type 枚举 stdout_line/assertion/validation_error/file_pointer, content 字符串, severity high/middle/low, path 可选文件路径 }；字段 array verdicts 是本模组对条款做出的所有判定，每个元素结构 { clauseId 字符串，必须能在 clause 库找到、pass 布尔、reason 一句话人类可读理由、severity 同上、evidenceRefs 数组引用 evidence 下标或 id }；字段 error 对象，可选，失败时填 { code 字符串、message 字符串、stack 可选堆栈 }。

## 7. 模组内部使用命令行工具的规范

1. 推荐做法。模组内如果需要执行 nmap、binwalk 等 CLI，必须走 context.engine.runCommand(command, { onProgress }) 而不是 require('child_process') 自己 spawn；理由是统一的日志写入、取消令牌传递、健康检查继承、超时控制、审计记录。

2. 不推荐但允许。如果模组确实需要完全控制子进程（例如需要持续读伪终端的交互输入），可以自己 spawn，但必须手动把输出通过 onProgress 的 logLine 转发，且必须注册 cancelToken 的 kill 回调，否则用户点击终止后进程会泄漏。

## 8. 条款判定输出的硬性规则

1. verdict.clauseId 必须匹配条款库里存在的记录。如果判定的是组合条款（例如 5.3 整个大节），verdict.clauseId 可以写 5.3，但条款库里必须有对应的父条款记录。

2. 每个 verdict.evidenceRefs 至少引用一条 evidence。平台在报告页展示「依据证据」时会从 evidenceRefs 拉具体内容，引用空数组意味着判定无证据，将被 ClauseMappingService 校验拦截并把 verdict 的 pass 自动降级为 false、severity 改为 high，理由写明为"判定缺失证据"。

3. severity 与 pass 的组合约束。pass=true 的 verdict，severity 只允许是 low 或 middle，不允许是 high，因为通过的判定不应该是高风险；平台发现 high+pass 时会强制改写为 middle 并在日志里记录一个 SDK 契约警告。pass=false 的 verdict 可以任意 severity。

## 9. 示例：一个最小可运行的端口合规模组骨架

以代码块形式给出骨架示例，只展示契约结构，不实现业务逻辑。具体业务代码由模组开发者按实际 EN18031 判定规则实现。骨架展示 config 对象的字段填充、formFields 的 4 个常用字段示例、execute 方法内读取 params、调 engine.runCommand、收集 evidence 与 verdicts、处理取消令牌、处理校验失败。

## 10. SDK 版本与兼容性策略

1. 版本号。本文档 v1.0 对应 SDK 包版本 1.x.y；任何只增字段、只加枚举值、只加可选参数的变更，次版本号加 1；任何字段改名、删除、枚举收窄的破坏性变更，主版本号加 1 并新建 SDK v2 文档。

2. 模组声明的兼容版本。每个模组 config 中必须显式加字段 `sdkVersion: '^1.0.0'` 声明其兼容范围；平台在加载模组时先做 semver 匹配，不兼容的模组直接拒绝加载，健康灯置为红色，理由写明为"SDK 版本不匹配"。

3. 首版 v1 冻结后 6 个月内不发布 v2，避免模组生态碎片化。
