# 本体聊天机器人 — 版本变更日志 (CHANGELOG)

> **项目：** 本体聊天机器人（Gaia Bot）
>
> **维护者：** GG CUI
>
> **格式规范：** 每条变更包含 [类型] 标签 + 影响范围 + 描述
>
> **类型标签：** `[NEW]` 新增 · `[FIX]` 修复 · `[CHANGE]` 变更 · `[REMOVE]` 移除 · `[DOC]` 文档

---

## 版本拓扑图

```
v3.1 ─── v4 (main) ─── v4.1 (main) ───────────────── v5 ✅ (合并完成)
           │              │                               ▲
           │              ├── v4.1-branch (Anti-AI-Speech)─┤ P0×7 已修复
           │              │                               │ 二次攻击 98/100
           │              └── v4.2 (Biographical Memory)──┘
           │
           └── MVP 文档集 (MVP-00 ~ MVP-06)
               │
               ├── MVP-r1 (初始生成)
               ├── MVP-r2 (一致性修复)
               ├── MVP-r3 (v4.1-branch 同步)
               └── MVP-r4 (v4.2 同步)
```

---

## 文档清单与当前版本

| 文件 | 类型 | 当前版本 | 最后更新 |
|------|------|---------|---------|
| `本体聊天机器人-架构设计-v3.1.md` | 架构 | v3.1 (archived) | 2026-04-04 |
| `本体聊天机器人-架构设计-v4.md` | 架构 | v4.1 (main) | 2026-04-04 |
| `本体聊天机器人-架构设计-v4.1-Anti-AI-Speech.md` | 分支 | v4.1-branch | 2026-04-04 |
| `本体聊天机器人-架构设计-v4.2-Biographical-Memory.md` | 分支 | v4.2 | 2026-04-04 |
| `directionLog-v4.md` | 决策日志 | r3 | 2026-04-04 |
| `vibe-iteration-log.md` | 迭代教练日志 | Entry #2 | 2026-04-04 |
| `MVP-00-项目总览.md` | MVP 文档 | r5 | 2026-04-04 |
| `MVP-01-环境搭建指南.md` | MVP 文档 | r5 | 2026-04-04 |
| `MVP-02-Persona-Schema规范.md` | MVP 文档 | r5 | 2026-04-04 |
| `MVP-03-Pipeline开发规范.md` | MVP 文档 | r5 | 2026-04-04 |
| `MVP-04-数据模型与接口定义.md` | MVP 文档 | r5 | 2026-04-04 |
| `MVP-05-Sprint实施计划.md` | MVP 文档 | r5 | 2026-04-04 |
| `MVP-06-测试方案与验收标准.md` | MVP 文档 | r5 | 2026-04-04 |
| `一致性检查报告.md` | 质量报告 | r1 | 2026-04-04 |
| `CHANGELOG.md` | 版本管理 | 当前文件 | 2026-04-04 |
| `合并攻击测试报告-v4.1+v4.2.md` | 质量报告 | r1 | 2026-04-04 |
| `本体聊天机器人-架构设计-v5.md` | 架构 | v5 r1-draft | 2026-04-04 |
| `二次攻击测试报告-v5-draft.md` | 质量报告 | r1 | 2026-04-04 |

---

## [v5] 合并发布 — 2026-04-04

**主题：** v4.1-branch (Anti-AI-Speech) + v4.2 (Biographical Memory) 合并为 v5，修复全部 P0/P1

### 架构文档
- `[NEW]` 新建 `本体聊天机器人-架构设计-v5.md`（4900行，三部分合一）
  - Part A: Pipeline 执行模型（S1-S6 + S4.5 + S5.5，含 S5 四步 sub-pipeline）
  - Part B: Persona Schema 完整定义（合并三版本 + 完整 Zod Schema + 19 条约束）
  - Part C: 辅助系统（事件总线 16 类 + Cron Job + 数据模型 + 11 个辅助函数规范）

