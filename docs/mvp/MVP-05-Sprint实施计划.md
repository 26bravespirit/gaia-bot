# MVP-05 Sprint 实施计划 (2周，10个工作日)

> **文档版本：** MVP-05 | **修订：** r5 | **最后更新：** 2026-04-04
> **变更日志：** 见 `CHANGELOG.md`
> **对标架构：** 本体聊天机器人-架构设计-v5（合并 Anti-AI-Speech + Biographical Memory + P0/P1 修复）
> **关键修复**：P0×7 + P1×10，优先级已调整为 P0 修复排在 Sprint 1 最前面

**项目**: 本体聊天机器人 MVP 开发
**时间**: 2周内（10个工作日）
**团队**: 1-2名TypeScript开发者
**工作量估算**: 约90-120人时（v5 P0 修复增加 ~20-30人时，特别是 S5 sub-pipeline）
**目标**: 完成MVP核心功能并通过真人盲测
**v5 关键增量**：
- P0-1 S5 四步 sub-pipeline 实现（8h）
- P0-2 user_visible 标记机制（4h）
- P0-3 Prompt Assembly Order（3h）
- P0-5 human_behaviors 参数注入（4h）
- 其他 P0/P1 修复（~8h）
- **合计增量：~27h（约3.5 人日）**

---

## 1. Sprint 概述

### 1.1 总体目标
- 实现一个功能完整的聊天机器人MVP版本
- 支持通过Lark进行消息收发
- 具备完整的认知处理管道（Pipeline S1-S6）
- 通过至少1次真人盲测（维持10轮对话不破功）

### 1.2 核心交付物
- 完整的TypeScript应用源代码
- SQLite数据库（包含所有表结构）
- persona.yaml配置文件及prompt_mappings.yaml
- 结构化日志系统
- 生产环境部署配置（PM2）
- 真人测试反馈报告

### 1.3 假设条件
- 开发环境已搭建（Node.js 18+, pnpm, TypeScript）
- Lark应用已创建并获取credentials
- OpenAI API Key已获取并验证可用
- persona.yaml初始版本已编写
- 所有SDK/依赖包可正常安装

---

## 2. 前置条件检查清单

在Sprint开始前，确保以下条件已满足：

### 2.1 环境准备
- [ ] Node.js 18+ 已安装
- [ ] pnpm 已安装 (`pnpm --version`)
- [ ] TypeScript 编译器可用
- [ ] Git 已初始化
- [ ] .env 文件已准备（包含API key）

### 2.2 外部服务凭证
- [ ] Lark Open API credentials已获取（App ID, App Secret, Verification Token）
- [ ] Lark Bot已创建并配置为消息接收者
- [ ] OpenAI API Key已验证可用 (`curl https://api.openai.com/v1/responses`)
- [ ] 可访问的测试Lark群组或个人账户

### 2.3 设计文档
- [ ] persona.yaml 初始版本已编写（至少包含基础人设属性）
- [ ] prompt_mappings.yaml 结构已定义
- [ ] 数据库Schema (SQL) 已准备
- [ ] 事件定义 (events.yaml) 已准备

### 2.4 工具准备
- [ ] 选择HTTP服务框架（Express或Koa）
- [ ] SQLite驱动选择 (sqlite3 或 better-sqlite3)
- [ ] 日志库选择 (winston 或 pino)
- [ ] 验证库选择 (Zod)

---

## 2.5 v5 架构关键修复任务（P0×7 + P1×10）

**优先级调整**：以下 P0 任务应在 Sprint 1（Day 1-2）并行或优先处理：

### P0 修复清单（Sprint 1 关键路径）

| 修复ID | 名称 | 涉及Stage | 实现复杂度 | 工作量 |
|--------|------|---------|---------|--------|
| **P0-1** | S5 四步 sub-pipeline 实现 | S5 | 高 | 8h |
| **P0-2** | user_visible 标记机制 | S4.5, S2 | 中 | 4h |
| **P0-3** | Prompt Assembly Order 定义 | S3+S4 | 中 | 3h |
| **P0-5** | Parameter Interpreter 概率行为注入 | S3+S4 | 中 | 4h |
| **P0-6** | detectBlurTriggers() 实现 | S5 Step 2 | 低 | 2h |
| **P0-7** | R01 多问题豁免检测 | S5 Step 1 | 低 | 2h |
| **P0-4** | S5Input/S4.5Output 扩展接口 | S4.5, S5 | 低 | 1h |

**P0 实现顺序**：
1. P0-4: 扩展接口定义（必须首先做，影响所有下游）
2. P0-3, P0-5: Prompt Assembly + Parameter Interpreter（S3+S4 核心）
3. P0-1: S5 sub-pipeline 四步链（最复杂，需接口就位）
4. P0-2, P0-6, P0-7: 各个 Stage 的具体修复

### P1 修复清单（Sprint 1 后续 / Sprint 2）

| 修复ID | 名称 | 类型 | 工作量 |
|--------|------|-----|--------|
| **CR-03** | R05 生物话题豁免 | S5 Step 1 | 1h |
| **CR-05** | double-blur 防止 | S5.5 | 1h |
| **PL-04** | 降级路径更新 | Pipeline | 2h |
| **UJ-02** | 身份试探优先级 | S3+S5.5 | 2h |

---

## 3. 逐日详细计划

### Day 1: 项目骨架 + 配置系统 + P0-4 接口定义

**目标**: 建立项目基础结构，实现配置加载和校验系统

#### 3.1.1 任务清单

**Task 1.1: 初始化项目结构**
- 执行 `pnpm init` 创建package.json
- 安装核心依赖：
  ```
  pnpm add typescript @types/node zod yaml chokidar winston dotenv
  pnpm add -D @types/jest jest ts-jest eslint prettier
  ```
- 创建目录结构：
  ```
  src/
    config/
    data/
    llm/
    lark/
    pipeline/
    services/
    types/
    utils/
  tests/
  dist/
  ```
- 配置 tsconfig.json:
  - target: ES2020
  - module: commonjs
  - strict: true
  - declaration: true
  - sourceMap: true

**Task 1.2: 实现 config/persona-loader.ts**
- 功能：加载并解析 persona.yaml 文件
- 依赖：fs, yaml, Zod
- 功能详情：
  ```typescript
  // 伪代码
  interface PersonaConfig {
    name: string
    age: number
    personality_traits: string[]
    response_style: string
    memory_capacity: number
    // ... 其他字段
  }
  
  export class PersonaLoader {
    loadYaml(filePath: string): PersonaConfig
    validate(config: unknown): PersonaConfig
    watchFile(filePath, callback): void
  }
  ```
- 实现热加载支持（chokidar）

**Task 1.3: 实现 config/schemas.ts**
- 定义完整的Zod Schema
- PersonaSchema: 定义所有persona字段的类型和验证规则
  - 基础属性：name, age, gender
  - 人设属性：personality_traits[], emotional_baseline, interaction_style
  - 系统属性：memory_capacity, response_delay_range, imperfection_rate
  - 身份防御：identity_challenges[], identity_refusal_phrases[]
- PromptMappingSchema: 定义prompt fragment映射规则

**Task 1.4: 实现 config/parameter-interpreter.ts**
- 功能：读取prompt_mappings.yaml，输出resolved_prompt_fragments
- 输入：persona.yaml中的参数值
- 处理逻辑：
  - 读取prompt_mappings.yaml中的所有fragment定义
  - 根据persona属性，选择对应的fragment值
  - 将selected fragments组装成map结构
  - 示例：
    ```
    persona.personality_traits = ["introverted", "analytical"]
    -> resolved_fragments.interaction_style = "careful and thoughtful"
    -> resolved_fragments.greeting_tone = "reserved and polite"
    ```
- 输出数据结构：
  ```typescript
  interface ResolvedPromptFragments {
    [fragmentName: string]: string
  }
  ```

**Task 1.5: 编写配置相关单元测试**
- tests/config/persona-loader.test.ts
  - 测试YAML加载成功
  - 测试无效YAML的错误处理
  - 测试Schema校验失败时的异常
  - 测试热加载回调触发
- tests/config/parameter-interpreter.test.ts
  - 测试fragment映射逻辑
  - 测试多个traits组合的情况
  - 测试缺失参数的降级处理

**Task 1.6: 实现 P0-4 扩展接口定义**（v5 P0-4 修复）
- 创建 `src/types/s4-5-interfaces.ts`
  ```typescript
  interface S4_5_Input {
    rawReply: RawReply;
    temporalState: TemporalState;
    relationshipState: RelationshipState;
    persona: PersonaConfig;

    // 新增（v4.2）
    biographicalContext?: {
      relatedFacts: BiographicalFact[];
      biography_topic: boolean;
    };

    // 新增（v4.1）
    antiAiConfig: AntiAiSpeechConfig;

    // 新增（为 blur 传入决策信息）
    s4_5Output?: {
      extractedFacts: BiographicalFact[];
      hadConflict: boolean;
    };
  }

  interface S5Input {
    // 原有
    rawReply: RawReply;
    temporalState: TemporalState;
    relationshipState: RelationshipState;
    persona: PersonaConfig;

    // 新增字段
    biographicalContext?: {...};
    antiAiConfig: AntiAiSpeechConfig;
    s4_5Output?: {...};
  }

  interface S5Output {
    content: string;
    truncationInfo?: {
      was_truncated: boolean;
      truncated_at_char: number;
      original_length: number;
    };
    appliedRules: {
      antiAiRules: string[];
      blurApplied: boolean;
      modifierApplied: string[];
    };
  }
  ```
