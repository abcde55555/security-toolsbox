# dsh（DeepSeek Harness）集成代价评估

> 评估时间：v0.7 迭代期。结论先行：**现阶段不建议整体替换，建议局部借鉴**；触发重评估的条件见文末。

## dsh 是什么

DeepSeek 官方开源 agent harness（`deepseek-harness`），基于 Cordis 的"一切皆插件"架构：

- **运行时内核**：agent-loop、session 持久化、system-prompt、工具注册（packages/core/*）
- **能力族**：llm / shell / web / subagent / **compaction**（上下文压缩）/ sandbox / approval / skills / workflow 等 40+ 包
- **产品形态**：自带 Web UI（bundle: base → web-app）与 headless runner
- **成熟度**：官方声明 developer preview，「THERE WILL BE COMPACTIBILITY-BREAKING CHANGES」

## 两条集成路径对比

### 路径 A：整体替换自研 Agent 运行时

把 plannerLoop / toolBridge / humanStepCoordinator / phaseMachine 换成 dsh 插件树。

| 维度 | 评估 |
| --- | --- |
| 直接收益 | 成熟的 loop/压缩(compaction)/子代理/沙箱审批/会话持久化，均为产品级实现 |
| 架构范式 | Cordis 插件树 + Service Definition/Consumer 缝合 vs 现有 Fastify 分层服务——两套世界观 |
| 领域语义迁移 | 四阶段状态机、确定性判定护栏（AI 只供 clauseId/evidence）、人工步骤协调器、叶子条款口径——全部要改写为插件并保持现有测试语义 |
| 前端 | dsh 自带 Web UI 与本平台 antd 会话页是两套壳；要么换壳要么做桥接，均不便宜 |
| 数据模型 | agent_sessions/events/verdicts ↔ dsh session log 需要映射或迁移 |
| 上游风险 | preview 期破坏性变更频繁 → 锁版本 + 持续追平的长期税 |
| 工作量估计 | **3–6 人周起步**（不含前端换壳），且替换期间功能冻结 |

### 路径 B：保留自研运行时，局部借鉴（推荐）

我们已具备 dsh 关键能力的轻量等价物：

| dsh 能力 | 本平台对应物 | 本轮新增 |
| --- | --- | --- |
| compaction（摘要+工具结果剪枝） | — | 工具结果硬截断（1500 字符）+ 记忆库注入（v0.7）；旧轮次 LLM 摘要化为下一步迭代点 |
| skills | knowledge/skills 表 + search_skills/propose_skill | 已有 |
| subagent | —（暂无需求场景） | 待规模化再议 |
| sandbox/approval | 审计 + 判定人工复核 + 阶段边界触发器 | 领域内更贴合合规流程 |

## 结论

1. **平台核心价值在领域语义**（判定护栏、四阶段、报告口径），这是自研护城河；dsh 的通用能力我们已有够用的对应物。
2. 路径 A 的收益主要是"未来可能用得上的规模能力"，而成本是确定的三周级迁移 + 长期追平税——**当前不划算**。
3. 先把用户体验和 bug 清零（本轮即此策略），dsh 相关设计（capability seams、compaction 事件词汇表）作为我们演进 compaction/memory 的参考读物。

## 触发重评估的条件（满足任一再回头）

- dsh 进入 stable 且 API 稳定一个季度以上
- 出现真实的子代理/沙箱规模化需求（如并行测 50 台设备的编排）
- 自研 loop 的维护成本显著超过迁移成本时重新测算