### P0 修复（7/7 全部通过二次验证）
- `[FIX]` P0-1 (CR-01): S5 内部定义四步执行链（Anti-AI → blur → 口头禅 → 拆分）
- `[FIX]` P0-2 (CR-02): S4.5 增加 user_visible 标记，S2 检索时过滤不可见事实
- `[FIX]` P0-3 (PL-01): 定义 prompt_assembly_order（persona → biography → param → anti_ai）
- `[FIX]` P0-4 (PL-02): S5Input 扩展接口含 BiographicalContext + AntiAiConfig
- `[FIX]` P0-5 (CP-01): human_behaviors 明确为 Parameter Interpreter 概率注入机制
- `[FIX]` P0-6 (CP-02): 实现 detectBlurTriggers() 三条件检测 + 条件概率逻辑
- `[FIX]` P0-7 (UJ-01): R01 增加多问题豁免检测（≥2 问句时跳过）

### P1 修复（10/10 全部处理）
- `[FIX]` PL-03: S4.5 write-through 缓存策略
- `[FIX]` PL-04: 降级路径跳过 Anti-AI/blur/S5.5
- `[FIX]` CR-03: R05 增加 biography_topic 豁免
- `[FIX]` CR-04: Prompt Token 预算上限 1500 tokens
- `[FIX]` CR-05: S5.5 BLOCK 重写设 blur_already_applied 标记
- `[FIX]` CP-03: 11 个辅助函数完整签名 + 算法选型
- `[FIX]` CP-04: S5Input 含 BiographicalContext（解决参数来源）
- `[FIX]` CP-05: 三种配置模式明确定义
- `[FIX]` UJ-02: identity_check 优先级高于传记回答
- `[FIX]` UJ-06: S4.5 降级链 Haiku → rule-based → skip

### 质量验证
- `[NEW]` `二次攻击测试报告-v5-draft.md` — P0 7/7 PASS, P1 10/10 处理, 新问题 0, 评分 98/100

### 迭代教练日志
- `[NEW]` vibe-iteration-log.md `Entry #3` 更新（第一次攻击测试）
- `[NEW]` vibe-iteration-log.md `Entry #4`（v5 合并 + 二次攻击测试）

---

## [MVP-r5] MVP 文档集同步 v5 — 2026-04-04

**主题：** 7 份 MVP 文档同步更新至 r5，对齐 v5 架构设计

### MVP-00 项目总览 (r2 → r5)
- `[CHANGE]` 架构版本引用从 v4.1 更新至 v5
- `[NEW]` Pipeline 架构图更新为 8 Stage（新增 S4.5 + S5.5）
- `[NEW]` 核心模块概览：新增 Anti-AI-Speech 三层防御 + Biographical Memory 三层记忆
- `[NEW]` 项目目录结构：新增 s4_5-fact-extractor.ts + s5_5-anti-ai-validator.ts

### MVP-01 环境搭建指南 (r2 → r5)
- `[CHANGE]` 文档版本更新至 r5（无功能变更，v5 新机制均为 rule-based 无新依赖）

### MVP-02 Persona-Schema 规范 (r4 → r5)
- `[NEW]` P0-5 修复：human_behaviors 执行机制（Parameter Interpreter 概率注入 + prompt_mappings）
- `[NEW]` P0-6 修复：detectBlurTriggers() 三条件实现（specific_date / exact_sequence / low_importance_detail）
- `[NEW]` constraints.yaml 扩展至 15+ 条（新增 v5 合并约束）
- `[CHANGE]` 配置派生链更新（S2 传记检索 / S4.5 / S5 四步 / S5.5）

### MVP-03 Pipeline 开发规范 (r4 → r5)
- `[NEW]` Pipeline 总览图更新为 8 Stage
- `[NEW]` P0-1 修复：S5 四步 sub-pipeline 定义（Anti-AI → blur → 口头禅 → 拆分）
- `[NEW]` P0-2 修复：S4.5 user_visible 标记机制
- `[NEW]` P0-3 修复：prompt_assembly_order 四层定义 + Token 预算 1500
- `[NEW]` P0-7 修复：R01 多问题豁免检测
- `[NEW]` 事件总线新增 7 个事件（biography.* 4 + anti_ai.* 3）
- `[NEW]` 降级路径更新：跳过 Anti-AI/blur/S5.5
- `[NEW]` 身份试探优先级规则

### MVP-04 数据模型与接口定义 (r4 → r5)
- `[NEW]` biographical_facts 表新增 user_visible + visible_position 字段
- `[NEW]` BiographicalFact 接口新增 user_visible / visible_position
- `[NEW]` MemoryDAO 7 个传记方法完整签名
- `[NEW]` S5Input / S5Output 接口定义