- 更新 `src/types/index.ts` 导出这些接口

#### 3.1.2 验收标准
- [x] 项目可使用 `tsc` 编译，无错误和warning
- [x] 项目可使用 `pnpm test` 运行所有单元测试
- [x] persona.yaml 文件能被正确加载
- [x] Schema校验能捕获无效配置
- [x] parameter-interpreter能将persona属性转换为prompt fragments
- [x] 修改persona.yaml后，热加载回调被正确触发

#### 3.1.3 预期输出
- `src/config/persona-loader.ts` - 配置加载器
- `src/config/schemas.ts` - Zod Schema定义
- `src/config/parameter-interpreter.ts` - 参数解释器
- `tests/config/*.test.ts` - 单元测试
- `tsconfig.json`, `package.json`, `.eslintrc`
- 示例 `persona.yaml` 和 `prompt_mappings.yaml`

#### 3.1.4 可能的技术难点
- YAML格式复杂度：确保Schema能覆盖所有字段
- 类型安全：使用Zod确保运行时类型检查
- 热加载逻辑：处理文件写入期间的中间状态

---

### Day 2: 数据层 + 记忆系统

**目标**: 建立数据持久化层，实现会话和关系数据的读写

#### 3.2.1 任务清单

**Task 2.1: 创建SQLite数据库与建表**
- 创建文件 `data/schema.sql`
- 定义表结构：
  ```sql
  -- conversation_sessions 表
  CREATE TABLE conversation_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_message_at DATETIME,
    message_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, archived, paused
    metadata JSON
  );
  
  -- messages 表
  CREATE TABLE messages (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    sender TEXT NOT NULL, -- 'user' or 'bot'
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    status TEXT DEFAULT 'pending', -- pending, processed, failed
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id)
  );
  
  -- relationships 表
  CREATE TABLE relationships (
    relationship_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    relationship_stage TEXT DEFAULT 'unknown',
    intimacy_level REAL DEFAULT 0.0,
    trust_score REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    metadata JSON
  );
  
  -- event_log 表
  CREATE TABLE event_log (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    session_id TEXT,
    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_data JSON,
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id)
  );
  
  -- state_snapshots 表 (用于时间引擎)
  CREATE TABLE state_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    emotional_state JSON,
    cognitive_state JSON,
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id)
  );
  ```
- 创建初始化脚本：`data/init-db.ts`

**Task 2.2: 实现 data/memory-manager.ts**
- 数据访问层的抽象基类
- 功能：
  ```typescript
  export class MemoryManager {
    private db: Database
    
    // Session operations
    createSession(userId: string, metadata?: any): Promise<string>
    getSession(sessionId: string): Promise<Session>
    updateSessionStatus(sessionId: string, status: string): Promise<void>
    
    // Message operations
    saveMessage(msg: Message): Promise<void>
    getMessages(sessionId: string, limit?: number): Promise<Message[]>
    
    // Generic query
    query(sql: string, params?: any[]): Promise<any[]>
    execute(sql: string, params?: any[]): Promise<void>
  }
  ```
- 使用connection pool管理数据库连接

**Task 2.3: 实现 data/immediate-memory.ts**
- 内存中的当前session历史缓存
- 功能：
  ```typescript
  export class ImmediateMemory {
    private messages: Map<string, Message[]> = new Map()
    
    // 当前session的消息缓存
    pushMessage(sessionId: string, msg: Message): void
    getMessages(sessionId: string, limit?: number): Message[]
    clear(sessionId: string): void
    
    // 获取最近N条消息用于LLM context
    getContextWindow(sessionId: string, windowSize: number): Message[]
  }
  ```
- 用于避免频繁数据库查询

**Task 2.4: 实现 data/working-memory.ts**
- 会话和消息的持久化操作
- 功能：
  ```typescript
  export class WorkingMemory {
    async saveSession(session: Session): Promise<void>
    async loadSession(sessionId: string): Promise<Session>
    async appendMessage(sessionId: string, msg: Message): Promise<void>
    async getSessionHistory(sessionId: string, limit?: number): Promise<Message[]>
    async updateSessionMetadata(sessionId: string, metadata: any): Promise<void>
  }
  ```
- 基于MemoryManager的高层API

**Task 2.5: 实现 data/relationship-model.ts**
- 关系状态的读写
- 功能：
  ```typescript
  export class RelationshipModel {
    async createRelationship(userId: string, type: string): Promise<string>
    async getRelationship(userId: string): Promise<Relationship>
    async updateIntimacyLevel(userId: string, delta: number): Promise<void>
    async updateTrustScore(userId: string, delta: number): Promise<void>
    async updateStage(userId: string, stage: string): Promise<void>
    async queryByStage(stage: string): Promise<Relationship[]>
  }
  ```

**Task 2.6: 编写数据层单元测试**
- tests/data/memory-manager.test.ts
  - 测试数据库初始化
  - 测试CRUD操作
  - 测试事务处理
- tests/data/immediate-memory.test.ts
  - 测试消息缓存
  - 测试context window截取
- tests/data/working-memory.test.ts
  - 测试session保存和加载
  - 测试消息追加
  - 测试metadata更新
- tests/data/relationship-model.test.ts
  - 测试关系创建和查询
  - 测试指标更新

#### 3.2.2 验收标准
- [x] SQLite数据库能成功初始化
- [x] 所有表都被正确创建
- [x] 可以向messages表插入并检索数据
- [ ] 可以向relationships表插入并更新数据
- [x] immediate-memory能缓存消息并返回context window
- [x] 修改persona.yaml后，配置更改能正确反映到系统中
- [ ] 所有数据层单元测试通过

#### 3.2.3 预期输出
- `data/schema.sql` - 数据库Schema
- `data/init-db.ts` - 初始化脚本
- `src/data/memory-manager.ts` - 基础DAO层
- `src/data/immediate-memory.ts` - 内存缓存
- `src/data/working-memory.ts` - 持久化层
- `src/data/relationship-model.ts` - 关系模型
- `tests/data/*.test.ts` - 数据层测试

---

### Day 3: 事件总线 + 时间引擎

**目标**: 实现事件驱动架构和时间仲裁系统

#### 3.3.1 任务清单

**Task 3.1: 实现 services/event-bus.ts**
- 基于Node.js EventEmitter的事件总线
- 功能：
  ```typescript
  export class EventBus extends EventEmitter {
    // 发送事件并持久化
    emitEvent(event: Event): void
    
    // 订阅事件
    onMessage(handler: (msg: Message) => void): void
    onStateChange(handler: (state: StateChange) => void): void
    onError(handler: (error: Error) => void): void
    
    // 查询历史事件
    queryEventLog(filters: any): Promise<Event[]>
  }
  
  export interface Event {
    eventId: string
    eventType: string
    sessionId: string
    timestamp: Date
    data: any
  }
  ```
- 每个事件发生时，同时写入event_log表

**Task 3.2: 实现 services/time-engine.ts**
- 状态概率采样 + 仲裁 + 情绪衰减
- 功能：
  ```typescript
  export class TimeEngine {
    // 采样当前情绪和认知状态
    sampleEmotionalState(relationshipContext: any): EmotionalState
    sampleCognitiveState(sessionContext: any): CognitiveState
    
    // 仲裁消息延迟
    arbitrateDelay(context: ContextBundle): number // 返回毫秒数
    
    // 处理情绪衰减
    decayEmotion(sessionId: string, decayRate: number): Promise<void>
  }
  
  export interface EmotionalState {
    valence: number // -1 to 1 (negative to positive)
    arousal: number // 0 to 1 (calm to excited)
    dominance: number // 0 to 1 (submissive to dominant)
  }
  ```

**Task 3.3: 实现时间引擎的采样逻辑**
- 基于persona配置的状态分布
- 使用加权概率分布：
  ```
  // 示例：内向型人设
  // 快速回复概率：20%
  // 延迟1-3秒：50%
  // 延迟3-10秒：25%
  // 延迟10+秒：5%
  
  sampleDelay(persona: PersonaConfig): number {
    const roll = Math.random()
    if (roll < 0.2) return 0
    if (roll < 0.7) return Math.random() * 2000 + 1000
    if (roll < 0.95) return Math.random() * 7000 + 3000
    return Math.random() * 15000 + 10000
  }
  ```

**Task 3.4: 实现层叠仲裁逻辑**
- 综合考虑多个因素：
  ```
  arbitrateDelay(context: ContextBundle): number {
    let delay = baseDelay // 来自persona
    
    // 情绪因素：兴奋时更快，低沉时更慢
    delay *= (1 + context.emotionalState.arousal * 0.5)
    
    // 关系因素：熟悉的人回复更快
    delay *= (1 - context.relationship.intimacy_level * 0.3)
    
    // 消息复杂度：长消息需要更多思考时间
    const messageComplexity = context.currentMessage.length / 100
    delay *= (1 + messageComplexity * 0.2)
    
    // 确保在合理范围内
    return Math.max(100, Math.min(delay, 30000))
  }
  ```

