# Persona-Bot v0.2.0 升级计划

> **基线版本**: v0.1.0 (tag: v0.1.0, 备份: persona-bot-backup-v0.1.0-20260405)
> **目标版本**: v0.2.0 (对标 MVP-00 ~ MVP-06 v5 架构)
> **创建日期**: 2026-04-05

---

## 1. 当前版本状态

### 已实现（v0.1.0）

| 模块 | 文件 | 状态 |
|------|------|------|
| Pipeline S1 消息调度 | `s1-message-dispatcher.ts` | ✅ 基础功能完成 |
| Pipeline S2 上下文组装 | `s2-context-assembler.ts` | ✅ 基础功能完成 |
| Pipeline S3+S4 认知生成 | `s3s4-cognitive-generator.ts` | ✅ 基础功能完成 |
| Pipeline S5 感知包装 | `s5-perception-wrapper.ts` | ⚠️ 仅有尾部裁剪+身份守卫 |
| Pipeline S6 出站调度 | `s6-outbound-scheduler.ts` | ✅ 基础功能完成 |
| Config: Schema/Loader/Interpreter | `config/*.ts` | ✅ MVP-02 规范已对齐 |
| Memory: 即时记忆 | `immediate-memory.ts` | ✅ 内存队列完成 |
| Memory: 工作记忆 | `working-memory.ts` | ✅ SQLite 基础表完成 |
| Memory: 记忆管理器 | `memory-manager.ts` | ✅ 聚合入口完成 |
| Engine: 时间引擎 | `time-engine.ts` | ✅ 基础功能完成 |
| Engine: 事件总线 | `event-bus.ts` | ✅ EventEmitter 完成 |
| Engine: 身份守卫 | `identity-guardian.ts` | ✅ 基础规则完成 |
| LLM Client | `llm-client.ts` | ✅ OpenAI Responses API |
| Prompt Builder | `prompt-builder.ts` | ✅ 四层 prompt 构建 |
| Lark Client | `lark-client.ts` | ✅ CLI 集成完成 |
| BUG-001~012 | 全部已修复 | ✅ |

### BUG 修复与 MVP Sprint 任务的对应关系

以下表格列出每个 BUG 修复实际验证/完成了哪些 MVP-05 Sprint 任务：

| BUG | 修复内容 | 对应 MVP-05 任务 | Sprint Day |
|-----|---------|-----------------|-----------|
| BUG-001 | Zod schema 重写对齐 MVP-02 规范 | Task 1.3 (schemas.ts) + Task 1.4 (parameter-interpreter.ts) | Day 1 ✅ |
| BUG-002 | 全局替换 config.meta.name 引用 | Task 1.2 (persona-loader.ts) 引用一致性 | Day 1 ✅ |
| BUG-003 | test fixture 对齐新 schema 约束 | Task 1.5 (配置相关单元测试) | Day 1 ✅ |
| BUG-004 | lark-cli sendText/replyText 重写 | Task 4.1 (lark-client.ts) | Day 4 ✅ |
| BUG-005 | API Key 从真实 HOME keychain 获取 | Task 5.2 (LLM 凭证配置) | Day 5 ✅ |
| BUG-006 | 解决 subscribe 单实例冲突 | Task 4.1 (Lark 事件订阅) | Day 4 ✅ |
| BUG-007 | --event-types 参数修正 | Task 4.1 (Lark 事件订阅) | Day 4 ✅ |
| BUG-008 | LARK_HOME 配置路径修正 | Task 4.2 (Lark 凭证配置) | Day 4 ✅ |
| BUG-009 | 去掉 JSON.stringify 修复换行符 | Task 4.1 (消息发送格式) | Day 4 ✅ |
| BUG-010 | execSync → execFileSync 安全执行 | 基础设施 (CLI 命令安全) | 基础 ✅ |
| BUG-011 | bot 回复按 user_id 存储+去重 | Task 7.1 (S6 出站调度) + Task 2.2 (记忆存储) | Day 7+2 ✅ |
| BUG-012 | assistant 消息 output_text 类型修正 | Task 5.1 (LLM client 消息格式) | Day 5 ✅ |

### LLM 说明

本项目**永久使用 OpenAI Responses API**，不迁移到其他 LLM 提供商。当前配置: 主力模型 `gpt-5.1`，备选 `gpt-5.4-mini` / `gpt-4.1-mini`。

---