### MVP-05 Sprint 实施计划 (r2 → r5)
- `[NEW]` v5 P0 修复任务 7 项（排入 Sprint 1 最高优先级）
- `[NEW]` v5 P1 修复任务 4 项
- `[CHANGE]` 工作量估算从 80-100h 更新至 90-120h（+27h v5 增量）

### MVP-06 测试方案与验收标准 (r1 → r5)
- `[NEW]` S4.5 事实提取器单元测试（触发条件 + 冲突检测 + user_visible）
- `[NEW]` S5.5 Anti-AI 校验器单元测试（8 维检测 + 阈值判定 + BLOCK 降级）
- `[NEW]` 交叉场景测试（场景 4/7/10 回归）
- `[NEW]` 验收标准：ai_score 准确率 >80%、BLOCK 率 <10%、user_visible 100%
- `[NEW]` 性能基准：S5 <30ms、S4.5 <3s、S5.5 <15ms

### 统计
- 7 份文档全部更新至 r5
- 新增内容约 800+ 行
- 覆盖全部 7 个 P0 修复 + 10 个 P1 修复的 MVP 实施细节

---

## [v5-pre] 合并攻击测试 — 2026-04-04

**主题：** v4.1-branch × v4.2 四轮合并攻击测试

**触发：** 用户在合并前主动请求系统性攻击验证

### 攻击测试结果
- `[NEW]` 新建 `合并攻击测试报告-v4.1+v4.2.md`
  - Round 1: 交叉干扰测试 — 发现 7 项（P0×2 / P1×3 / P2×2）
  - Round 2: Pipeline 逻辑一致性 — 发现 6 项（P0×2 / P1×2 / P2×2）
  - Round 3: 完整性攻击 — 发现 7 项（P0×2 / P1×3 / P2×2）
  - Round 4: 用户旅程端到端（10 场景）— 发现 7 项（P0×1 / P1×2 / P2×4）

### 关键 P0 发现
1. S5 内部执行顺序未定义（Anti-AI / blur / 口头禅 三功能冲突）
2. R04 长度截断制造"用户不可见事实"（S4.5 提取了用户看不到的内容）
3. S3+S4 Prompt 四块注入顺序未定义
4. S5 内部接口类型不一致
5. human_behaviors 5 个概率行为无执行机制定义
6. memory_blur 的 blur_triggers 未实现（只做随机概率）
7. R01 对多子问题场景误判为 AI 列举

### 迭代教练日志
- `[NEW]` vibe-iteration-log.md `Entry #3`：Mode 3，T16/T12/T06，D 分 9/9/9/8/9/9

### 合并评估
- 结论：🟡 有条件可合并 — 设计层面无根本矛盾，修复 7 个 P0 后可产出 v5

---

## [v4.2] — 2026-04-04

**主题：** 传记记忆与生成一致性机制 (Biographical Memory + Consistency Gate)

**触发：** MVP 实测发现 LLM 即兴生成传记细节无返写，窗口滑过后自相矛盾

### 架构文档变更
- `[NEW]` 新建 `本体聊天机器人-架构设计-v4.2-Biographical-Memory.md`
  - 三层传记记忆架构（Anchors → Writeback → Consistency Gate）+ 容错模糊化
  - Pipeline 新增 S4.5 Biographical Fact Extractor（异步，Haiku）
  - S2 增强：传记事实检索 + Prompt 约束注入
  - S5 增强：memory_blur 记忆模糊化逻辑
  - Cron Job 扩展：周度传记聚类 + 时间线矛盾检测 + 月度密度审计
  - 事件总线新增 4 个 biography.* 事件

### MVP 文档变更
- `[NEW]` MVP-02 `r3→r4`：BiographySchema + BiographyAnchorSchema + BiographyWritebackSchema + MemoryBlurSchema (Zod)；persona.yaml 示例增加 biography 块；constraints 增加 2 条（age_range_consistency, anchor_vs_background）
- `[NEW]` MVP-03 `r3→r4`：S2 新增传记检索逻辑 + S4.5 Stage 定义 + S5 memory_blur 逻辑 + 4 个事件类型 + Pipeline Runner 更新
- `[NEW]` MVP-04 `r2→r4`：新建 biographical_facts 表（15 列 + 3 索引）+ BiographicalFact/ConflictCheckResult 接口 + MemoryDAO 新增 7 个方法