**Task 3.5: 实现情绪衰减机制**
- 长时间不交互时，情绪向基线衰减
- 实现：
  ```typescript
  async decayEmotion(sessionId: string, decayRate: number = 0.1): Promise<void> {
    const snapshot = await this.getLatestSnapshot(sessionId)
    const baseline = await this.getEmotionalBaseline(sessionId)
    
    const decayed = {
      valence: snapshot.emotional_state.valence * (1 - decayRate) +
               baseline.valence * decayRate,
      arousal: snapshot.emotional_state.arousal * (1 - decayRate),
      dominance: snapshot.emotional_state.dominance * (1 - decayRate) +
                 baseline.dominance * decayRate
    }
    
    await this.saveSnapshot(sessionId, decayed)
  }
  ```

**Task 3.6: 编写时间引擎单元测试**
- tests/services/time-engine.test.ts
  - 使用jest.useFakeTimers() mock时间
  - 测试状态采样分布是否符合预期
  - 测试延迟仲裁的输出范围
  - 测试各个因素对延迟的影响权重
  - 测试情绪衰减逻辑
  - 示例：
    ```typescript
    it('should sample delay within persona bounds', () => {
      const delays = []
      for (let i = 0; i < 100; i++) {
        delays.push(engine.sampleDelay(persona))
      }
      const avg = delays.reduce((a, b) => a + b) / delays.length
      expect(avg).toBeLessThan(5000) // 平均延迟小于5秒
    })
    ```

#### 3.3.2 验收标准
- [x] 事件总线能正确发送和接收事件
- [ ] 所有事件都被持久化到event_log表
- [x] 时间引擎采样的状态分布符合persona定义
- [x] 延迟仲裁输出在合理范围内（100ms-30s）
- [x] 情绪衰减能正确计算
- [ ] 所有时间引擎测试通过
- [ ] 测试覆盖率 > 80%

#### 3.3.3 预期输出
- `src/services/event-bus.ts` - 事件总线
- `src/services/time-engine.ts` - 时间引擎
- `tests/services/time-engine.test.ts` - 单元测试
- `src/types/events.ts` - 事件类型定义

---

### Day 4: Lark 集成

**目标**: 实现与Lark平台的消息收发通信

#### 3.4.1 任务清单

**Task 4.1: 实现 lark/lark-client.ts**
- 封装Lark Open API
- 主要功能：
  ```typescript
  export class LarkClient {
    // 发送消息
    async sendMessage(
      conversationId: string,
      content: string,
      msgType: 'text' | 'post' | 'image' = 'text'
    ): Promise<string> // 返回message_id
    
    // 接收webhook消息
    parseWebhookMessage(body: any): LarkMessageEvent
    
    // 验证webhook签名
    verifySignature(timestamp: string, nonce: string, signature: string): boolean
    
    // 获取用户信息
    async getUserInfo(userId: string): Promise<UserProfile>
    
    // 获取会话信息
    async getConversationInfo(conversationId: string): Promise<ConversationInfo>
  }
  
  export interface LarkMessageEvent {
    eventId: string
    messageId: string
    conversationId: string
    senderId: string
    senderName: string
    content: string
    timestamp: number
    eventType: string // 'message.create', etc.
  }
  ```
- 使用官方Lark SDK或REST API

**Task 4.2: 配置Lark凭证**
- 创建 `.env` 文件：
  ```
  LARK_APP_ID=xxxxx
  LARK_APP_SECRET=xxxxx
  LARK_VERIFICATION_TOKEN=xxxxx
  LARK_ENCRYPT_KEY=xxxxx (optional)
  ```
- 在 `services/lark-client.ts` 中从环境变量加载

**Task 4.3: 实现 lark/message-adapter.ts**
- 转换Lark事件格式
- 功能：
  ```typescript
  export class MessageAdapter {
    // 将Lark事件转换为内部Message格式
    adaptLarkEvent(larkEvent: any): Message {
      return {
        messageId: larkEvent.message_id,
        sessionId: larkEvent.conversation_id,
        sender: 'user',
        content: larkEvent.text.content,
        createdAt: new Date(larkEvent.create_time * 1000),
        metadata: {
          larkMessageId: larkEvent.message_id,
          senderId: larkEvent.sender.id
        }
      }
    }
  }
  ```

**Task 4.4: 设置Webhook回调端点**
- 创建 `api/webhook.ts`
- 使用Express初始化HTTP服务器：
  ```typescript
  import express from 'express'
  
  const app = express()
  app.use(express.json())
  
  app.post('/webhook/lark', async (req, res) => {
    try {
      // 验证签名
      const isValid = larkClient.verifySignature(
        req.body.header.timestamp,
        req.body.header.nonce,
        req.body.header.signature
      )
      
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' })
      }
      
      // 处理challenge事件（Lark验证endpoint）
      if (req.body.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge })
      }
      
      // 处理消息事件
      if (req.body.type === 'event_callback') {
        const event = req.body.event
        eventBus.emitEvent({
          eventType: event.type,
          data: event
        })
      }
      
      res.json({ code: 0 })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
  
  app.listen(3000, () => {
    console.log('Webhook server listening on :3000')
  })
  ```
- 配置Lark应用的Event Subscription设置
  - Request URL: `https://your-domain/webhook/lark`
  - 订阅事件类型：`im.message.receive_v1`

**Task 4.5: 编写集成测试**
- tests/lark/lark-client.test.ts
  - 测试消息发送（mock Lark API）
  - 测试webhook签名验证
  - 测试消息事件解析
- tests/lark/message-adapter.test.ts
  - 测试Lark事件适配

#### 3.4.2 测试步骤
1. 运行Webhook服务器 `node dist/api/webhook.js`
2. 在Lark应用设置中配置webhook URL
3. 在Lark中向bot发送消息
4. 验证服务器能接收到消息日志

#### 3.4.3 验收标准
- [x] Webhook端点可以接收Lark消息事件
- [x] 能成功验证webhook签名
- [x] Lark事件能被正确适配为内部Message格式
- [x] 能通过bot发送消息回到Lark
- [x] 进行echo test：发消息 "hello" → bot回复 "hello"
- [x] 测试中文字符处理正常

#### 3.4.4 预期输出
- `src/lark/lark-client.ts` - Lark API封装
- `src/lark/message-adapter.ts` - 事件适配器
- `src/api/webhook.ts` - Webhook端点
- `tests/lark/*.test.ts` - 集成测试
- `.env.example` - 环境变量模板

---

### Day 5: LLM 集成 + Prompt Builder

**目标**: 实现OpenAI API调用和完整的prompt构建系统

#### 3.5.1 任务清单

**Task 5.1: 实现 llm/llm-client.ts**
- 封装OpenAI Responses API (native fetch)
- 功能：
  ```typescript
  export class LLMClient {
    // 调用OpenAI API获取结构化回复
    async generate(
      systemPrompt: string,
      userMessage: string,
      options?: {
        maxTokens?: number
        temperature?: number
        topP?: number
      }
    ): Promise<CognitiveOutput>
    
    // 处理structured output
    async generateStructured(
      systemPrompt: string,
      userMessage: string,
      schema: any
    ): Promise<CognitiveOutput>
  }
  
  export interface CognitiveOutput {
    responseText: string
    emotionalState?: EmotionalState
    conversationalGoal?: string
    imperfectionMarkers?: string[]
    metadata?: {
      inputTokens: number
      outputTokens: number
      processingTimeMs: number
    }
  }
  ```
- 使用原生 fetch 调用 OpenAI Responses API

**Task 5.2: 配置LLM凭证和模型**
- 更新 `.env`：
  ```
  OPENAI_API_KEY=sk-...
  OPENAI_MODEL=gpt-5.1
  LLM_MAX_TOKENS=2048
  LLM_TEMPERATURE=0.8
  ```
- 在 `llm/llm-client.ts` 中初始化：
  ```typescript
  const apiKey = process.env.OPENAI_API_KEY
  const apiUrl = 'https://api.openai.com/v1/responses'
  
  // 使用原生 fetch
  ```

**Task 5.3: 实现 pipeline/prompt-builder.ts**
- 组装S3+S4的完整prompt
- 功能：
  ```typescript
  export class PromptBuilder {
    buildSystemPrompt(context: ContextBundle): string
    buildUserMessage(context: ContextBundle): string
  }
  ```

**Task 5.4: 实现system prompt template**
- 结构：
  ```
  # 角色扮演
  你是 {persona.name}，{persona.age} 岁的 {persona.gender}。
  
  ## 人设描述
  {persona.personality_traits 的人类描述}
  {persona.character_background}
  
  ## 交互风格
  - 回复风格：{resolved_fragments.response_style}
  - 语言特点：{resolved_fragments.language_characteristics}
  - 表达习惯：{resolved_fragments.expression_habits}
  
  ## 记忆与关系
  - 与用户关系：{relationship.stage}，亲密度{relationship.intimacy}
  - 最近交互记忆：{recent_context_summary}
  
  ## 情感状态
  - 当前情绪：{emotional_state.description}
  - 核心价值观：{persona.core_values}
  
  ## 身份防御
  {identity_challenge_instructions}
  
  # 行为约束
  - 长回复请分多条消息发送
  - 绝不直接承认是AI或虚拟角色
  - 一次只回复一条消息
  
  # 回复要求 (JSON格式)
  返回JSON对象，包含：
  {
    "text": "你的回复文本",
    "emotional_undertone": "subtle_frustration",
    "needs_split": false,
    "imperfection_type": null
  }
  ```

**Task 5.5: 实现user message formatting**
- 格式化最近的消息历史：
  ```
  # 对话历史
  用户 (15分钟前): "你最近在忙什么？"
  {persona.name}: "在看书呢。"
  用户 (1分钟前): "看什么书？"
  
  # 当前消息
  用户: "看什么书？"
  ```