## 2. 差距分析（当前 vs MVP v5 目标）

### 2.0 已通过 BUG 修复完成的 Sprint 任务

以下 MVP-05 Sprint Day 任务已在 v0.1.0 BUG 修复过程中实质性完成：

| Sprint Day | 任务范围 | 完成状态 | 验证 BUG |
|-----------|---------|---------|---------|
| Day 1 | 项目骨架 + 配置系统 (Task 1.1~1.5) | ✅ 已完成 | BUG-001/002/003 |
| Day 2 | SQLite + 即时记忆 + 工作记忆 (Task 2.1~2.4) | ✅ 已完成 | BUG-011 |
| Day 2 | 关系模型 (Task 2.5) | ❌ 未实现 | — |
| Day 3 | 事件总线 + 时间引擎 (Task 3.1~3.6) | ✅ 已完成 | — |
| Day 4 | Lark 集成 (Task 4.1~4.5) | ✅ 已完成 | BUG-004/006/007/008/009 |
| Day 5 | LLM 集成 + Prompt Builder (Task 5.1~5.8) | ✅ 已完成 | BUG-005/012 |
| Day 6 | Pipeline S1 + S2 (Task 6.1~6.6) | ✅ 已完成 | — |
| Day 7 | Pipeline S3+S4 + S5(基础) + S6 (Task 7.1~7.3) | ✅ 已完成 | BUG-011/012 |
| Day 7 | P0-3 Prompt Assembly Order (Task 7.3a) | ❌ 未实现 | — |
| Day 8-10 | S4.5/S5.5/Anti-AI/传记/集成测试 | ❌ 未实现 | — |

**结论**: Day 1~7 的基础任务已基本完成，剩余差距集中在 v5 新增模块（S4.5、S5.5、Anti-AI、传记系统）和未实现的关系模型。

### 2.1 全新模块（需从零开发）

| 优先级 | 模块 | 文件 | 说明 | 预估工时 |
|--------|------|------|------|---------|
| **P0** | S4.5 传记提取 | `pipeline/s4_5-fact-extractor.ts` | 异步事实提取+冲突检测+user_visible标记 | 6h |
| **P0** | S5.5 Anti-AI 校验 | `pipeline/s5_5-anti-ai-validator.ts` | 八维指纹检测器+AI评分+BLOCK/降级 | 6h |
| **P0** | 传记事实存储 | `memory/biographical-facts.ts` | 传记锚点层, SQLite 表, CRUD | 4h |
| **P0** | 传记冲突检测 | `memory/biographical-checker.ts` | 冲突检测+user_visible管理 | 4h |
| **P1** | 长期记忆 | `memory/long-term-memory.ts` | 关键词匹配检索, 重要性评分 | 3h |
| **P1** | 关系模型 | `memory/relationship-model.ts` | 阶段管理, 亲密度计算 | 3h |
| **P2** | Token 计数 | `llm/token-counter.ts` | Token 统计(可选) | 1h |
| **P2** | 消息适配器 | `lark/message-adapter.ts` | 消息格式适配 | 2h |
| **P2** | 工具函数 | `utils/validator.ts`, `errors.ts`, `timer.ts` | 校验/错误类/定时工具 | 2h |
| **P1** | 配置文件 | `prompt_mappings.yaml`, `constraints.yaml` | 参数映射表+约束规则 | 3h |

### 2.2 需重大升级的现有模块

| 优先级 | 模块 | 变更内容 | 预估工时 |
|--------|------|---------|---------|
| **P0** | S5 感知包装 | 改造为 **四步 sub-pipeline**: Step1-2 Anti-AI R01-R06 规则链, Step3 Memory Blur, Step4 身份守卫 | 8h |
| **P0** | S2 上下文组装 | 新增**传记事实检索**注入(仅user_visible=true) | 3h |
| **P0** | S3+S4 认知生成 | **Prompt Assembly Order** 定义 + human_behaviors 概率注入 | 4h |
| ~~已取消~~ | ~~LLM Client~~ | ~~LLM 迁移已取消，永久保持 OpenAI~~ | 0h |
| **P1** | Pipeline Runner | 插入 S4.5 和 S5.5 阶段 + 降级路径更新 | 2h |
| **P1** | Pipeline Types | 扩展 PipelineContext 支持 S4.5/S5/S5.5 接口 | 2h |
| **P1** | Working Memory | 新增 biographical_facts/self_state/event_log 表 | 3h |
| **P1** | Parameter Interpreter | 概率行为注入 (human_behaviors) | 3h |
| **P2** | Prompt Builder | 整合 Anti-AI prompt 注入层 + 传记上下文 | 2h |