### 决策日志变更
- `[NEW]` directionLog-v4.md `r2→r3`：新增 v4.2 决策记录（含 Coach 补充的 3 个盲区）
- `[NEW]` vibe-iteration-log.md `Entry #2`：Mode 3 Assist，D5=10（用户主导设计教科书案例）

### Coach 补充的盲区
1. 提取时机纠正：S5（已改写文本）→ S4.5（LLM 原始输出）
2. 写入前冲突检测：同主题不同时段 + 同时段矛盾细节 + 与锚点矛盾
3. Cron Job 联动：传记事实聚类合并 + 时间线矛盾扫描 + 密度审计

---

## [v4.1-branch] — 2026-04-04

**主题：** Anti-AI-Speech 三层防御机制

**触发：** MVP 实测发现对话口气明显像 AI（多选项罗列、疑问句收尾、单条过长、知识讲解体）

### 架构文档变更
- `[NEW]` 新建 `本体聊天机器人-架构设计-v4.1-Anti-AI-Speech.md`
  - 12 维 AI 语言指纹图谱（结构性 / 语气 / 对话动力学三类）
  - 第一层：Anti-AI Prompt Injection（S3/S4 System Prompt 约束）
  - 第二层：Human-Style Rewriter（S5 增强，6 条规则链 R01-R06）
  - 第三层：Anti-AI Validator（S5.5 新增 Stage，8 维指纹评分器）
  - persona.yaml 新增 `language.anti_ai_speech` 配置块
  - prompt_mappings.yaml 新增 `anti_ai_speech.strictness` 段
  - 事件总线新增 3 个 anti_ai.* 事件

### MVP 文档变更
- `[NEW]` MVP-02 `r2→r3`：AntiAiSpeechSchema (Zod) + persona.yaml 示例增加 anti_ai_speech 块 + prompt_mappings 增加 strictness 段 + constraints 增加 3 条
- `[NEW]` MVP-03 `r2→r3`：S5 新增 Anti-AI 规则链（R01-R06）+ S5.5 Validator Stage + Pipeline Runner 更新 + 3 个事件类型 + AntiAiRewriteRule/AiFingerprint 接口

### 决策日志变更
- `[NEW]` directionLog-v4.md `r1→r2`：新增 v4.1-branch 决策记录
- `[NEW]` vibe-iteration-log.md `Entry #1`：Mode 3+5，T06/T13/T12/T08

---

## [v4.1-main] — 2026-04-04

**主题：** Parameter Interpreter + S3+S4 条件合并 + 状态概率模型 + Cron Job

**触发：** v4 攻击测试发现 P1 (参数→LLM映射缺失) + P3 (日程太刚性) + P5 (S3+S4耦合) + 记忆无维护

### 架构文档变更
- `[CHANGE]` `本体聊天机器人-架构设计-v4.md` 更新至 v4.1：
  - `[NEW]` 第七节：Parameter Interpreter（prompt_mappings.yaml + constraints.yaml）
  - `[NEW]` 第八节：S3+S4 条件合并策略（PART A/B 结构 + 后校验）
  - `[NEW]` 第九节：Memory Maintenance Cron Job（日/周/月三频维护）
  - `[CHANGE]` persona.yaml `schedule_template` → `state_model`（概率分布采样）
  - `[REMOVE]` 已读（read receipt）机制 — ROI 低，Lark CLI 控制能力有限

---

## [v4] — 2026-04-04

**主题：** Persona-as-Code + Pipeline 执行模型

**触发：** Navigate Mode 决策 — A3 (人设即代码) + A2 (管道模型重构)

### 架构文档变更
- `[NEW]` 新建 `本体聊天机器人-架构设计-v4.md`
  - 从"概念分层架构"跃迁为"声明式配置 + 可执行管道"
  - Persona Schema：完整 YAML 定义（identity / knowledge / language / temporal / social / memory）
  - Pipeline S1→S2→S3→S3.5→S4→S5→S6（可插拔 / 可跳过 / 可合并 / 可降级 / 可观测）
  - 时间引擎更新为跨 Stage 共享参数注入器
  - 事件总线更新为 Pipeline Stage 映射
  - 身份边界守卫设计