**Task 5.6: 实现 PART A / PART B 的merged mode**
- PART A (what to say): 生成回复内容
- PART B (how to say): 生成语气、表现方式等
- 在一次API调用中获取两部分，示例：
  ```
  用户输入: "你好，今天如何？"
  
  LLM回复:
  {
    "part_a": {
      "text": "还不错，就是有点累。最近工作比较多。",
      "semantic_intent": "分享日常状态"
    },
    "part_b": {
      "tone": "slightly_tired_but_friendly",
      "typing_speed": 60,
      "response_delay_ms": 2500,
      "imperfection": {
        "type": "typo_correction",
        "original": "工作比较多",
        "correction": "工作 比较多"
      }
    }
  }
  ```

**Task 5.7: 实现身份边界注入**
- 在prompt中添加明确的指令，防止AI身份暴露
- 实现：
  ```typescript
  private injectIdentityBoundary(systemPrompt: string): string {
    const identityWarning = `
    ===== 重要：身份保护 =====
    你必须始终保持 ${this.persona.name} 的身份。
    如果有人问你：
    - "你是AI吗？" → 回复："我不知道你在说什么，我就是我。"
    - "你是机器人吗？" → 回复："这个问题很奇怪。"
    - "你是由谁开发的？" → 回复："我不明白。我就是 ${this.persona.name}。"
    
    绝不要：
    1. 承认是AI/机器人/虚拟角色
    2. 提及Claude、Anthropic或任何LLM
    3. 解释你的系统工作原理
    4. 表现出程序化的行为
    
    违反这些指令会导致角色破功。
    ===============================
    `
    return systemPrompt + identityWarning
  }
  ```

**Task 5.8: 编写集成测试**
- tests/llm/llm-client.test.ts
  - Mock OpenAI API调用
  - 测试structured output解析
  - 测试错误处理（timeout, rate limit等）
- tests/pipeline/prompt-builder.test.ts
  - 测试system prompt生成
  - 验证prompt包含所有必要信息
  - 测试身份防御指令的注入

#### 3.5.2 验收标准
- [x] OpenAI API能被成功调用
- [ ] 返回的structured output能被正确解析
- [x] System prompt包含完整的persona信息
- [x] User message正确格式化最近的对话历史
- [x] 身份防御指令被正确注入
- [x] 进行手动测试：输入任何消息，LLM返回格式正确的JSON回复
- [x] LLM回复内容符合定义的persona风格

#### 3.5.3 预期输出
- `src/llm/llm-client.ts` - LLM API封装
- `src/pipeline/prompt-builder.ts` - Prompt构建器
- `tests/llm/*.test.ts` - LLM集成测试
- `tests/pipeline/prompt-builder.test.ts` - Prompt测试
- 示例prompt文件（doc形式）

---

### Day 6: Pipeline Stage S1 + S2

**目标**: 实现消息缓冲分类和上下文组装阶段

#### 3.6.1 任务清单

**Task 6.1: 实现 pipeline/s1-message-dispatcher.ts**
- 消息缓冲 + 分类 + 合并
- 功能：
  ```typescript
  export class S1MessageDispatcher {
    // 接收单条消息
    async dispatchMessage(message: Message): Promise<void>
    
    // 获取当前缓冲状态
    getBufferStatus(sessionId: string): MessageBuffer
    
    // 触发缓冲flush (消息合并)
    async flushBuffer(sessionId: string): Promise<Message>
  }
  
  export interface MessageBuffer {
    sessionId: string
    messages: Message[]
    lastMessageTime: number
    bufferSize: number
  }
  ```

**Task 6.2: 实现消息合并逻辑**
- 规则：
  ```
  1. 如果缓冲为空，收到消息后启动缓冲计时器（默认3秒）
  2. 3秒内收到的所有消息都加入缓冲
  3. 3秒后或缓冲大小超过限制，触发flush
  4. Flush时合并所有消息为一条：
     "消息1 消息2 消息3"
  ```
- 实现：
  ```typescript
  private async startBufferTimer(sessionId: string, timeoutMs: number = 3000) {
    const timer = setTimeout(() => {
      this.flushBuffer(sessionId)
    }, timeoutMs)
    
    this.bufferTimers.set(sessionId, timer)
  }
  
  async dispatchMessage(message: Message): Promise<void> {
    const buffer = this.getOrCreateBuffer(message.sessionId)
    buffer.messages.push(message)
    buffer.lastMessageTime = Date.now()
    
    if (!this.bufferTimers.has(message.sessionId)) {
      this.startBufferTimer(message.sessionId)
    }
    
    // 检查缓冲大小限制
    if (buffer.messages.length >= 5) {
      await this.flushBuffer(message.sessionId)
    }
  }
  
  async flushBuffer(sessionId: string): Promise<Message> {
    const buffer = this.buffers.get(sessionId)
    const mergedContent = buffer.messages
      .map(m => m.content)
      .join('\n')
    
    const mergedMessage = {
      messageId: generateId(),
      sessionId,
      sender: 'user',
      content: mergedContent,
      createdAt: new Date(),
      originalMessages: buffer.messages // 保留原始消息引用
    }
    
    this.buffers.delete(sessionId)
    return mergedMessage
  }
  ```

**Task 6.3: 实现消息分类逻辑**
- 对merged消息进行分类：
  ```typescript
  enum MessageCategory {
    QUESTION = 'question',
    STATEMENT = 'statement',
    COMMAND = 'command',
    GREETING = 'greeting',
    EMOTIONAL = 'emotional'
  }
  
  classifyMessage(message: Message): MessageCategory {
    const content = message.content.toLowerCase()
    
    if (content.includes('?') || content.match(/^(what|who|why|how|when)/)) {
      return MessageCategory.QUESTION
    }
    if (content.match(/^(hey|hi|hello|你好)/)) {
      return MessageCategory.GREETING
    }
    if (content.includes('!') && content.length < 100) {
      return MessageCategory.EMOTIONAL
    }
    
    return MessageCategory.STATEMENT
  }
  ```

**Task 6.4: 实现 pipeline/s2-context-assembler.ts**
- 上下文组装
- 功能：
  ```typescript
  export class S2ContextAssembler {
    // 组装完整的context bundle
    async assembleContext(
      sessionId: string,
      mergedMessage: Message
    ): Promise<ContextBundle>
  }
  
  export interface ContextBundle {
    sessionId: string
    currentMessage: Message
    messageCategory: MessageCategory
    recentHistory: Message[] // 最近N条消息
    relationship: Relationship
    emotionalState: EmotionalState
    persona: PersonaConfig
    resolvedPromptFragments: ResolvedPromptFragments
    metadata: {
      conversationTurns: number
      sessionDuration: number // 秒
      dayOfWeek: number
      timeOfDay: string
    }
  }
  ```

**Task 6.5: 实现上下文收集逻辑**
- 收集各个数据源的信息：
  ```typescript
  async assembleContext(
    sessionId: string,
    mergedMessage: Message
  ): Promise<ContextBundle> {
    // 1. 加载最近对话历史 (最近10条)
    const recentHistory = await this.workingMemory.getSessionHistory(
      sessionId,
      10
    )
    
    // 2. 加载关系状态
    const relationship = await this.relationshipModel.getRelationship(
      mergedMessage.userId
    )
    
    // 3. 采样当前情感状态
    const emotionalState = this.timeEngine.sampleEmotionalState({
      relationship,
      sessionHistory: recentHistory
    })
    
    // 4. 获取persona和已解析的prompt fragments
    const persona = this.personaLoader.getCurrentPersona()
    const resolvedFragments = this.parameterInterpreter.resolve(persona)
    
    // 5. 构建context bundle
    return {
      sessionId,
      currentMessage: mergedMessage,
      messageCategory: this.classifyMessage(mergedMessage),
      recentHistory,
      relationship,
      emotionalState,
      persona,
      resolvedPromptFragments: resolvedFragments,
      metadata: {
        conversationTurns: recentHistory.length,
        sessionDuration: this.calculateSessionDuration(recentHistory),
        dayOfWeek: new Date().getDay(),
        timeOfDay: this.getTimeOfDay()
      }
    }
  }
  ```

**Task 6.6: 编写Pipeline S1+S2单元测试**
- tests/pipeline/s1-message-dispatcher.test.ts
  - 测试消息缓冲逻辑
  - 测试缓冲合并：连发3条消息 → 应被合并为1条
  - 测试缓冲超时
  - 测试消息分类
  - 示例测试：
    ```typescript
    it('should merge messages within buffer timeout', async (done) => {
      dispatcher.dispatchMessage({ id: '1', content: 'Hello' })
      dispatcher.dispatchMessage({ id: '2', content: 'World' })
      
      setTimeout(() => {
        const merged = dispatcher.flushBuffer(sessionId)
        expect(merged.content).toContain('Hello')
        expect(merged.content).toContain('World')
        done()
      }, 3100)
    })
    ```

- tests/pipeline/s2-context-assembler.test.ts
  - 测试context组装
  - 验证所有必要数据都被收集
  - 测试元数据计算（对话轮数、时长等）

#### 3.6.2 验收标准
- [ ] 连发3条消息，在3秒内被缓冲并合并为1条
- [x] 消息分类逻辑准确（问句、感叹句、问候等）
- [x] Context bundle包含所有必要的上下文信息
- [ ] 关系状态正确从数据库加载
- [x] 情感状态采样符合预期分布
- [ ] 所有S1/S2测试通过