### 2.3 测试缺口

| 类别 | 需新增测试 |
|------|----------|
| Pipeline | `s4_5-fact-extractor.test.ts`, `s5_5-anti-ai-validator.test.ts`, `s5-wrapper.test.ts`(升级) |
| Memory | `biographical-facts.test.ts`, `biographical-checker.test.ts`, `relationship-model.test.ts` |
| Scenarios | `anti-ai-scenarios.test.ts`, `biographical-scenarios.test.ts`, `multi-turn.test.ts` |

---

## 3. 增量升级路线图

### Phase 1: 基础设施升级（Day 1）
> 目标: 扩展类型系统 + LLM 迁移 + 数据库扩展

1. **P0-4**: 扩展接口定义 (`types.ts`)
   - 新增 S4_5_Input/Output, S5Input/Output, AntiAiConfig 接口
   - 扩展 PipelineContext 字段

2. ~~**LLM 迁移**: 已取消，永久保持 OpenAI Responses API~~

3. **数据库扩展**:
   - 新增 `biographical_facts` 表
   - 新增 `self_state` 表
   - 新增 `event_log` 表
   - 新增 `long_term_memories` 表
   - 新增 `relationships` 表(升级现有 users 表)

### Phase 2: 记忆系统扩展（Day 2）
> 目标: 传记记忆 + 长期记忆 + 关系模型

4. **传记事实存储** (`biographical-facts.ts`)
5. **传记冲突检测** (`biographical-checker.ts`)
6. **长期记忆** (`long-term-memory.ts`)
7. **关系模型** (`relationship-model.ts`)
8. 更新 `memory-manager.ts` 聚合新模块

### Phase 3: Pipeline 核心升级（Day 3-4）
> 目标: 新增 S4.5 + 升级 S5 + 新增 S5.5

9. **S4.5 传记提取器** (`s4_5-fact-extractor.ts`)
   - 异步事实提取 (轻量 LLM)
   - 冲突检测 + user_visible 标记
   - 返写 biographical_facts 表

10. **S5 四步 sub-pipeline 改造** (`s5-perception-wrapper.ts`)
    - Step 1-2: Anti-AI R01-R06 规则链
    - Step 3: Memory Blur (时间混淆)
    - Step 4: 身份边界守卫

11. **S5.5 Anti-AI 校验器** (`s5_5-anti-ai-validator.ts`)
    - 八维特征检测器
    - AI 指纹评分 (0-100)
    - BLOCK/降级决策

12. **S2 升级**: 传记检索注入
13. **S3+S4 升级**: Prompt Assembly Order + human_behaviors
14. **Pipeline Runner 升级**: 插入新阶段 + 降级路径

### Phase 4: 配置与参数（Day 5）
> 目标: 完善配置体系

15. 创建 `prompt_mappings.yaml`
16. 创建 `constraints.yaml`
17. 升级 `parameter-interpreter.ts` (概率行为注入)

### Phase 5: 测试与验证（Day 6）
> 目标: 全面测试覆盖

18. 新增所有 Pipeline 阶段测试
19. 新增记忆系统测试
20. 新增场景集成测试
21. 运行全量测试 + 修复问题

---

## 4. 风险与注意事项

1. ~~**LLM 迁移风险**: 已取消~~ — LLM 永久保持 OpenAI，无迁移风险
2. **S5 改造复杂度**: 四步 sub-pipeline 是最复杂的变更，建议逐步实现
3. **数据兼容性**: 新增数据库表不影响现有数据，但需注意迁移脚本
4. **向后兼容**: 所有升级基于增量开发，不破坏现有 S1→S6 基础流程
5. **备份恢复**: 如升级出问题，可随时回退到 v0.1.0 tag 或物理备份

---

## 5. 版本管理策略

- **备份**: `persona-bot-backup-v0.1.0-20260405/` (完整物理副本)
- **Git tag**: `v0.1.0` (基线版本)
- **开发分支**: `feature/v0.2.0-upgrade`
- **提交策略**: 每完成一个 Phase 做一次提交，附带 checkpoint 说明
- **版本号**: 完成后升级 package.json 至 `0.2.0`
