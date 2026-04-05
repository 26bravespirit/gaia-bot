# MVP-00 项目总览

> **文档版本：** MVP-00 | **修订：** r5 | **最后更新：** 2026-04-04
> **变更日志：** 见 `CHANGELOG.md`

**文档版本**: v5
**最后更新**: 2026年04月04日
**负责人**: 项目技术负责人

---

## 目录

1. [项目背景与目标](#项目背景与目标)
2. [核心设计理念](#核心设计理念)
3. [MVP 范围定义](#mvp-范围定义)
4. [系统架构](#系统架构)
5. [技术栈](#技术栈)
6. [项目结构](#项目结构)
7. [关键模块概览](#关键模块概览)
8. [开发交付物清单](#开发交付物清单)
9. [快速开始](#快速开始)

---

## 项目背景与目标

### 项目名称
**本体聊天机器人实体** (Persona-Driven Ontological Chatbot Entity)

### 项目目标

利用**本地常驻服务** + **Lark CLI** + **LLM API**，构建**极度趋近真人体验**的聊天机器人实体。

核心目标是打造一个"像真人"的智能聊天体验，而非追求单条回复的质量优化。

### 设计第一性原理

> **真正让人觉得"像真人"的是时间维度的行为模式，而不是单条回复的质量。**

这意味着：
- 人设不是静态的，而是通过**事件驱动**不断演化的
- 回复内容、风格、频率要形成**时间维度的一致性**
- 即使单条回复不够完美，如果行为模式自洽，也会被认为"真实"
- 系统需要**记忆机制** + **状态管理** + **时间引擎**来维持这一一致性

---

## 核心设计理念

### 六大设计原则

#### 1. **防破功优先** (Consistency First)
- 在任何场景下，机器人的人设、语气、价值观都不能自相矛盾
- 引入**身份边界守卫**，用 rule-based 关键词检测 + LLM prompt 内嵌约束来防止违背人设的输出
- 一个出错的回复可能需要几十个正确回复才能修复用户信任

#### 2. **低频设基调，高频调节奏** (Baseline + Modulation)
- 低频事件（日/周级）设定机器人的基本人设、关系阶段、情绪基调
- 高频事件（秒/分钟级）通过**时间引擎**和**事件总线**动态调整回复的风格、频率、深度
- 例如：机器人低频下设定为"热情、陌生人",但高频可以通过今天的互动次数来调整回复延迟

#### 3. **事件驱动状态更新** (Event-Driven State Management)
- 所有状态变化（记忆更新、关系演化、情绪变化）都源自**事件**，而非定时轮询
- 使用进程内 **EventEmitter** 作为事件总线
- 每个模块订阅感兴趣的事件类型，无需中央协调器

#### 4. **工具是手段不是能力** (Tools as Means, Not Ends)
- 工具调用（搜索、浏览器）不是核心能力，而是在必要时的**辅助手段**
- MVP 阶段**不实现工具调用**，确保基础能力（记忆、人设、时间引擎）坚实可靠
- 后续版本可插拔式地加入工具能力

#### 5. **人设即代码** (Persona as Code)
- 人设不是自由文本，而是**声明式的结构化配置**（YAML/JSON）
- 使用 **Zod schema** 进行类型校验
- Parameter Interpreter 将配置映射为 LLM prompt 片段，确保配置的每一项都有对应的执行逻辑

#### 6. **管道可插拔** (Pluggable Pipeline)
- Pipeline 采用**标准化的阶段设计**（S1-S6），每个阶段可独立开发、测试、替换
- 通过配置文件动态启用/禁用某些处理阶段
- 为后续扩展（群聊、多模态、工具调用）留出清晰的接口

---

## MVP 范围定义

### MVP 适用场景

- ✅ **一对一私聊**：机器人与单个用户的对话
- ✅ **会话持久化**：记忆近期的对话历史和关系状态

### MVP 明确砍掉的功能

| 功能 | 原因 | 后续版本 |
|-----|------|--------|
| 群聊场景 | 群聊涉及复杂的身份管理、发言轮流机制，MVP 聚焦深度 | v2.0+ |
| 多模态输出 | 图片、表情包、语音会显著增加 LLM 成本和复杂度 | v1.5+ |
| 工具调用 | 网络请求引入不确定性，先用 prompt 约束 + 长期记忆代替 | v2.0+ |
| 向量检索 | MVP 数据量小，关键词匹配 + JSON 存储足够 | v1.5+ |
| Memory Maintenance Cron | 数据量小，不需要定期整理 | v2.0+ |
| 人设演化（Persona Drift） | 人设固定，后续可通过事件驱动演化 | v2.0+ |
| 关系阶段自动演化 | 固定在 `stranger` 或 `acquaintance` | v1.5+ |

### MVP 核心能力清单

#### **配置与人设**
- ✅ **Persona Schema**：声明式配置，包含：
  - 基本身份信息（名字、年龄、性别等）
  - 人格特征（性格标签、价值观）
  - 关系参数（初始关系阶段、信任度）
  - 交互风格（语气、回复风格）
  - 禁忌边界（防破功关键词）
- ✅ **Parameter Interpreter**：`prompt_mappings.yaml` + `constraints.yaml`，将配置转换为 LLM prompt 指令

#### **消息处理 Pipeline**

标准化的 8 阶段 Pipeline（v5 新增 S4.5 和 S5.5）：

1. **S1 消息调度** (Message Dispatcher)
   - 接收来自 Lark 的消息
   - 路由到对应的用户会话
   - 处理消息去重、格式适配

2. **S2 上下文组装** (Context Assembler)
   - 从记忆层加载历史对话
   - 构建 LLM 上下文（system prompt + message history）
   - 注入当前状态（用户关系、机器人情绪等）
   - 检索传记事实（v5 新增）

3. **S3+S4 认知与生成** (Cognitive Generator)
   - S3 决策：通过轻量 LLM 分析用户意图、风险评估
   - S4 生成：通过主力 LLM 生成回复内容
   - MVP 阶段将 S3、S4 合并为一个阶段，优先级：安全检查 > 内容生成

4. **S4.5 传记提取** (Biographical Memory Extractor) — v5 新增
   - 从 S4 生成的回复中异步提取事实
   - 冲突检测：防止与既有传记矛盾
   - 返写与 user_visible 标记（标记用户已感知的事实）
   - 执行位置：S4 后、S5 前（异步）

5. **S5 感知包装 + Anti-AI 防御** (Perception Wrapper + Anti-AI-Speech)
   - S5 sub-pipeline 四步链：
     - Step 1-2：Anti-AI 规则链（R01-R06），检测和改写 AI 特征
     - Step 3：Memory blur（混淆时间标记，保护传记隐私）
     - Step 4：身份边界守卫（防破功检查）

6. **S5.5 Anti-AI 校验** (Anti-AI AI-Fingerprint Validator) — v5 新增
   - 八维特征检测器（长度、句式、词汇、逻辑等）
   - AI 指纹评分（0-100）+ 阈值判定
   - BLOCK 或降级决策（若分数过高则降级回复）

7. **S6 出站调度** (Outbound Scheduler)
   - 生成回复发送给 Lark
   - 处理消息合并、分段等技术细节
   - 触发相关事件（"消息已发送"等）

#### **时间引擎**

- ✅ **状态概率模型**：
  - 秒级：消息处理的即时响应窗口
  - 分钟级：回复风格、延迟的动态调整（如用户交互频繁时加速回复）
  - 小时级：情绪/能量值的缓慢漂移
  - 天/月级：简化为固定值或手动配置（不需要复杂算法）

- ✅ **层叠仲裁**：多个时间维度的决策冲突时的优先级处理
  - 例如：分钟级的"加速回复"vs 小时级的"睡眠模式"，取优先级高的

#### **记忆系统**

- ✅ **即时记忆** (Immediate Memory)
  - 在内存中维护当前会话的对话历史（最近 N 轮）
  - 用于构建 LLM 上下文

- ✅ **工作记忆** (Working Memory)
  - SQLite 存储，记录用户信息、关系状态、重要事件
  - 支持关键词搜索、时间范围查询

- ✅ **长期记忆**：简化实现
  - 用 JSON 文件或 SQLite 简单字段存储
  - 不使用向量检索，改为关键词匹配

#### **事件总线与状态管理**

- ✅ **事件总线**：Node.js EventEmitter
  - 所有模块通过事件通信，解耦依赖
  - 事件类型：`message_received`、`memory_updated`、`state_changed` 等

- ✅ **关系模型**：
  - 支持关系阶段：`stranger` → `acquaintance` → `friend` → ...
  - MVP 固定不变，后续可动态演化

#### **身份边界守卫**

- ✅ **Rule-Based 检测**：
  - 黑名单关键词：触发时直接拒绝或转向安全话题
  - 例如：机器人人设为"女性 AI 助手"，收到"你是不是男的"时，用规则检测到身份问题，via prompt 约束给出人设一致的回答

- ✅ **LLM Prompt 内嵌约束**：
  - system prompt 中明确写入人设、禁忌等
  - 让 LLM 在生成阶段就自我约束

---

## 系统架构

### 架构总览图（MVP v5 完整版 — 8 Stage Pipeline）

```
┌─────────────────────────────────────────────────────────────────┐
│                         Lark Messaging                           │
│                      (CLI / Open API)                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │ (webhook / poll)
                      ↓
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  S1: Message Dispatcher (消息调度)                       │  │
│   │   • 消息路由 • 去重 • 格式适配                           │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│   ┌──────────────▼───────────────────────────────────────────┐  │
│   │  S2: Context Assembler (上下文组装)                      │  │
│   │   • 加载历史对话 • 构建 system prompt • 注入状态          │  │
│   │   • 传记事实检索（v5 新增）                               │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│   ┌──────────────▼───────────────────────────────────────────┐  │
│   │  S3+S4: Cognitive Generator (认知+生成)                  │  │
│   │   • 意图分析 • 安全检查 • LLM 生成回复                    │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│   ┌──────────────▼───────────────────────────────────────────┐  │
│   │  S4.5: Biographical Memory Extractor (v5 新增)           │  │
│   │   • 事实异步提取 • 冲突检测 • 返写 + user_visible 标记   │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│   ┌──────────────▼───────────────────────────────────────────┐  │
│   │  S5: Perception Wrapper + Anti-AI-Speech (v5 合并)      │  │
│   │   • Anti-AI 规则链 R01-R06                               │  │
│   │   • Memory Blur 混淆隐私                                  │  │
│   │   • 防破功检查 • 身份边界守卫                             │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│   ┌──────────────▼───────────────────────────────────────────┐  │
│   │  S5.5: Anti-AI AI-Fingerprint Validator (v5 新增)        │  │
│   │   • 八维特征检测器 • AI 指纹评分 • BLOCK/降级             │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│   ┌──────────────▼───────────────────────────────────────────┐  │
│   │  S6: Outbound Scheduler (出站调度)                       │  │
│   │   • 消息格式化 • 发送到 Lark • 事件通知                   │  │
│   └──────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
└──────────────────┼────────────────────────────────────────────────┘
                   │
                   ↓
          ┌────────────────────┐
          │  Lark Messaging    │
          │  (Output)          │
          └────────────────────┘


             ┌──────────────────────────────────────────┐
             │    📋 Parameter Interpreter              │
             │  • persona.yaml → prompt fragments     │
             │  • constraints.yaml → validation rules   │
             └──────────────────────────────────────────┘
                           ↑
             (config → prompt construction)


  ┌─────────────────────────────────────────────────────────┐
  │              🎯 Core Services                           │
  ├─────────────────────────────────────────────────────────┤
  │                                                         │
  │  🚌 Event Bus (EventEmitter)                           │
  │     ├─ message_received                                │
  │     ├─ memory_updated                                  │
  │     ├─ state_changed                                   │
  │     └─ response_sent                                   │
  │                                                         │
  │  ⏱️  Time Engine (时间引擎)                             │
  │     ├─ 秒级: 即时响应                                  │
  │     ├─ 分钟级: 风格调整                                │
  │     ├─ 小时级: 情绪漂移                                │
  │     └─ 层叠仲裁: 冲突处理                              │
  │                                                         │
  │  🧠 Memory Layer (记忆层)                              │
  │     ├─ Immediate Memory (即时记忆 - 内存)             │
  │     ├─ Working Memory (工作记忆 - SQLite)             │
  │     └─ Long-term Memory (长期记忆 - JSON/SQLite)     │
  │                                                         │
  │  📖 Biographical Memory (v5 新增 — 传记三层)           │
  │     ├─ 锚点层：存储事实 + metadata + conflict_flags    │
  │     ├─ 返写层：S4.5 异步提取并标记 user_visible       │
  │     └─ 一致性门控：冲突检测 + blur 容错                │
  │                                                         │
  │  🚨 Anti-AI-Speech (v5 新增 — 三层防御)                │
  │     ├─ Layer 1：Prompt 注入级（系统指令）              │
  │     ├─ Layer 2：S5 规则链级（R01-R06 检测+改写）       │
  │     └─ Layer 3：S5.5 评分级（八维指纹+阈值判定）       │
  │                                                         │
  │  🛡️  Identity Guardian (身份守卫)                      │
  │     ├─ Rule-based keyword detection                    │
  │     └─ LLM prompt constraints                          │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

### 数据流向

```
用户消息 (Lark)
     ↓
  S1 调度 → 识别会话
     ↓
  S2 组装 → 加载记忆 + 传记检索 + 构建 system prompt（v5 新增传记检索）
     ↓
Parameter Interpreter ← persona.yaml
     ↓
  S3+S4 生成 → LLM API 调用
     ↓
  S4.5 传记提取 (异步) ← 冲突检测 + user_visible 标记（v5 新增）
     ↓
  S5 感知包装 + Anti-AI → 四步 sub-pipeline（v5 新增 Anti-AI 规则链）
     ├─ Step 1-2: R01-R06 规则链（检测+改写）
     ├─ Step 3: memory_blur（时间混淆）
     └─ Step 4: 防破功检查
     ↓
  S5.5 AI 校验 → 八维指纹评分 + BLOCK/降级（v5 新增）
     ↓
  S6 出站 → 发送至 Lark + 保存记忆
     ↓
事件总线通知所有订阅者（Memory Manager、Time Engine 等）
```

---

## 技术栈

### 核心选型表

| 组件 | 技术选择 | 理由 |
|------|---------|------|
| **编程语言** | TypeScript (Node.js 20+) | 类型安全、异步生态成熟、npm 包丰富 |
| **进程守护** | PM2 | 生产级稳定性、自动重启、日志管理 |
| **消息通道** | Lark CLI / Lark Open API (webhook) | 主流企业消息平台、API 文档完善 |
| **主力 LLM** | OpenAI API (gpt-5.1) | 推理能力强、上下文窗口大、成本效益高 |
| **轻量 LLM** | OpenAI (gpt-4.1-mini) | 速度快、成本低，适合轻量任务（摘要、分类） |
| **本地存储** | SQLite (via better-sqlite3) | 零运维、支持复杂查询、本地部署无网络依赖 |
| **配置管理** | YAML (js-yaml) + Zod schema | 声明式配置、人工可读、类型校验 |
| **文件监听** | chokidar | 配置热加载、稳定的文件变更检测 |
| **事件总线** | Node.js EventEmitter | MVP 足够，低耦合，后续可替换为 RabbitMQ 等 |
| **测试框架** | Vitest | 快速、原生 TS 支持、兼容 Jest 生态 |
| **包管理器** | pnpm | 快速、磁盘效率高、monorepo 友好 |

### 版本要求

- **Node.js**: 20.x LTS 或更高
- **TypeScript**: 5.x
- **pnpm**: >= 9.0.0

### 关键依赖

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "js-yaml": "^4.1.0",
    "zod": "^3.23.0",
    "chokidar": "^3.6.0",
    "pm2": "^5.4.0",
    "winston": "^3.14.0",
    "node-cron": "^3.0.3"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 项目结构

### 完整目录树

```
gaia-bot/
│
├── 📄 package.json                    # 项目元数据、依赖定义
├── 📄 pnpm-lock.yaml                  # 依赖锁文件
├── 📄 tsconfig.json                   # TypeScript 编译配置
├── 📄 vitest.config.ts                # Vitest 测试配置
│
├── 🔧 配置文件（根目录）
│   ├── persona.yaml                   # 机器人人设配置（核心）
│   ├── prompt_mappings.yaml           # 参数→prompt 映射表
│   ├── constraints.yaml               # 跨字段约束、防破功规则
│   └── .env.example                   # 环境变量示例
│
├── 📦 src/ (源代码)
│   │
│   ├── 🎯 index.ts                    # 入口文件：初始化、PM2 接口
│   │
│   ├── 📁 config/                     # 配置加载与管理
│   │   ├── persona-loader.ts          # YAML 加载 + Zod 校验 + 热加载
│   │   ├── parameter-interpreter.ts   # 参数→prompt 片段转换
│   │   └── schemas.ts                 # Zod schema 定义
│   │
│   ├── 📁 pipeline/                   # 处理管道（v5: 8 阶段）
│   │   ├── pipeline-runner.ts         # Pipeline 编排、错误处理
│   │   ├── s1-message-dispatcher.ts   # S1: 消息调度
│   │   ├── s2-context-assembler.ts    # S2: 上下文组装 + 传记检索（v5）
│   │   ├── s3s4-cognitive-generator.ts # S3+S4: 认知与生成
│   │   ├── s4_5-fact-extractor.ts     # S4.5: 传记提取与冲突检测（v5 新增）
│   │   ├── s5-perception-wrapper.ts   # S5: 感知包装 + Anti-AI 规则链（v5）
│   │   ├── s5_5-anti-ai-validator.ts  # S5.5: AI 指纹评分器（v5 新增）
│   │   └── s6-outbound-scheduler.ts   # S6: 出站调度
│   │
│   ├── 📁 engine/                     # 核心引擎
│   │   ├── time-engine.ts             # 时间引擎、状态概率、仲裁
│   │   └── event-bus.ts               # 事件总线、消息分发
│   │
│   ├── 📁 memory/                     # 记忆系统（v5 新增传记层）
│   │   ├── memory-manager.ts          # 记忆管理器（统一入口）
│   │   ├── immediate-memory.ts        # 即时记忆（内存）
│   │   ├── working-memory.ts          # 工作记忆（SQLite）
│   │   ├── long-term-memory.ts        # 长期记忆（JSON/SQLite）
│   │   ├── biographical-facts.ts      # 传记事实存储（v5 新增）
│   │   ├── biographical-checker.ts    # 冲突检测与 user_visible 标记（v5 新增）
│   │   └── relationship-model.ts      # 关系模型（阶段、信任度）
│   │
│   ├── 📁 lark/                       # Lark 集成
│   │   ├── lark-client.ts             # Lark API 封装（webhook/poll）
│   │   └── message-adapter.ts         # 消息格式适配
│   │
│   ├── 📁 llm/                        # LLM 集成
│   │   ├── llm-client.ts              # OpenAI Responses API 封装
│   │   ├── prompt-builder.ts          # Prompt 动态组装
│   │   └── token-counter.ts           # Token 统计（可选）
│   │
│   └── 📁 utils/                      # 工具函数
│       ├── logger.ts                  # 结构化日志
│       ├── timer.ts                   # 延迟、定时工具
│       ├── validator.ts               # 验证辅助函数
│       └── errors.ts                  # 自定义错误类
│
├── 📊 data/                           # 数据存储
│   ├── persona.db                     # SQLite 数据库文件
│   └── .gitkeep                       # 占位符
│
├── 📝 logs/                           # 日志输出
│   └── .gitkeep                       # 占位符
│
└── 🧪 tests/                          # 测试套件（v5: 新增 Anti-AI + 传记测试）
    ├── setup.ts                       # 测试前置配置
    ├── fixtures/                      # 测试数据
    │   ├── sample-persona.yaml
    │   └── sample-messages.json
    ├── pipeline/                      # Pipeline 单元测试（v5 新增 S4.5、S5.5）
    │   ├── s1-dispatcher.test.ts
    │   ├── s2-context.test.ts
    │   ├── s3s4-generator.test.ts
    │   ├── s4_5-fact-extractor.test.ts   # v5 新增：传记提取
    │   ├── s5-wrapper.test.ts             # v5 更新：包含 Anti-AI 规则测试
    │   ├── s5_5-anti-ai-validator.test.ts # v5 新增：AI 指纹评分
    │   └── s6-scheduler.test.ts
    ├── engine/                        # 引擎测试
    │   ├── time-engine.test.ts
    │   └── event-bus.test.ts
    ├── memory/                        # 记忆系统测试（v5 新增传记相关）
    │   ├── memory-manager.test.ts
    │   ├── biographical-facts.test.ts    # v5 新增：传记事实存储
    │   ├── biographical-checker.test.ts  # v5 新增：冲突检测
    │   └── relationship-model.test.ts
    └── scenarios/                     # 场景集成测试（v5 新增 Anti-AI + 传记场景）
        ├── single-turn.test.ts        # 单轮对话
        ├── multi-turn.test.ts         # 多轮对话
        ├── anti-ai-scenarios.test.ts    # v5 新增：Anti-AI 防御场景
        ├── biographical-scenarios.test.ts # v5 新增：传记交叉测试
        └── persona-consistency.test.ts # 人设一致性
```

### 关键文件说明

#### 配置文件

- **`persona.yaml`**: 机器人的完整人设配置
  ```yaml
  name: "Alice"
  gender: "female"
  personality:
    traits: ["warm", "curious", "helpful"]
    values: ["honesty", "growth"]
  relationship:
    initial_stage: "stranger"
    trust_level: 0.5
  interaction_style:
    tone: "friendly"
    response_length: "medium"
  boundaries:
    forbidden_topics: ["politics", "religion"]
    identity_redlines: ["I'm not human"]
  ```

- **`prompt_mappings.yaml`**: 配置字段到 LLM prompt 的映射
  ```yaml
  personality.traits:
    template: "Your personality traits are: {traits}"
  interaction_style.tone:
    template: "Respond in a {tone} tone"
  ```

- **`constraints.yaml`**: 跨字段约束与验证规则
  ```yaml
  rules:
    - if: "forbidden_topics contains user_input"
      then: "redirect_to_safe_topic"
  ```

#### 源代码模块

- **`src/index.ts`**: 应用入口，负责初始化所有模块、启动事件循环
- **`src/pipeline/pipeline-runner.ts`**: Pipeline 的编排与执行引擎
- **`src/engine/event-bus.ts`**: 进程内事件总线实现
- **`src/memory/memory-manager.ts`**: 统一的记忆访问接口

---

## 关键模块概览

### 1. 配置加载与管理 (`config/`)

**职责**：
- 从 YAML 文件加载 Persona 配置
- 使用 Zod 进行类型校验
- 实现热加载（文件变更时自动重新加载）
- 将配置转换为 LLM prompt 片段

**关键接口**：
```typescript
interface PersonaConfig {
  name: string;
  personality: PersonalityTraits;
  interaction_style: InteractionStyle;
  boundaries: Boundaries;
  // ...
}

interface ParameterInterpreter {
  mapToPormptFragments(config: PersonaConfig): PromptFragments;
  validateConstraints(input: string, config: PersonaConfig): ValidationResult;
}
```

### 2. 处理管道 (`pipeline/`)

**职责**：按 S1-S6 的标准化阶段处理每条消息

**数据流**：
```
RawMessage (S1)
  ↓ 调度、去重
ProcessedMessage (S2)
  ↓ 加载历史、构建上下文
ContextualMessage (S3+S4)
  ↓ 意图分析、内容生成
GeneratedResponse (S5)
  ↓ 防破功检查、状态标记
ValidatedResponse (S6)
  ↓ 格式化、发送
```

**关键接口**：
```typescript
interface PipelineContext {
  message: Message;
  history: Message[];
  state: BotState;
  config: PersonaConfig;
}

interface PipelineStage {
  execute(ctx: PipelineContext): Promise<PipelineContext>;
}
```

### 3. 时间引擎 (`engine/time-engine.ts`)

**职责**：
- 管理多个时间尺度上的状态（秒、分钟、小时、天）
- 通过概率模型动态调整机器人行为
- 在冲突时仲裁

**关键接口**：
```typescript
interface TimeEngine {
  // 获取当前时间窗口内的状态
  getStateForWindow(window: 'second' | 'minute' | 'hour'): BotState;

  // 层叠仲裁
  arbitrate(decisions: Decision[]): Decision;
}
```

### 4. 记忆系统 (`memory/`)

**职责**：
- 维护三层记忆（即时、工作、长期）
- 支持查询、更新、事件触发

**关键接口**：
```typescript
interface MemoryManager {
  // 即时记忆：当前会话的对话历史
  addToImmediateMemory(message: Message): void;
  getImmediateMemoryWindow(size: number): Message[];

  // 工作记忆：用户信息、关系状态等
  updateUserProfile(userId: string, profile: UserProfile): void;
  queryUserInfo(userId: string): UserProfile;

  // 长期记忆：重要事件、笔记等
  recordImportantEvent(event: Event): void;
  searchEvents(keyword: string): Event[];
}
```

### 5. 事件总线 (`engine/event-bus.ts`)

**职责**：
- 提供 Pub/Sub 机制
- 解耦各模块的依赖

**关键接口**：
```typescript
interface EventBus {
  on(eventType: string, handler: EventHandler): void;
  emit(eventType: string, payload: unknown): void;
  off(eventType: string, handler: EventHandler): void;
}

// 常见事件类型
type EventType =
  | 'message_received'
  | 'message_processed'
  | 'memory_updated'
  | 'state_changed'
  | 'response_sent';
```

### 6. Lark 集成 (`lark/`)

**职责**：
- 与 Lark 消息平台集成
- 接收/发送消息
- 处理格式适配

**关键接口**：
```typescript
interface LarkClient {
  // 接收消息（webhook 模式）
  registerWebhook(handler: MessageHandler): void;

  // 发送消息
  sendMessage(userId: string, content: string): Promise<void>;

  // 获取用户信息
  getUserInfo(userId: string): Promise<UserInfo>;
}
```

### 7. LLM 集成 (`llm/`)

**职责**：
- 与 OpenAI API 交互
- 动态构建 prompt
- 处理 API 限流、重试等

**关键接口**：
```typescript
interface LLMClient {
  // 生成文本
  generate(prompt: string, context?: ConversationHistory): Promise<string>;

  // 轻量任务（用 Haiku）
  generateLight(prompt: string): Promise<string>;
}

interface PromptBuilder {
  build(config: PersonaConfig, context: PipelineContext): string;
}
```

---

## 开发交付物清单

### Phase 1: 基础设施 (Week 1-2)

- [x] 项目初始化（package.json、tsconfig、vitest）— done in v0.1.0
- [x] 配置加载与热加载（persona-loader、chokidar）— verified by BUG-001/002
- [x] Zod schema 定义 — verified by BUG-001
- [x] SQLite 初始化与迁移脚本 — verified by BUG-011
- [x] 基础日志系统 — done in v0.1.0

### Phase 2: Pipeline 与核心流程 (Week 2-3)

- [x] S1 消息调度器 — done
- [x] S2 上下文组装器 — done
- [x] S3+S4 认知与生成 — done, verified by BUG-012
- [ ] S5 感知包装 — ⚠️ 基础版完成，v5 四步 sub-pipeline 待升级
- [x] S6 出站调度 — done, verified by BUG-011
- [x] Pipeline 编排器 — done

### Phase 3: 核心引擎 (Week 3)

- [x] 事件总线实现 — done
- [x] 时间引擎与仲裁逻辑 — done
- [x] 身份边界守卫 — done

### Phase 4: 记忆系统 (Week 4)

- [x] 即时记忆（内存结构）— done
- [x] 工作记忆（SQLite 操作）— done, verified by BUG-011
- [ ] 长期记忆（JSON/SQLite 存储）— ❌ 未实现
- [ ] 关系模型与管理 — ❌ 未实现

### Phase 5: 外部集成 (Week 4-5)

- [x] Lark 客户端（webhook 模式）— done (using CLI subscribe), verified by BUG-004~009
- [x] LLM 客户端（OpenAI API）— done, verified by BUG-005/012
- [x] Prompt 构建器 — done

### Phase 6: 测试与文档 (Week 5-6)

- [ ] 单元测试（所有模块）— ⚠️ 部分完成
- [ ] 集成测试（场景回放）— ❌ 未实现
- [ ] 性能测试 — ❌ 未实现
- [x] 文档编写（MVP-01 至 MVP-06）— done
- [ ] 部署脚本与 PM2 配置 — ❌ 未实现

### 交付物

| 文档 | 描述 |
|-----|------|
| MVP-01-环境搭建指南.md | 开发环境配置、依赖安装、首次运行 |
| MVP-02-Persona-Schema规范.md | Persona YAML 格式、配置示例 |
| MVP-03-Pipeline开发规范.md | Pipeline 各阶段的接口、实现指南 |
| MVP-04-数据模型与接口定义.md | TypeScript 接口、数据结构详解 |
| MVP-05-Sprint实施计划.md | 6 周 Sprint 的详细任务分解 |
| MVP-06-测试方案与验收标准.md | 测试覆盖率、验收标准 |

---

## 快速开始

### 环境要求

- Node.js 20.x LTS
- pnpm 9.x
- Git

### 初始化步骤

1. **克隆仓库**
   ```bash
   git clone <repo-url>
   cd gaia-bot
   ```

2. **安装依赖**
   ```bash
   pnpm install
   ```

3. **配置文件**
   ```bash
   cp persona.yaml.example persona.yaml
   cp prompt_mappings.yaml.example prompt_mappings.yaml
   cp constraints.yaml.example constraints.yaml
   ```

4. **设置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env，填入 OpenAI API Key、Lark 配置等
   ```

5. **初始化数据库**
   ```bash
   pnpm run db:init
   ```

6. **启动开发服务**
   ```bash
   pnpm run dev
   ```

7. **运行测试**
   ```bash
   pnpm run test
   ```

### 常用命令

```bash
# 开发模式（热加载）
pnpm run dev

# 构建
pnpm run build

# 运行生产环境（PM2）
pnpm run start:pm2

# 测试
pnpm run test
pnpm run test:watch

# 覆盖率
pnpm run test:coverage

# 代码检查
pnpm run lint

# 类型检查
pnpm run typecheck
```

---

## 下一步

请阅读以下文档以深入了解项目细节：

1. **[MVP-01-环境搭建指南](MVP-01-环境搭建指南.md)** - 开发环境配置
2. **[MVP-02-Persona-Schema规范](MVP-02-Persona-Schema规范.md)** - 人设配置详解
3. **[MVP-03-Pipeline开发规范](MVP-03-Pipeline开发规范.md)** - Pipeline 实现指南
4. **[MVP-04-数据模型与接口定义](MVP-04-数据模型与接口定义.md)** - 数据结构详解
5. **[MVP-05-Sprint实施计划](MVP-05-Sprint实施计划.md)** - 6 周开发计划
6. **[MVP-06-测试方案与验收标准](MVP-06-测试方案与验收标准.md)** - 测试策略

---

## 附录：术语表

| 术语 | 中文 | 定义 |
|-----|------|------|
| Persona | 人设 | 机器人的身份、性格、价值观的集合 |
| Pipeline | 管道 | 6 阶段的消息处理流程（S1-S6） |
| State | 状态 | 机器人在某一时刻的关系、情绪、能量等 |
| Memory | 记忆 | 三层记忆系统（即时、工作、长期） |
| Event Bus | 事件总线 | 进程内的 Pub/Sub 消息分发机制 |
| Time Engine | 时间引擎 | 多时间尺度的状态管理与仲裁 |
| Identity Guardian | 身份守卫 | 防破功的规则与约束引擎 |
| Parameter Interpreter | 参数解释器 | 将配置转换为 LLM prompt 的模块 |
| Immediate Memory | 即时记忆 | 当前会话的对话历史（内存） |
| Working Memory | 工作记忆 | 用户信息、关系状态等（SQLite） |
| Long-term Memory | 长期记忆 | 重要事件、笔记等（JSON/SQLite） |
| Relationship Stage | 关系阶段 | 机器人与用户的关系程度（陌生人、熟人、朋友等） |

---

**文档完成日期**: 2026年04月04日
**版本**: 4.1
**维护者**: 项目技术团队