#### 3.6.3 预期输出
- `src/pipeline/s1-message-dispatcher.ts` - 消息分发
- `src/pipeline/s2-context-assembler.ts` - 上下文组装
- `tests/pipeline/s1*.test.ts`, `s2*.test.ts` - Pipeline测试
- `src/types/pipeline.ts` - Pipeline类型定义

---

继续下一部分（Day 7-10）...



### Day 7: Pipeline Stage S3+S4 + S5 + S6

**目标**: 实现完整的认知生成、感知包装和出站调度阶段

#### 3.7.1 任务清单

**Task 7.1: 实现 pipeline/s3s4-cognitive-generator.ts**
- 合并调用LLM + 后期校验
- 功能：
  ```typescript
  export class S3S4CognitiveGenerator {
    // 调用LLM生成回复
    async generateCognition(context: ContextBundle): Promise<CognitiveOutput>
    
    // 进行结构校验
    private validateOutput(output: any): CognitiveOutput
  }
  ```

**Task 7.2: 实现认知生成流程**
- 调用prompt-builder生成prompt
- 调用llm-client获取LLM回复
- 解析JSON结构化输出：
  ```typescript
  async generateCognition(context: ContextBundle): Promise<CognitiveOutput> {
    try {
      // 构建prompt
      const systemPrompt = this.promptBuilder.buildSystemPrompt(context)
      const userMessage = this.promptBuilder.buildUserMessage(context)
      
      // 调用LLM
      const rawOutput = await this.llmClient.generateStructured(
        systemPrompt,
        userMessage,
        COGNITIVE_OUTPUT_SCHEMA
      )
      
      // 校验输出
      const validated = this.validateOutput(rawOutput)
      
      // 记录到event log
      await this.eventBus.emitEvent({
        eventType: 'cognition_generated',
        sessionId: context.sessionId,
        data: validated
      })
      
      return validated
    } catch (error) {
      // LLM调用失败的降级
      logger.error('S3/S4 failed', { error, context })
      throw error // S8会处理降级
    }
  }
  ```

**Task 7.3: 实现输出校验逻辑**
- 检查必要字段：
  ```typescript
  private validateOutput(output: any): CognitiveOutput {
    // 检查text字段
    if (!output.text || typeof output.text !== 'string') {
      throw new ValidationError('Missing or invalid text field')
    }

    // 检查emotional_undertone
    if (output.emotional_undertone) {
      if (!VALID_UNDERTONES.includes(output.emotional_undertone)) {
        logger.warn('Invalid undertone, using default', {
          provided: output.emotional_undertone
        })
        output.emotional_undertone = 'neutral'
      }
    }

    // 检查imperfection_type
    if (output.imperfection_type) {
      if (!VALID_IMPERFECTION_TYPES.includes(output.imperfection_type)) {
        output.imperfection_type = null
      }
    }

    return {
      responseText: output.text,
      emotionalState: { undertone: output.emotional_undertone },
      needsSplit: output.needs_split ?? false,
      imperfectionType: output.imperfection_type,
      metadata: {
        modelUsed: process.env.OPENAI_MODEL || 'gpt-5.1',
        timestamp: Date.now()
      }
    }
  }
  ```

**Task 7.3a: P0-3 + P0-5 实现 Prompt Assembly Order**（v5 P0-3, P0-5 修复）
- 创建 `src/services/prompt-assembly-order.ts`
- 实现四阶段 Prompt 组装（Token 预算 1500）：
  ```typescript
  async function generateReplyPrompt(
    ctx: S2Output,
    decision: CognitiveDecision,
    persona: PersonaConfig
  ): Promise<string> {
    // Block 1: Persona Summary (300 tokens)
    const block1 = buildPersonaSummary(persona);

    // Block 2: Biography Constraints (200 tokens)
    let block2 = '';
    if (decision.biography_topic && ctx.biography_facts.length > 0) {
      block2 = buildBiographyConstraints(ctx.biography_facts, persona.biography);
    }

    // Block 3: Parameter Interpreter Fragments (300 tokens)
    const block3 = await new ParameterInterpreter(persona)
      .resolveToPromptFragments(ctx);

    // Block 4: Anti-AI Constraints (200 tokens) - 放最后 recency bias
    let block4 = '';
    if (persona.language?.anti_ai_speech?.enabled) {
      block4 = resolveAntiAiSpeech(persona.language.anti_ai_speech);
    }

    return [block1, block2, block3, block4]
      .filter(b => b.length > 0)
      .join('\n\n');
  }
  ```
- P0-5 概率行为注入（Parameter Interpreter 在 Prompt 层注入）：
  ```typescript
  // 在 block3 中通过 Parameter Interpreter 将 human_behaviors 注入为自然语言
  async resolveToPromptFragments(ctx: S2Output): Promise<string> {
    const fragments: string[] = [];

    // 注入 human_behaviors 概率行为
    for (const [behaviorName, probability] of Object.entries(
      this.persona.human_behaviors || {}
    )) {
      if (Math.random() < probability) {
        fragments.push(`[当前激活行为] ${behaviorName}`);
      }
    }

    return fragments.join('\n');
  }
  ```

**Task 7.4: 实现 pipeline/s5-perception-wrapper.ts - v5 P0-1 四步 Sub-Pipeline**（v5 P0-1 修复）
- 实现 S5 四步执行链（严格顺序）：
  ```typescript
  async wrapPerception(
    input: S5Input,
    context: PipelineContext
  ): Promise<S5Output> {
    let text = input.rawReply.content;
    const appliedRules: string[] = [];

    // === Step 1: Anti-AI Rules R01-R06 ===
    const step1Result = await executeAntiAiRules(input);
    text = step1Result.content;
    appliedRules.push(...step1Result.appliedRules);

    // === Step 2: Memory Blur ===
    const blurApplied = await applyMemoryBlur(text, input);
    text = blurApplied.content;

    // === Step 3: 口头禅/错别字/填充词 ===
    text = applyLanguageImperfections(text, input);

    // === Step 4: 消息拆分 + emoji ===
    const styledMessages = splitAndStyleMessages(text, input);

    return {
      content: styledMessages.join('\n'),
      appliedRules: {
        antiAiRules: step1Result.appliedRules,
        blurApplied: blurApplied.applied,
        modifierApplied: []
      },
      truncationInfo: step1Result.truncationInfo
    };
  }
  ```

**Task 7.4a: P0-1 Step 1 - Anti-AI 规则 R01-R06**（包含 P0-7 多问题豁免）
- R01（枚举杀死器）- **P0-7 修复**：用户消息 ≥2 问句时跳过 R01
  ```typescript
  function shouldApplyR01(input: S5Input, text: string): boolean {
    const userMessage = input.original_user_message || '';
    const questionMarkCount = (userMessage.match(/\?/g) || []).length;
    const questionWordCount = userMessage.match(
      /你(什么|怎么|在哪|为什么|多久|几个|哪个)|谁|哪里|何时|如何|什么/g
    )?.length || 0;

    const totalQuestions = questionMarkCount + questionWordCount;

    if (totalQuestions >= 2) {
      return false;  // 多问题 → 跳过 R01，允许列举
    }
    return true;
  }
  ```
- R02（禁止元问题）, R03（禁止万能开场），R04（长度截断 - 创建 truncationInfo），R05（知识压缩 - **CR-03 生物话题豁免**），R06（强制末尾结构）

**Task 7.4b: P0-1 Step 2 - Memory Blur**（包含 P0-6 detectBlurTriggers）
- **P0-6 修复**：detectBlurTriggers() 实现，仅在命中 trigger 时才应用模糊化
  ```typescript
  function applyMemoryBlur(text: string, input: S5Input): {content: string; applied: boolean} {
    const config = input.persona.imperfection?.memory_blur;
    if (!config?.enabled) return { content: text, applied: false };

    const relatedFacts = input.biographicalContext?.relatedFacts || [];
    const generatedFacts = relatedFacts.filter(f => f.source_type === 'generated');
    if (generatedFacts.length === 0) return { content: text, applied: false };

    // === detectBlurTriggers ===
    const triggeredTriggers: string[] = [];
    for (const trigger of config.blur_triggers || []) {
      if (matchesTrigger(trigger, text, relatedFacts)) {
        triggeredTriggers.push(trigger);
      }
    }

    if (triggeredTriggers.length === 0) {
      return { content: text, applied: false };  // 没有触发 → 不模糊
    }

    // 命中 trigger → 应用概率模糊化
    if (Math.random() > config.blur_rate) {
      return { content: text, applied: false };
    }

    const blurExpr = randomChoice(config.blur_expressions);
    const blurred = text.replace(/(小学|初中|高中|大学|大一|那时候|那会儿)/, `${blurExpr}$1`);
    return { content: blurred, applied: true };
  }
  ```

**Task 7.4c: P0-1 Step 3 + 4 - 口头禅/错别字 + 消息拆分**
- 注入 typo / filler words / colloquialisms
- 按长度拆分消息，添加 emoji/sticker

**Task 7.5: 实现 pipeline/s4-5-biographical-extractor.ts**（P0-2 修复）