### 决策日志变更
- `[NEW]` 新建 `directionLog-v4.md`：10 个 Navigate 方向（5A + 5B），选择 A3 + A2

---

## [v3.1] — 2026-04-04

**主题：** 架构修正 — 消息调度器 + 时间仲裁协议 + 事件总线

**触发：** v3 攻击测试发现 A1 (消息聚合无主) + A2 (时间仲裁冲突) + A3 (状态无回写)

### 架构文档变更
- `[NEW]` 新建 `本体聊天机器人-架构设计-v3.1.md`
  - 5 层架构：感知表达层 / 认知决策层 / 时间引擎 / 记忆与状态层 / 基础设施层
  - `[NEW]` 基础设施层增加消息调度器（缓冲 + 分类 + 拆分）
  - `[NEW]` 时间引擎增加层叠仲裁协议（低频设基调 → 高频调节奏 → 紧急中断）
  - `[NEW]` 异步事件总线（记忆层为单点状态写入者）

---

## [MVP-r2] 一致性修复 — 2026-04-04

**触发：** 用户要求"检查一致性"，跨文档交叉验证发现 19 处不一致

### P0 修复（6 项）
- `[FIX]` MVP-01：项目目录结构从 `src/core/services/models/` 修正为 `src/config/pipeline/engine/memory/lark/llm/`
- `[FIX]` MVP-03：关系阶段名 `first_meet`/`acquainted` → `stranger`/`acquaintance`
- `[FIX]` MVP-03：SelfState 接口从 `mood/energy/has_concerns` 更新为 MVP-04 权威定义
- `[FIX]` MVP-03/05：LLM 模型名 `claude-3-5-sonnet-20241022` → `claude-sonnet-4-6`
- `[FIX]` MVP-00：npm 依赖版本与 MVP-01 对齐 + 补充 winston/node-cron
- `[FIX]` MVP-00/04：数据库文件名 `bot.db` → `persona.db`

### 质量报告
- `[NEW]` 新建 `一致性检查报告.md`：19 处不一致分类（P0×6 / P1×8 / P2×5）

---

## [MVP-r1] 初始生成 — 2026-04-04

**触发：** 用户要求"产出一套可直接交付给开发团队的MVP实施开发文档"

### 文档集
- `[NEW]` MVP-00-项目总览.md：项目概述、MVP 范围、架构图、技术栈、目录结构
- `[NEW]` MVP-01-环境搭建指南.md：Node.js/pnpm/PM2/SQLite 安装、配置文件模板、验证清单
- `[NEW]` MVP-02-Persona-Schema规范.md：完整 Zod schema、字段文档、prompt_mappings、constraints
- `[NEW]` MVP-03-Pipeline开发规范.md：S1-S6 Stage 实现、LLM prompt 模板、降级路径
- `[NEW]` MVP-04-数据模型与接口定义.md：6 张 SQLite 表、TypeScript 接口、MemoryDAO 25+ 方法
- `[NEW]` MVP-05-Sprint实施计划.md：10 天 Sprint、Day-by-Day 任务、验收标准
- `[NEW]` MVP-06-测试方案与验收标准.md：单元/集成/场景测试、10 个 replay 场景、Bug 分级

---

## 变更统计

| 版本 | 新增文件 | 修改文件 | 新增 Schema 字段 | 新增 DB 表 | 新增 Pipeline Stage | 新增事件类型 |
|------|---------|---------|-----------------|-----------|-------------------|------------|
| v3.1 | 1 | 0 | — | — | — | — |
| v4 | 2 | 0 | persona.yaml 全量 | — | S1-S6 + S3.5 | 9 |
| v4.1-main | 0 | 1 | state_model, prompt_mappings, constraints | — | — | — |
| MVP-r1 | 7 | 0 | — | 6 | — | — |
| MVP-r2 | 1 | 5 | — | — | — | — |
| v4.1-branch | 1 | 2 | anti_ai_speech | — | S5.5 | 3 |
| v4.2 | 1 | 3 | biography, memory_blur | biographical_facts | S4.5 | 4 |
| **总计** | **13** | **11** | — | **7** | **S1-S6 + S3.5 + S4.5 + S5.5** | **16** |