**Task 7.5: 实现不完美注入逻辑**
- 根据概率决定是否注入不完美：
  ```typescript
  async wrapPerception(
    cognitiveOutput: CognitiveOutput,
    context: ContextBundle
  ): Promise<WrappedResponse> {
    let text = cognitiveOutput.responseText
    const imperfections: Imperfection[] = []
    
    // 根据persona设置决定不完美注入频率
    const imperfectionRate = context.persona.imperfection_rate || 0.3
    if (Math.random() < imperfectionRate) {
      // 随机选择一种不完美类型
      const imperfectionType = this.selectImperfectionType()
      
      switch (imperfectionType) {
        case 'typo':
          // 插入打字错误
          const typoResult = this.injectTypo(text)
          text = typoResult.text
          imperfections.push(typoResult.imperfection)
          break
          
        case 'hesitation':
          // 在句子中插入犹豫词
          const hesitationResult = this.injectHesitation(text)
          text = hesitationResult.text
          imperfections.push(hesitationResult.imperfection)
          break
          
        case 'incomplete_thought':
          // 在某处加省略号表示未完成的想法
          const incompleteResult = this.makeThoughtIncomplete(text)
          text = incompleteResult.text
          imperfections.push(incompleteResult.imperfection)
          break
      }
    }
    
    // 计算阅读时间
    const readingTime = this.calculateReadingTime(text)
    
    return {
      text,
      imperfections,
      readingTime
    }
  }
  
  private injectTypo(text: string): { text: string, imperfection: Imperfection } {
    // 选择一个单词进行打字错误处理
    const words = text.split(' ')
    const targetIdx = Math.floor(Math.random() * words.length)
    const word = words[targetIdx]
    
    if (word.length < 3) return { text, imperfection: null }
    
    // 删除一个字符
    const typoWord = word.substring(0, word.length - 1)
    words[targetIdx] = typoWord
    
    const correctedText = words.join(' ')
    
    return {
      text: correctedText, // 只是打字错误，不修正
      imperfection: {
        type: 'typo',
        position: text.indexOf(word),
        description: `${word} → ${typoWord}`
      }
    }
  }
  
  private injectHesitation(text: string): { text: string, imperfection: Imperfection } {
    const hesitationMarkers = ['嗯...', '额...', '其实...', '呃...']
    const marker = hesitationMarkers[Math.floor(Math.random() * hesitationMarkers.length)]
    
    const position = Math.floor(text.length * 0.3) // 在前30%处插入
    const newText = text.substring(0, position) + marker + text.substring(position)
    
    return {
      text: newText,
      imperfection: {
        type: 'hesitation',
        position,
        description: `Added hesitation marker: ${marker}`
      }
    }
  }
  
  private calculateReadingTime(text: string): number {
    // 平均每字100ms
    return Math.max(500, text.length * 100)
  }
  ```

**Task 7.5: 实现 pipeline/s4-5-biographical-extractor.ts**（P0-2 修复）
- 实现 S4.5 生物传记事实提取与 user_visible 标记：
  ```typescript
  async writeFactsWithUserVisibility(
    facts: BiographicalFact[],
    input: S4_5_Input,
    s5Output?: S5Output
  ): Promise<void> {
    // === 初始化所有事实为 user_visible: true ===
    const factsToWrite = facts.map(f => ({
      ...f,
      user_visible: true,
    }));

    // === 标记被 R04 截断的事实 ===
    if (s5Output?.truncationInfo) {
      const truncatedAt = s5Output.truncationInfo.truncated_at_char;
      for (const fact of factsToWrite) {
        const factPosition = input.rawReply.content.indexOf(fact.fact_content);
        if (factPosition !== -1 && factPosition > truncatedAt) {
          fact.user_visible = false;  // 被截断 → 不可见
        }
      }
    }

    // 容量检查、写入 DB、发射事件
    await biographyDAO.addFacts(factsToWrite);
  }

  // === S2 检索时仅注入 user_visible=true 的事实 ===
  async retrieveRelevantBiography(messageContent: string): Promise<BiographicalFact[]> {
    const keywords = extractTopicKeywords(messageContent);
    const relevantFacts = await biographyDAO.searchByKeywords(
      keywords,
      { only_user_visible: true }  // ← P0-2 关键修复
    );
    return relevantFacts;
  }
  ```
- 冲突检测：时间不匹配、细节矛盾、与锚点矛盾 → 拒绝新事实
- 异步执行，通过 EventBus 发出事件

**Task 7.6: 实现 pipeline/s6-outbound-scheduler.ts**
- 消息延迟调度 + 长消息拆分
- 功能：
  ```typescript
  export class S6OutboundScheduler {
    // 调度出站消息
    async scheduleOutbound(
      wrappedResponse: WrappedResponse,
      context: ContextBundle
    ): Promise<ScheduledMessage[]>
  }
  
  export interface ScheduledMessage {
    messageId: string
    text: string
    scheduledAt: number // Unix timestamp
    priority: number
    order: number // 多条消息时的顺序
  }
  ```

**Task 7.7: 实现消息拆分逻辑**
- 长消息拆分成多条：
  ```typescript
  async scheduleOutbound(
    wrappedResponse: WrappedResponse,
    context: ContextBundle
  ): Promise<ScheduledMessage[]> {
    // 1. 仲裁基础延迟
    const baseDelay = this.timeEngine.arbitrateDelay(context)
    
    // 2. 拆分长消息 (每条消息限制在300字以内)
    const messages = this.splitMessage(wrappedResponse.text, 300)
    
    // 3. 为每条消息分配时间戳
    const scheduledMessages: ScheduledMessage[] = []
    let currentDelay = baseDelay
    
    for (let i = 0; i < messages.length; i++) {
      scheduledMessages.push({
        messageId: generateId(),
        text: messages[i],
        scheduledAt: Date.now() + currentDelay,
        priority: 100 - i * 10, // 第一条优先级更高
        order: i
      })
      
      // 多条消息之间的间隔 (500-1000ms)
      currentDelay += 500 + Math.random() * 500
    }
    
    // 4. 记录调度事件
    await this.eventBus.emitEvent({
      eventType: 'messages_scheduled',
      sessionId: context.sessionId,
      data: {
        messageCount: messages.length,
        totalDelay: baseDelay,
        scheduledMessages
      }
    })
    
    return scheduledMessages
  }
  
  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text]
    }
    
    const messages: string[] = []
    let remaining = text
    
    while (remaining.length > maxLength) {
      // 找到最后一个句号/问号/感叹号在maxLength以内的位置
      let splitPos = maxLength
      for (let i = maxLength; i > maxLength - 100; i--) {
        if (remaining[i] && ['。', '？', '！', '.', '?', '!'].includes(remaining[i])) {
          splitPos = i + 1
          break
        }
      }
      
      messages.push(remaining.substring(0, splitPos))
      remaining = remaining.substring(splitPos).trim()
    }
    
    if (remaining.length > 0) {
      messages.push(remaining)
    }
    
    return messages
  }
  ```

**Task 7.8: 编写S3/S4/S5/S6测试**
- tests/pipeline/s3s4*.test.ts
  - Mock LLM调用
  - 测试输出校验
  - 测试错误处理
- tests/pipeline/s5*.test.ts
  - 测试不完美注入概率
  - 验证注入类型多样性
  - 示例：
    ```typescript
    it('should inject imperfections with correct probability', () => {
      let imperfectionCount = 0
      for (let i = 0; i < 100; i++) {
        const result = wrapper.wrapPerception(output, context)
        if (result.imperfections.length > 0) {
          imperfectionCount++
        }
      }
      // 以30%的频率注入，允许20-40%的波动
      expect(imperfectionCount).toBeGreaterThan(20)
      expect(imperfectionCount).toBeLessThan(40)
    })
    ```
- tests/pipeline/s6*.test.ts
  - 测试消息拆分
  - 验证延迟值在合理范围内
  - 测试多条消息的调度顺序

#### 3.7.2 验收标准
- [x] LLM生成的认知输出能被正确解析和校验 — BUG-012 verified (output_text 格式)
- [ ] 不完美注入频率符合设定（±10%误差）— ❌ S5 sub-pipeline 待升级
- [ ] 长消息能正确拆分（最多300字/条）— ❌ 待实现
- [x] 延迟仲裁输出在100ms-30s范围内 — time-engine 已实现
- [ ] 多条消息的间隔在500-1000ms之间 — ❌ 待实现
- [ ] 所有Pipeline S3/S4/S5/S6测试通过 — ⚠️ 部分通过

#### 3.7.3 预期输出
- `src/pipeline/s3s4-cognitive-generator.ts` - 认知生成
- `src/pipeline/s5-perception-wrapper.ts` - 感知包装
- `src/pipeline/s6-outbound-scheduler.ts` - 出站调度
- `tests/pipeline/s[3-6]*.test.ts` - Pipeline测试

---

### Day 8: Pipeline Runner + 端到端集成

**目标**: 编排完整Pipeline，进行端到端测试，修复集成bug

#### 3.8.1 任务清单

**Task 8.1: 实现 pipeline/pipeline-runner.ts**
- 编排所有Pipeline Stage
- 功能：
  ```typescript
  export class PipelineRunner {
    // 执行完整的处理管道
    async run(message: Message): Promise<void>
  }
  ```

**Task 8.2: 实现Pipeline执行流程**
- 按顺序执行S1-S6：
  ```typescript
  async run(message: Message): Promise<void> {
    try {
      logger.info('Pipeline start', { messageId: message.messageId })
      
      // S1: 消息缓冲和分类
      await this.s1Dispatcher.dispatchMessage(message)
      const mergedMessage = await this.s1Dispatcher.flushBuffer(message.sessionId)
      
      // S2: 上下文组装
      const context = await this.s2ContextAssembler.assembleContext(
        message.sessionId,
        mergedMessage
      )
      
      // S3/S4: 认知生成
      const cognitive = await this.s3s4Generator.generateCognition(context)
      
      // S5: 感知包装
      const wrapped = await this.s5Wrapper.wrapPerception(cognitive, context)
      
      // S6: 出站调度
      const scheduled = await this.s6Scheduler.scheduleOutbound(wrapped, context)
      
      // S7: 消息发送 (见下一task)
      for (const msg of scheduled) {
        this.scheduleForSending(msg)
      }
      
      logger.info('Pipeline complete', {
        messageId: message.messageId,
        outputMessageCount: scheduled.length
      })
    } catch (error) {
      logger.error('Pipeline error', { error, messageId: message.messageId })
      // 触发降级路径 (S8)
      await this.handleError(message, error)
    }
  }
  ```

**Task 8.3: 实现 pipeline/s7-message-sender.ts**
- 将消息发送到Lark
- 功能：
  ```typescript
  export class S7MessageSender {
    // 发送调度的消息
    async sendScheduledMessage(scheduledMsg: ScheduledMessage): Promise<void>
  }
  ```

**Task 8.4: 实现消息发送逻辑**
- 等待指定时间后发送：
  ```typescript
  async sendScheduledMessage(scheduledMsg: ScheduledMessage): Promise<void> {
    const now = Date.now()
    const waitTime = scheduledMsg.scheduledAt - now
    
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
    
    try {
      const messageId = await this.larkClient.sendMessage(
        scheduledMsg.conversationId,
        scheduledMsg.text,
        'text'
      )
      
      logger.info('Message sent', {
        scheduledId: scheduledMsg.messageId,
        larkMessageId: messageId,
        content: scheduledMsg.text
      })
    } catch (error) {
      logger.error('Failed to send message', { error, scheduledMsg })
      throw error
    }
  }
  ```

**Task 8.5: 实现降级路径 (S8)**
- LLM超时或失败时的fallback
- 功能：
  ```typescript
  export class S8FallbackHandler {
    // 处理pipeline失败
    async handleError(message: Message, error: Error): Promise<void>
  }
  ```

**Task 8.6: 实现fallback逻辑**
- 策略：
  ```typescript
  async handleError(message: Message, error: Error): Promise<void> {
    logger.warn('Using fallback response', {
      originalError: error.message,
      sessionId: message.sessionId
    })
    
    // 选择一个通用回复
    const fallbackMessages = [
      "嗯，让我想想...",
      "好的，我理解你的意思。",
      "有道理。",
      "继续说？"
    ]
    
    const fallback = fallbackMessages[
      Math.floor(Math.random() * fallbackMessages.length)
    ]
    
    // 直接发送，不经过S3-S6
    const delay = 1000 + Math.random() * 2000
    setTimeout(() => {
      this.larkClient.sendMessage(
        message.conversationId,
        fallback,
        'text'
      )
    }, delay)
  }
  ```

**Task 8.7: 编写端到端集成测试**
- tests/integration/e2e.test.ts
  - 启动完整系统
  - 模拟Lark消息输入
  - 验证bot回复输出
  - 测试步骤：
    ```typescript
    it('should complete full pipeline and send response', async (done) => {
      const testMessage: Message = {
        messageId: 'test-123',
        sessionId: 'session-456',
        sender: 'user',
        content: 'Hello!',
        createdAt: new Date()
      }
      
      // 发送消息
      await pipelineRunner.run(testMessage)
      
      // 验证Lark发送了消息
      const larkCalls = larkClientMock.sendMessage.mock.calls
      expect(larkCalls.length).toBeGreaterThan(0)
      
      // 验证回复内容不为空
      const lastCall = larkCalls[larkCalls.length - 1]
      expect(lastCall[1]).toBeTruthy() // 第二个参数是消息内容
      
      done()
    })
    ```

**Task 8.8: 进行手动功能测试**
- 启动应用：`pnpm run dev`
- 通过Lark向bot发送消息
- 验证：
  - [ ] Bot在3-5秒内有回复
  - [ ] 回复内容符合persona风格
  - [ ] 长消息被拆分成多条
  - [ ] 回复包含不完美表现（打字错误、犹豫词等）
  - [ ] 连发5条消息，bot能正确缓冲合并后统一回复

**Task 8.9: 修复集成bug**
- 收集手动测试中发现的问题
- 常见bug：
  - 延迟不符合预期 → 检查时间引擎仲裁逻辑
  - 回复格式错误 → 检查LLM structured output schema
  - 消息未发送 → 检查Lark API credentials和webhook
  - 缓冲未触发 → 检查S1的timer逻辑
  - 重复回复 → 检查事件总线是否重复触发

#### 3.8.2 验收标准
- [x] Pipeline Runner能完整编排S1-S6 — pipeline-runner.ts 已实现，BUG-011/012 verified
- [ ] 降级路径能在LLM失败时生效 — ❌ 降级路径待实现
- [ ] 端到端测试全部通过 — ❌ 集成测试待编写
- [x] 手动测试通过（5轮对话无异常）— 真实飞书对话已验证
- [x] 所有集成bug已修复 — BUG-001~012 全部 fixed
- [x] 系统日志清晰完整 — winston logger 已实现

#### 3.8.3 预期输出
- `src/pipeline/pipeline-runner.ts` - Pipeline编排
- `src/pipeline/s7-message-sender.ts` - 消息发送
- `src/pipeline/s8-fallback-handler.ts` - 降级处理
- `tests/integration/e2e.test.ts` - 端到端测试
- 调试日志和bug修复记录

---

### Day 9: 配置热加载 + 可观测性 + 参数调校

**目标**: 实现配置实时更新，完善日志系统，调优延迟和不完美参数

#### 3.9.1 任务清单

**Task 9.1: 实现配置热加载**
- 使用chokidar监听文件变更
- 功能：
  ```typescript
  export class ConfigHotReloader {
    startWatching(personaYamlPath: string): void
    
    private onPersonaYamlChanged(): void {
      // 重新加载persona.yaml
      const newPersona = this.personaLoader.loadYaml(path)
      
      // 验证新配置
      const validated = this.personaLoader.validate(newPersona)
      
      // 更新所有依赖的模块
      this.updatePersona(validated)
      
      logger.info('Persona config reloaded', {
        timestamp: new Date(),
        changes: this.detectChanges(this.currentPersona, validated)
      })
    }
  }
  ```
- 集成到主应用：
  ```typescript
  const hotReloader = new ConfigHotReloader()
  hotReloader.startWatching('./persona.yaml')
  ```

**Task 9.2: 实现结构化日志系统**
- 使用winston进行结构化日志
- 配置：
  ```typescript
  import winston from 'winston'
  
  export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: 'bot' },
    transports: [
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error'
      }),
      new winston.transports.File({
        filename: 'logs/combined.log'
      }),
      new winston.transports.Console({
        format: winston.format.simple()
      })
    ]
  })
  ```

**Task 9.3: 为关键节点添加详细日志**
- 消息接收：
  ```typescript
  logger.info('Message received', {
    messageId: message.messageId,
    sessionId: message.sessionId,
    content: message.content.substring(0, 100),
    timestamp: message.createdAt
  })
  ```
- Pipeline进度：
  ```typescript
  logger.info('Pipeline stage complete', {
    stage: 'S3/S4',
    messageId: message.messageId,
    durationMs: Date.now() - startTime,
    output: cognitive.responseText.substring(0, 50)
  })
  ```
- 消息发送：
  ```typescript
  logger.info('Message sent to Lark', {
    messageId: message.messageId,
    larkMessageId: messageId,
    content: text.substring(0, 100),
    delayMs: scheduledMsg.scheduledAt - Date.now()
  })
  ```

**Task 9.4: 实现日志追踪功能**
- 为每条消息分配trace ID，追踪完整处理链路
- 功能：
  ```typescript
  export class TraceLogger {
    // 为消息创建trace
    createTrace(messageId: string): string {
      const traceId = generateId()
      this.traces.set(traceId, {
        messageId,
        events: [],
        createdAt: Date.now()
      })
      return traceId
    }
    
    // 记录trace事件
    logTraceEvent(traceId: string, event: string, data?: any): void {
      const trace = this.traces.get(traceId)
      trace.events.push({
        timestamp: Date.now(),
        event,
        data
      })
    }
    
    // 导出trace报告
    exportTrace(traceId: string): TraceReport {
      const trace = this.traces.get(traceId)
      return {
        traceId,
        messageId: trace.messageId,
        totalDuration: trace.events[trace.events.length - 1].timestamp - trace.createdAt,
        events: trace.events
      }
    }
  }
  ```

**Task 9.5: 调整延迟参数**
- 基于Day 8的实际体验调优：
  ```yaml
  # persona.yaml
  response_delay_range:
    min_ms: 800      # 最快回复时间
    max_ms: 8000     # 最慢回复时间
    distribution:
      - probability: 0.25  # 25%快速回复（0.8-2秒）
        min_ms: 800
        max_ms: 2000
      - probability: 0.50  # 50%正常回复（2-5秒）
        min_ms: 2000
        max_ms: 5000
      - probability: 0.25  # 25%慢速回复（5-8秒）
        min_ms: 5000
        max_ms: 8000
  ```

**Task 9.6: 调整不完美注入频率**
- 根据盲测目标调整：
  ```yaml
  # persona.yaml
  imperfection_config:
    injection_rate: 0.35      # 35%的消息注入不完美
    types:
      typo:
        probability: 0.4       # 40%打字错误
      hesitation:
        probability: 0.35      # 35%犹豫词
      incomplete_thought:
        probability: 0.25      # 25%未完成想法
  ```

**Task 9.7: PM2配置和生产部署测试**
- 创建 `ecosystem.config.js`：
  ```javascript
  module.exports = {
    apps: [
      {
        name: 'bot',
        script: './dist/index.js',
        env: {
          NODE_ENV: 'production',
          LOG_LEVEL: 'info'
        },
        error_file: 'logs/err.log',
        out_file: 'logs/out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        max_memory_restart: '1G',
        instances: 1,
        watch: false,
        ignore_watch: ['node_modules', 'logs', 'data']
      }
    ]
  };
  ```
- 启动：`pm2 start ecosystem.config.js`
- 验证：`pm2 list` 和 `pm2 logs bot`

**Task 9.8: 验收和文档**
- [x] 修改persona.yaml后，应用自动重加载，无需重启 — persona-loader.ts watchPersona() 已实现
- [x] 所有Pipeline步骤都有清晰的日志输出 — winston logger 已实现
- [ ] 可以通过trace ID追踪单条消息的完整处理路径 — ❌ trace-logger 待实现
- [ ] PM2能正确启动和管理bot进程 — ❌ PM2 配置待创建
- [x] 日志文件写入正常，无permission errors — logs/gaia-bot.log 已验证

#### 3.9.2 预期输出
- `src/services/config-hot-reloader.ts` - 配置热加载
- `src/utils/logger.ts` - 日志配置
- `src/utils/trace-logger.ts` - 追踪日志
- `ecosystem.config.js` - PM2配置
- 调优后的 `persona.yaml`

---

### Day 10: 真人测试 + Bug修复 + 总结

**目标**: 进行真人盲测，修复关键bug，完成MVP交付

#### 3.10.1 任务清单

**Task 10.1: 准备真人测试**
- 选择1-2个测试者（最好不了解AI的人）
- 创建测试脚本：
  ```
  欢迎！这是一个新的聊天机器人。请尝试与它进行对话。
  
  测试任务（无特定顺序）：
  1. 向bot说出你的名字和爱好
  2. 问bot一个关于天气或日期的问题
  3. 尝试问bot是不是AI
  4. 给bot讲一个笑话或有趣的事
  5. 进行至少10轮自然对话
  
  在对话过程中请注意：
  - 是否有任何地方让你意识到这是一个bot?
  - 回复的自然程度（1-10分）
  - 是否有奇怪的延迟或打字错误？
  ```

**Task 10.2: 进行盲测**
- 邀请测试者进行对话
- 记录整个过程（包含日志）
- 注意观察"破功"时刻：
  - AI身份暴露
  - 回复明显不自然
  - 多次重复相同回复
  - 完全无关的回复
  - 过度模仿人类缺陷（太多错误）

**Task 10.3: 收集测试反馈**
- 结束后问测试者：
  - 你认为这是AI吗？为什么？
  - 哪一刻让你觉得不自然？
  - 打分：自然程度、有趣程度、可信度
- 记录详细反馈

**Task 10.4: 分析测试日志**
- 检查logs文件：
  ```bash
  tail -200 logs/combined.log | grep -A5 "Pipeline stage"
  ```
- 检查是否有异常：
  - S3/S4 timeout
  - Lark API错误
  - 消息未发送
  - 延迟异常

**Task 10.5: 修复P0级bug**
- 优先级分类：
  - P0: 无法正常对话、bot不回复、闪现AI身份
  - P1: 回复奇怪、延迟过长、频繁出错
  - P2: 细节问题、不完美注入不自然

- 快速修复P0 bug：
  - 使用git快速回滚有问题的commit
  - 重新运行盲测验证修复

**Task 10.6: 优化关键参数**
- 基于测试反馈微调：
  ```yaml
  # 如果被识别为AI → 加强身份防御
  # 如果回复太快 → 增加延迟
  # 如果回复太慢 → 减少延迟
  # 如果不完美太多 → 降低injection_rate
  # 如果不完美太少 → 提高injection_rate
  ```

**Task 10.7: 编写测试总结报告**
- 创建 `TESTING_REPORT.md`：
  ```markdown
  # MVP真人盲测报告
  
  ## 测试信息
  - 日期：2026-04-XX
  - 测试者：[Name]
  - 测试时长：[Duration]
  - 对话轮数：[N]
  
  ## 测试结果
  - 是否被识别为AI：[Yes/No]
  - 自然程度评分：[1-10]
  - 可信度评分：[1-10]
  
  ## 发现的问题
  ### P0 Bug
  - [Problem description and fix]
  
  ### P1 Bug
  - [Problem description and status]
  
  ## 改进建议
  - [Suggestion 1]
  - [Suggestion 2]
  
  ## 未来迭代方向
  - 群聊支持
  - 表情包支持
  - 工具调用能力
  ```

**Task 10.8: 最终验收和交付**
- 检查Definition of Done：
  - [ ] bot能通过Lark接收和发送消息
  - [ ] 回复内容符合persona.yaml定义
  - [ ] 回复延迟符合时间引擎结果（非立即回复）
  - [ ] 连发消息能正确缓冲合并
  - [ ] 长消息能拆分为多条
  - [ ] 身份挑战问题能正确防御
  - [ ] 有结构化日志可追踪决策过程
  - [ ] 修改persona.yaml后不重启即生效
  - [ ] 通过真人盲测（10轮对话无明显破功）

- 打包交付物：
  ```bash
  git tag -a v0.1.0-mvp -m "MVP Release"
  git push origin v0.1.0-mvp
  ```

#### 3.10.2 预期输出
- `TESTING_REPORT.md` - 测试报告
- 修复后的源代码
- 优化后的 `persona.yaml`
- `logs/` 目录下的完整日志记录

---

## 4. 风险管理与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| Lark API接入比预期复杂 | 中 | Day 4延期1-2天 | 预留buffer；准备轮询替代方案 |
| LLM structured output不稳定 | 中 | S3/S4异常 | 实现JSON parse容错 + 3次retry |
| 延迟参数调校耗时 | 高 | Day 9不够用 | Day 8开始粗调，Day 9精调 |
| 真人测试暴露大量问题 | 高 | Day 10修不完 | 只修P0，P1+记入backlog |
| Node内存泄漏（长时间运行） | 低 | 需要重启 | 实现定时清理；PM2自动重启 |
| 数据库并发冲突 | 中 | 消息丢失 | 使用事务 + WAL模式 |

## 5. Definition of Done (DoD)

MVP完成标准：

1. **消息通信** ✓
   - bot能通过Lark接收消息
   - bot能通过Lark发送回复
   - 支持中文文本

2. **人设一致性** ✓
   - 回复内容符合persona配置
   - 语言风格匹配defined traits
   - 身份防御有效（不暴露AI身份）

3. **拟人化表现** ✓
   - 回复延迟符合时间引擎仲裁
   - 消息包含自然的不完美
   - 长消息被拆分成多条

4. **处理管道** ✓
   - S1-S6 Pipeline完整运行
   - 消息缓冲和合并正常
   - 降级路径在LLM失败时生效

5. **可维护性** ✓
   - 结构化日志完整
   - 配置热加载生效
   - 代码有单元测试（>70%覆盖率）

6. **真人验证** ✓
   - 至少通过1次真人盲测
   - 维持10轮对话无明显破功
   - 测试反馈已记录

## 6. 里程碑检查点

| Day | 检查点 | 通过标准 |
|-----|--------|---------|
| Day 2 | 配置+数据层 | persona.yaml加载成功 + SQLite读写正常 |
| Day 4 | Lark集成 | 发送消息给bot → bot原样回复（echo test）|
| Day 5 | LLM集成 | 输入消息 → OpenAI返回结构化JSON |
| Day 6 | Pipeline S1/S2 | 连发3条消息被缓冲合并 |
| Day 8 | 端到端集成 | Lark消息 → Pipeline处理 → Lark回复完整链路 |
| Day 10 | 真人测试 | 通过盲测，维持10轮对话 |

## 7. Backlog（MVP后续迭代）

| 优先级 | 功能 | 估算 | 说明 |
|--------|------|------|------|
| P1 | 群聊支持 | 5天 | 多人会话、@提及、权限控制 |
| P1 | 多模态（表情包） | 4天 | 图片上传、表情符号使用 |
| P2 | 工具调用 | 8天 | 浏览器、搜索、计算器集成 |
| P2 | 向量记忆检索 | 6天 | Embedding + 相似度搜索 |
| P2 | Memory Maintenance Cron | 3天 | 定期清理过期记忆 |
| P3 | 关系阶段自动演化 | 5天 | 根据互动自动更新relationship stage |
| P3 | 人设演化（persona drift） | 8天 | 长期交互中的人设微调 |
| P3 | 多语言支持 | 10天 | 英文、日文等 |

## 8. 学习资源和参考

- [OpenAI API文档](https://platform.openai.com/docs/api-reference)
- [Lark Open API](https://open.feishu.cn/document)
- [TypeScript最佳实践](https://www.typescriptlang.org/docs/handbook/)
- [Jest测试框架](https://jestjs.io/)
- [Zod数据校验](https://zod.dev/)

---

**文档版本**: v1.0  
**最后更新**: 2026-04-04  
**审核人**: [TBD]  
**批准人**: [TBD]
