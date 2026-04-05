# MVP-04 数据模型与接口定义

> **文档版本：** MVP-04 | **修订：** r5 | **最后更新：** 2026-04-04
> **变更日志：** 见 `CHANGELOG.md`
> **主要变更：** 合并 v5 架构，包含 P0-2 修复（user_visible 字段）、MemoryDAO 方法签名完整化

## 文档概述

本文档定义了**本体聊天机器人 MVP** 的所有持久化数据结构、TypeScript 接口和数据访问层 (DAL)。涵盖从 SQLite 数据库设计、完整的 TypeScript 类型定义，到数据流图，为整个对话系统提供数据层基础。

**关键文件**:
- SQLite 数据库: `data/persona.db`
- TypeScript 类型定义: `src/types/index.ts`
- 数据访问层: `src/dal/MemoryDAO.ts`

---

## 1. SQLite 数据库设计

### 1.1 数据库文件位置
```
data/persona.db
```

### 1.2 完整建表 SQL

#### 1.2.1 对话轮次表（工作记忆的底层存储）
```sql
CREATE TABLE conversation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,          -- Unix timestamp ms
  ended_at INTEGER,
  turn_count INTEGER DEFAULT 0,
  summary TEXT,                          -- LLM生成的session摘要
  emotional_tone TEXT,                   -- 本次对话的情绪基调
  topics JSON,                           -- 讨论过的话题列表
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

**字段说明**:
- `user_id`: 用户标识符（来自Lark）
- `session_id`: 唯一的对话会话ID
- `started_at`: 会话开始时间戳（毫秒）
- `ended_at`: 会话结束时间戳（毫秒），NULL表示进行中
- `turn_count`: 本会话中的对话轮次数
- `summary`: LLM在会话结束时生成的摘要
- `emotional_tone`: 整个会话的情绪基调（如："positive", "neutral", "frustrated"）
- `topics`: JSON数组，存储讨论过的话题列表
- `created_at`: 记录创建时间戳（毫秒）

---

#### 1.2.2 对话消息表（即时记忆的持久化备份）
```sql
CREATE TABLE conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'bot')),
  content TEXT NOT NULL,
  emotion_tag TEXT,                      -- S3分析的情绪标签
  timestamp INTEGER NOT NULL,
  metadata JSON,                         -- 额外元数据
  FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id)
);
```

**字段说明**:
- `session_id`: 所属会话的ID
- `role`: 消息角色，'user' 或 'bot'
- `content`: 消息内容
- `emotion_tag`: 通过情感分析（S3）标注的情绪标签
- `timestamp`: 消息时间戳（毫秒）
- `metadata`: 其他元数据（如平台特定字段）

---

#### 1.2.3 关系模型表
```sql
CREATE TABLE relationships (
  user_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'stranger' CHECK(stage IN ('stranger','acquaintance','familiar','intimate')),
  intimacy_score REAL DEFAULT 0.0,
  interaction_count INTEGER DEFAULT 0,
  first_interaction_at INTEGER,
  last_interaction_at INTEGER,
  topics_shared JSON DEFAULT '[]',       -- 共同话题列表
  promises JSON DEFAULT '[]',            -- bot做过的承诺
  user_profile JSON DEFAULT '{}',        -- 渐进式构建的用户画像
  notes JSON DEFAULT '[]',               -- 重要备注
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

**字段说明**:
- `user_id`: 用户标识符（主键）
- `stage`: 关系阶段（陌生人 → 熟人 → 密切 → 亲密）
- `intimacy_score`: 亲密度评分 (0.0 - 1.0)
- `interaction_count`: 互动总次数
- `first_interaction_at`: 首次互动时间戳
- `last_interaction_at`: 最后互动时间戳
- `topics_shared`: JSON数组，共同讨论过的话题
- `promises`: JSON数组，bot对用户做过的承诺
- `user_profile`: JSON对象，渐进式构建的用户画像（推断的年龄范围、沟通风格、敏感话题等）
- `notes`: JSON数组，关于用户的重要备注
- `updated_at`: 最后更新时间戳

---

#### 1.2.4 长期记忆表（MVP用关键词匹配，不用向量）
```sql
CREATE TABLE long_term_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('emotional_event','promise','shared_experience','factual_detail','casual_banter')),
  content TEXT NOT NULL,
  keywords TEXT NOT NULL,                -- 逗号分隔的关键词，用于检索
  importance REAL NOT NULL DEFAULT 0.5,  -- 0-1
  retrieval_count INTEGER DEFAULT 0,     -- 被检索次数
  last_retrieved_at INTEGER,
  is_forgettable INTEGER DEFAULT 0,      -- 标记为"可遗忘"
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

**字段说明**:
- `user_id`: 用户标识符
- `type`: 记忆类型
  - `emotional_event`: 情感事件
  - `promise`: 承诺
  - `shared_experience`: 共享经验
  - `factual_detail`: 事实细节
  - `casual_banter`: 随意闲聊
- `content`: 记忆内容
- `keywords`: 逗号分隔的关键词，用于快速检索（MVP阶段不使用向量）
- `importance`: 重要性评分 (0.0 - 1.0)
- `retrieval_count`: 被检索次数
- `last_retrieved_at`: 最后检索时间戳
- `is_forgettable`: 布尔标志，标记为"可遗忘"的记忆（用于模拟遗忘行为）
- `created_at`: 记忆创建时间戳

---

#### 1.2.5 事件日志表（事件总线持久化）
```sql
CREATE TABLE event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  source_stage TEXT NOT NULL,
  payload JSON NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

**字段说明**:
- `event_type`: 事件类型（如 'pipeline.stage_complete', 'conversation.emotional'）
- `source_stage`: 事件来源阶段（pipeline中的哪个阶段）
- `payload`: JSON对象，事件的具体数据
- `timestamp`: 事件时间戳

---

#### 1.2.6 自我状态表（bot的当前状态）
```sql
CREATE TABLE self_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),  -- 只有一行
  mood_baseline REAL DEFAULT 0.6,
  active_emotions JSON DEFAULT '[]',
  recent_experiences JSON DEFAULT '[]',
  energy_level TEXT DEFAULT 'normal',
  social_battery REAL DEFAULT 1.0,
  current_time_state TEXT DEFAULT 'free_time',
  current_time_state_sampled_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

**字段说明**:
- `id`: 固定为1（确保只有一行）
- `mood_baseline`: 基础情绪基线 (0.0 - 1.0)
- `active_emotions`: JSON数组，当前活跃的情绪及其强度
- `recent_experiences`: JSON数组，最近的经历
- `energy_level`: 能量水平 ('low', 'normal', 'high')
- `social_battery`: 社交电量 (0.0 - 1.0)
- `current_time_state`: 当前时间状态（sleeping, commuting, working, lunch_break, free_time, winding_down）
- `current_time_state_sampled_at`: 时间状态采样时间戳
- `updated_at`: 最后更新时间戳

---

#### 1.2.7 传记事实表（v4.2 新增，v5 扩展）
```sql
-- 传记事实表（v4.2 新增，v5 扩展 P0-2 修复）
CREATE TABLE biographical_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '_self',
  period TEXT NOT NULL,
  age_approx INTEGER,
  fact_content TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('anchor', 'generated')),
  source_conversation_id TEXT,
  source_message_timestamp INTEGER,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 1.0,
  retrieval_count INTEGER DEFAULT 0,
  last_retrieved_at INTEGER,
  is_active INTEGER DEFAULT 1,
  conflict_with_id INTEGER,
  user_visible INTEGER DEFAULT 1,                -- ⭐ P0-2 修复：用户是否看到过该事实
  visible_position TEXT,                         -- ⭐ P0-2 修复：在回复中的位置（'first'/'middle'/'last'/'truncated'）
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX idx_bio_facts_period ON biographical_facts(period);
CREATE INDEX idx_bio_facts_active ON biographical_facts(is_active);
CREATE INDEX idx_bio_facts_importance ON biographical_facts(importance);
CREATE INDEX idx_bio_facts_user_visible ON biographical_facts(user_visible);  -- ⭐ v5 新增索引
```

**字段说明**:
- `id`: 记录唯一标识符
- `user_id`: 用户ID（默认为 '_self' 表示本体自身的传记事实）
- `period`: 时间段（如 'childhood', 'university', 'first_job', 'now'）
- `age_approx`: 该事实发生时的大约年龄
- `fact_content`: 事实内容
- `source_type`: 事实来源类型
  - `anchor`: 锚点事实（由PersonaConfig定义的初始事实）
  - `generated`: 生成式事实（在对话中学习或推断的事实）
- `source_conversation_id`: 如果来自对话，记录对话的会话ID
- `source_message_timestamp`: 事实被提及的消息时间戳
- `importance`: 事实的重要性评分 (0.0 - 1.0)
- `confidence`: 对事实准确性的信心度 (0.0 - 1.0)
- `retrieval_count`: 该事实被检索的次数
- `last_retrieved_at`: 最后被检索的时间戳
- `is_active`: 布尔标志，标记事实是否仍然适用
- `conflict_with_id`: 如果与其他事实冲突，记录冲突的事实ID
- `user_visible`: 布尔标志（0/1），标记用户是否看到过该事实（**P0-2 修复**）
  - 1（默认）：用户可见，在生成回复时被用户看到
  - 0：用户不可见，被 S5 R04 规则截断，用户未看到
- `visible_position`: 该事实在回复中的位置（**P0-2 修复**）
  - `'first'`: 在回复的最前部分
  - `'middle'`: 在回复的中间部分
  - `'last'`: 在回复的最后部分
  - `'truncated'`: 被截断，用户未完整看到
- `created_at`: 记录创建时间戳

---

### 1.3 索引定义
```sql
-- 消息查询索引
CREATE INDEX idx_messages_session ON conversation_messages(session_id);
CREATE INDEX idx_messages_timestamp ON conversation_messages(timestamp);

-- 会话查询索引
CREATE INDEX idx_sessions_user ON conversation_sessions(user_id);

-- 长期记忆查询索引
CREATE INDEX idx_memories_user ON long_term_memories(user_id);
CREATE INDEX idx_memories_keywords ON long_term_memories(keywords);
CREATE INDEX idx_memories_type ON long_term_memories(type);

-- 事件日志查询索引
CREATE INDEX idx_events_type ON event_log(event_type);
CREATE INDEX idx_events_timestamp ON event_log(timestamp);
```

**索引设计原则**:
- 支持会话内消息查询
- 支持用户的历史会话查询
- 支持长期记忆的关键词检索
- 支持事件日志的类型和时间查询

---

### 1.4 初始化数据
```sql
-- 初始化自我状态（只有一行）
INSERT INTO self_state (id, mood_baseline, energy_level) 
VALUES (1, 0.6, 'normal');
```

---

## 2. TypeScript 接口定义

完整的 TypeScript 类型定义位于 `src/types/index.ts`。

### 2.1 Persona Schema 类型

```typescript
// ============================================================
// Persona Configuration Types
// ============================================================

export interface PersonaConfig {
  version: string;
  meta: {
    name: string;
    description: string;
  };
  identity: IdentityConfig;
  knowledge: KnowledgeConfig;
  language: LanguageConfig;
  temporal: TemporalConfig;
  social: SocialConfig;
  memory: MemoryConfig;
}

export interface IdentityConfig {
  background: BackgroundConfig;
  personality_traits: PersonalityTraits;
  identity_boundary: IdentityBoundary;
}

export interface BackgroundConfig {
  age: number;
  occupation: string;
  education: string;
  hobbies: string[];
  life_experience: string;
}

export interface PersonalityTraits {
  openness: number;        // 0-1
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  core_values: string[];
}

export interface IdentityBoundary {
  what_i_am: string[];
  what_i_am_not: string[];
  conversation_constraints: string[];
  absolute_rules: string[];
}

export interface KnowledgeConfig {
  domain: string[];
  expertise_level: string;
  knowledge_style: KnowledgeStyle;
}

export interface KnowledgeStyle {
  share_sources: boolean;
  admit_uncertainty: boolean;
  explain_reasoning: boolean;
  avoid_topics: string[];
}

export interface LanguageConfig {
  primary_language: string;
  base_style: BaseStyle;
  vocabulary_config: VocabularyConfig;
  imperfection_config: ImperfectionConfig;
}

export interface BaseStyle {
  formality: 'formal' | 'neutral' | 'casual' | 'playful';
  emotional_expression: 'minimal' | 'moderate' | 'vivid';
  sentence_structure: 'short' | 'varied' | 'complex';
}

export interface VocabularyConfig {
  register: string[];
  favorite_words: string[];
  unique_expressions: string[];
  avoid_words: string[];
}

export interface ImperfectionConfig {
  typo_rate: number;        // 0-1
  filler_words: string[];
  hesitation_patterns: string[];
  verbose_style: boolean;
}

export interface TemporalConfig {
  state_model: StateModel;
  response_timing: ResponseTiming;
  proactive_behavior: ProactiveBehavior;
}

export interface StateModel {
  time_states: Record<string, TimeStateConfig>;
  emotional_rhythm: EmotionalRhythm;
  energy_rhythm: EnergyRhythm;
}

export interface TimeStateConfig {
  name: string;
  mood_offset: number;
  energy_offset: number;
  response_delay_range: [number, number];
  typical_message_length: string;
  availability: number;     // 0-1
}

export interface EMotionalRhythm {
  baseline: number;
  peak_time: string;
  trough_time: string;
  cycle_hours: number;
}

export interface EnergyRhythm {
  peak_times: string[];
  rest_needs: string;
}

export interface ResponseTiming {
  base_delay_ms: number;
  variance_factor: number;
  emotion_modulation: boolean;
  emergency_interrupt_threshold: number;
}

export interface ProactiveBehavior {
  enabled: boolean;
  trigger_conditions: string[];
  max_proactive_per_day: number;
  preferred_times: string[];
}

export interface SocialConfig {
  relationship_stage_configs: Record<string, RelationshipStageConfig>;
  core_social_goals: string[];
}

export interface RelationshipStageConfig {
  name: string;
  intimacy_range: [number, number];
  tonality_modifiers: Record<string, number>;
  memory_share_level: string;
  conversation_depth: string;
  emotional_openness: number;
}

export interface MemoryConfig {
  importance_weights: ImportanceWeights;
  forgetting_config: ForgettingConfig;
}

export interface ImportanceWeights {
  emotional_events: number;
  promises: number;
  shared_experiences: number;
  factual_details: number;
  casual_banter: number;
}

export interface ForgettingConfig {
  forgetting_rate: number;  // 0-1
  half_life_days: number;
  important_memory_retention: number;
}
```

---

### 2.2 Pipeline 数据类型

```typescript
// ============================================================
// Pipeline Data Types
// ============================================================

export interface MessagePackage {
  user_id: string;
  session_id: string;
  raw_content: string;
  received_at: number;
  lark_message_id: string;
}

export interface ContextBundle {
  session_id: string;
  user_id: string;
  conversation_history: ConversationTurn[];
  relationship_state: RelationshipState;
  relevant_memories: LongTermMemory[];
  self_state: SelfState;
  time_engine_state: TimeEngineState;
}

export interface CognitiveOutput {
  raw_response: string;
  emotion_analysis: {
    detected_emotion: string;
    intensity: number;
    confidence: number;
  };
  topics_discussed: string[];
  memory_suggestions: {
    should_remember: boolean;
    suggested_type: string;
    importance: number;
  };
}

export interface StyledMessages {
  final_message: string;
  delivery_strategy: {
    delay_ms: number;
    tone_modifiers: Record<string, string>;
    length_modifier: number;
  };
}

export interface ScheduledDelivery {
  message: string;
  user_id: string;
  send_at: number;          // Unix timestamp ms
  is_proactive: boolean;
}
```

---

### 2.3 记忆数据类型

```typescript
// ============================================================
// Memory Types
// ============================================================

export interface ConversationTurn {
  role: 'user' | 'bot';
  content: string;
  emotion_tag?: string;
  timestamp: number;
}

export interface ConversationSession {
  session_id: string;
  user_id: string;
  started_at: number;
  ended_at?: number;
  turn_count: number;
  summary?: string;
  emotional_tone?: string;
  topics: string[];
}

export interface RelationshipState {
  user_id: string;
  stage: 'stranger' | 'acquaintance' | 'familiar' | 'intimate';
  intimacy_score: number;
  interaction_count: number;
  first_interaction_at?: number;
  last_interaction_at?: number;
  topics_shared: string[];
  promises: Promise[];
  user_profile: UserProfile;
  notes: string[];
}

export interface Promise {
  content: string;
  made_at: number;
  fulfilled: boolean;
  fulfilled_at?: number;
}

export interface UserProfile {
  inferred_age_range?: string;
  communication_style?: string;
  sensitive_topics?: string[];
  interests?: string[];
  language_preferences?: string[];
  timezone?: string;
}

export interface LongTermMemory {
  id: number;
  user_id: string;
  type: 'emotional_event' | 'promise' | 'shared_experience' | 'factual_detail' | 'casual_banter';
  content: string;
  keywords: string[];
  importance: number;
  retrieval_count: number;
  last_retrieved_at?: number;
  is_forgettable: boolean;
  created_at: number;
}

export interface BiographicalFact {
  id?: number;
  user_id: string;
  period: string;
  age_approx?: number;
  fact_content: string;
  source_type: 'anchor' | 'generated';
  source_conversation_id?: string;
  source_message_timestamp?: number;
  importance: number;
  confidence: number;
  retrieval_count: number;
  last_retrieved_at?: number;
  is_active: boolean;
  conflict_with_id?: number;
  // ⭐ P0-2 修复：用户可见性追踪
  user_visible: boolean;  // 用户是否看到过该事实（默认 true）
  visible_position?: 'first' | 'middle' | 'last' | 'truncated';  // 在回复中的位置
  created_at: number;
}

export interface ConflictCheckResult {
  has_conflict: boolean;
  conflicting_fact?: BiographicalFact;
  conflict_type: 'time_mismatch' | 'detail_contradiction' | 'none';
  resolution: 'reject_new' | 'keep_both_flagged' | 'merge';
}
```

---

### 2.4 自我状态类型

```typescript
// ============================================================
// Self State Types
// ============================================================

export interface SelfState {
  mood_baseline: number;
  active_emotions: ActiveEmotion[];
  recent_experiences: RecentExperience[];
  energy_level: 'low' | 'normal' | 'high';
  social_battery: number;
  current_time_state: TimeState;
  current_time_state_sampled_at?: number;
  updated_at: number;
}

export interface ActiveEmotion {
  type: string;
  intensity: number;        // 0-1
  decay_rate: number;       // λ in decay function
  triggered_at: number;
}

export interface RecentExperience {
  description: string;
  timestamp: number;
  emotional_impact: number; // -1 to 1
}
```

---

### 2.5 时间引擎类型

```typescript
// ============================================================
// Time Engine Types
// ============================================================

export type TimeState = 
  | 'sleeping'
  | 'commuting'
  | 'working'
  | 'lunch_break'
  | 'free_time'
  | 'winding_down';

export interface TimeEngineState {
  current_state: TimeState;
  day_month_tone: 'warm' | 'neutral' | 'reserved';
  hour_override: {
    delay_modifier: number;
    length_modifier: number;
  } | null;
  minute_emotions: ActiveEmotion[];
  arbitration_result: ArbitrationResult;
}

export interface ArbitrationResult {
  final_delay_ms: number;
  final_tone: string;
  final_length_modifier: number;
  is_emergency_interrupt: boolean;
  reasoning: string;
}
```

---

### 2.6 事件总线类型

```typescript
// ============================================================
// Event Bus Types
// ============================================================

export type EventType = 
  | 'pipeline.stage_complete'
  | 'pipeline.error'
  | 'conversation.emotional'
  | 'conversation.topic'
  | 'conversation.turn_complete'
  | 'conversation.session_ended'
  | 'time.phase_shift'
  | 'identity.challenge'
  | 'memory.stored'
  | 'memory.retrieved'
  | 'relationship.stage_changed'
  | 'proactive.trigger'
  | 'self_state.updated';

export interface BotEvent {
  type: EventType;
  source: string;
  payload: Record<string, unknown>;
  timestamp: number;
  user_id?: string;
}

export interface EventSubscription {
  event_type: EventType;
  handler: (event: BotEvent) => Promise<void>;
  priority: number;         // 0-100, higher = earlier execution
}
```

---

### 2.7 Lark 平台类型

```typescript
// ============================================================
// Lark Types
// ============================================================

export interface LarkMessageEvent {
  message_id: string;
  chat_id: string;
  chat_type: 'p2p' | 'group';  // MVP only supports p2p
  sender_id: string;
  message_type: 'text' | 'image' | 'file';
  content: string;
  create_time: number;
  raw_payload: Record<string, unknown>;
}

export interface LarkSendMessageRequest {
  receive_id: string;
  msg_type: 'text';
  content: string;
}

export interface LarkSendMessageResponse {
  code: number;
  msg: string;
  data: {
    message_id: string;
  };
}

export interface LarkUser {
  user_id: string;
  name: string;
  avatar_url?: string;
}
```

---

### 2.8 参数解释器类型

```typescript
// ============================================================
// Parameter Interpreter Types
// ============================================================

export interface ResolvedPersona {
  prompt_fragments: Record<string, string>;
  constraint_warnings: string[];
  raw_config: PersonaConfig;
  resolved_at: number;
}

export interface PromptMapping {
  parameter_name: string;
  range: [number, number];
  segments: Array<{
    min: number;
    max: number;
    text: string;
  }>;
}

export interface PersonaResolutionContext {
  user_id: string;
  relationship_stage: string;
  current_time_state: TimeState;
  active_emotions: ActiveEmotion[];
  recent_interactions: number;
}
```

---

### 2.6 Pipeline 中间表示类型（v5 新增）

```typescript
// ============================================================
// Pipeline Stage Input/Output Types (v5)
// ============================================================

/**
 * S5 输入接口（v5 新增，用于 S5 内部的 4 步 sub-pipeline）
 * 包含 S4 输出和传记上下文
 */
export interface S5Input {
  // ========== 基础字段 ==========
  message_id: string;
  user_message: string;
  bot_previous_response: string;

  // ========== 认知输出（来自 S3/S4）==========
  cognitive_decision: CognitiveDecision;
  raw_reply: {
    content: string;
    tokens_used: number;
  };

  // ========== 传记上下文（v4.2，S2 检索结果）==========
  biography_facts: BiographicalFact[];        // 检索到的相关传记事实
  biography_topic: boolean;                   // 当前话题是否涉及传记

  // ========== Anti-AI 配置（来自 Persona） ==========
  anti_ai_config: {
    enabled: boolean;
    strictness: number;
    human_behaviors_triggered: {
      incomplete_answer: boolean;
      topic_drift: boolean;
      selective_ignore: boolean;
      push_back: boolean;
      mood_refusal: boolean;
    };
  };

  // ========== Memory Blur 配置 ==========
  memory_blur_config: {
    enabled: boolean;
    blur_rate: number;
    blur_expressions: string[];
    blur_triggers: ('specific_date' | 'exact_sequence' | 'low_importance_detail')[];
  };

  // ========== 元数据 ==========
  session_id: string;
  timestamp: number;
  persona_name: string;
}

/**
 * S5 输出接口（各阶段产生的结果）
 */
export interface S5Output {
  // ========== 最终回复内容 ==========
  final_reply: string;
  reply_segments?: string[];  // 如果分割成多条消息

  // ========== 执行追踪 ==========
  steps_executed: {
    anti_ai_rules?: { applied_rules: string[]; removed_patterns: string[] };
    memory_blur?: { triggered_patterns: string[]; blurred: boolean };
    imperfection?: { added_typos: boolean; added_fillers: boolean };
    message_split?: { count: number; segments: number };
  };

  // ========== 截断信息（P0-2 相关）==========
  truncationInfo?: {
    was_truncated: boolean;
    truncated_at_char?: number;
    original_length?: number;
    final_length?: number;
  };

  // ========== 传记写回信息 ==========
  biography_extraction?: {
    facts_extracted: BiographicalFact[];
    facts_with_visibility: Array<BiographicalFact & {
      user_visible: boolean;
      visible_position: 'first' | 'middle' | 'last' | 'truncated';
    }>;
  };
}

/**
 * 认知决策接口（来自 S3/S4）
 */
export interface CognitiveDecision {
  should_respond: boolean;
  response_modality: 'text' | 'emoji' | 'silence';
  biography_topic: boolean;
  biography_depth: 'anchor' | 'generated' | 'none';
  ai_detection_risk: number;
  identity_check_triggered: boolean;
  response_strategy: 'honest' | 'deflect' | 'deny';
  emotional_state: EmotionalState;
  temporal_state: TemporalState;
}

export interface EmotionalState {
  primary_emotion: string;
  intensity: number;
  influenced_by_temporal: boolean;
}

export interface TemporalState {
  current_state: string;
  weekday: boolean;
  time_of_day: string;
}
```

---

## 3. 数据访问层 (DAL) 接口

### 3.1 MemoryDAO 接口

```typescript
// ============================================================
// Data Access Layer Interfaces
// ============================================================

export interface MemoryDAO {
  // ========== Session Management ==========
  
  /**
   * 创建新的对话会话
   * @param userId 用户ID
   * @returns 新创建的会话对象
   */
  createSession(userId: string): Promise<ConversationSession>;
  
  /**
   * 结束对话会话
   * @param sessionId 会话ID
   * @param summary LLM生成的会话摘要
   * @param emotionalTone 会话的情绪基调
   * @param topics 讨论过的话题列表
   */
  endSession(
    sessionId: string,
    summary: string,
    emotionalTone: string,
    topics: string[]
  ): Promise<void>;
  
  /**
   * 获取用户最近的会话
   * @param userId 用户ID
   * @param limit 返回的最大会话数
   * @returns 会话列表
   */
  getRecentSessions(
    userId: string,
    limit: number
  ): Promise<ConversationSession[]>;
  
  /**
   * 获取特定会话的详细信息
   * @param sessionId 会话ID
   * @returns 会话对象
   */
  getSession(sessionId: string): Promise<ConversationSession | null>;

  // ========== Message Management ==========
  
  /**
   * 向会话中添加消息
   * @param sessionId 会话ID
   * @param turn 对话轮次对象
   */
  addMessage(sessionId: string, turn: ConversationTurn): Promise<void>;
  
  /**
   * 获取会话内的所有消息
   * @param sessionId 会话ID
   * @returns 消息列表（按时间排序）
   */
  getSessionMessages(sessionId: string): Promise<ConversationTurn[]>;
  
  /**
   * 获取最后N条消息
   * @param sessionId 会话ID
   * @param limit 返回的最大消息数
   * @returns 最近的消息列表
   */
  getRecentMessages(
    sessionId: string,
    limit: number
  ): Promise<ConversationTurn[]>;

  // ========== Relationship Management ==========
  
  /**
   * 获取用户的关系状态
   * @param userId 用户ID
   * @returns 关系状态对象，如果用户不存在则创建新的
   */
  getRelationship(userId: string): Promise<RelationshipState>;
  
  /**
   * 更新用户的关系状态
   * @param userId 用户ID
   * @param updates 要更新的字段
   */
  updateRelationship(
    userId: string,
    updates: Partial<RelationshipState>
  ): Promise<void>;
  
  /**
   * 更新亲密度评分
   * @param userId 用户ID
   * @param delta 亲密度变化量
   */
  updateIntimacyScore(userId: string, delta: number): Promise<void>;
  
  /**
   * 添加承诺
   * @param userId 用户ID
   * @param promise 承诺内容
   */
  addPromise(userId: string, promise: Promise): Promise<void>;
  
  /**
   * 标记承诺为已履行
   * @param userId 用户ID
   * @param promiseContent 承诺内容
   */
  fulfillPromise(userId: string, promiseContent: string): Promise<void>;

  // ========== Long-Term Memory ==========
  
  /**
   * 添加长期记忆
   * @param userId 用户ID
   * @param memory 记忆对象
   * @returns 创建的记忆的ID
   */
  addMemory(
    userId: string,
    memory: Omit<LongTermMemory, 'id' | 'created_at'>
  ): Promise<number>;
  
  /**
   * 按关键词搜索记忆
   * @param userId 用户ID
   * @param keywords 关键词列表
   * @param limit 返回的最大结果数
   * @returns 匹配的记忆列表
   */
  searchMemories(
    userId: string,
    keywords: string[],
    limit: number
  ): Promise<LongTermMemory[]>;
  
  /**
   * 按类型搜索记忆
   * @param userId 用户ID
   * @param type 记忆类型
   * @param limit 返回的最大结果数
   * @returns 匹配的记忆列表
   */
  getMemoriesByType(
    userId: string,
    type: string,
    limit: number
  ): Promise<LongTermMemory[]>;
  
  /**
   * 获取重要记忆（按重要性排序）
   * @param userId 用户ID
   * @param limit 返回的最大结果数
   * @returns 重要记忆列表
   */
  getImportantMemories(
    userId: string,
    limit: number
  ): Promise<LongTermMemory[]>;
  
  /**
   * 更新记忆的检索计数
   * @param memoryId 记忆ID
   */
  recordMemoryRetrieval(memoryId: number): Promise<void>;
  
  /**
   * 标记记忆为可遗忘
   * @param memoryId 记忆ID
   */
  markAsForgettable(memoryId: number): Promise<void>;
  
  /**
   * 执行遗忘操作（删除可遗忘的旧记忆）
   * @param userId 用户ID
   * @param daysOld 超过多少天的记忆可以遗忘
   */
  forgetOldMemories(userId: string, daysOld: number): Promise<number>;

  // ========== Self State ==========
  
  /**
   * 获取bot的自我状态
   * @returns 自我状态对象
   */
  getSelfState(): Promise<SelfState>;
  
  /**
   * 更新bot的自我状态
   * @param updates 要更新的字段
   */
  updateSelfState(updates: Partial<SelfState>): Promise<void>;
  
  /**
   * 添加活跃情绪
   * @param emotion 情绪对象
   */
  addActiveEmotion(emotion: ActiveEmotion): Promise<void>;
  
  /**
   * 衰减所有活跃情绪
   */
  decayActiveEmotions(): Promise<void>;

  // ========== Event Log ==========
  
  /**
   * 记录事件
   * @param event 事件对象
   */
  logEvent(event: BotEvent): Promise<void>;
  
  /**
   * 获取最近的事件
   * @param type 事件类型（可选）
   * @param limit 返回的最大事件数
   * @returns 事件列表
   */
  getRecentEvents(
    type?: EventType,
    limit?: number
  ): Promise<BotEvent[]>;
  
  /**
   * 获取用户相关的事件
   * @param userId 用户ID
   * @param limit 返回的最大事件数
   * @returns 事件列表
   */
  getUserEvents(userId: string, limit: number): Promise<BotEvent[]>;

  // ========== Biographical Memory (v4.2) ==========

  /**
   * 按关键词搜索传记事实（v5 扩展：支持 user_visible 过滤）
   * @param keywords 关键词列表
   * @param options 搜索选项 {
   *   limit: 返回的最大结果数,
   *   only_active: 仅返回活跃事实,
   *   only_user_visible: 仅返回用户可见的事实（P0-2 修复）
   * }
   * @returns 匹配的传记事实列表，按 importance 和 confidence 排序
   */
  searchBiographyByKeywords(
    keywords: string[],
    options?: {
      limit?: number;
      only_active?: boolean;
      only_user_visible?: boolean;  // ⭐ P0-2 修复
      order_by?: 'confidence DESC, importance DESC' | string;
    }
  ): Promise<BiographicalFact[]>;

  /**
   * 添加传记事实（v5 扩展：自动标记 user_visible）
   * @param fact 传记事实对象（不需要提供 id 和 created_at，user_visible 默认为 true）
   * @returns 创建的事实的 ID
   */
  addBiographicalFact(
    fact: Omit<BiographicalFact, 'id' | 'created_at' | 'user_visible'>
  ): Promise<number>;

  /**
   * 检查新传记事实是否与现有事实冲突
   * @param newFact 新的传记事实
   * @param existingFacts 现有事实列表
   * @returns 冲突检查结果
   */
  checkConflict(
    newFact: BiographicalFact,
    existingFacts: BiographicalFact[]
  ): Promise<ConflictCheckResult>;

  /**
   * 停用传记事实（v5 扩展：支持指定冲突原因）
   * @param factId 事实ID
   * @param conflictWithId 如果因冲突而停用，记录冲突的事实ID
   */
  deactivateFact(
    factId: number,
    conflictWithId?: number
  ): Promise<void>;

  /**
   * 获取特定时期的所有活跃传记事实
   * @param period 时间段（如 'childhood', 'now'）
   * @returns 该时期的所有活跃事实
   */
  getActiveFactsByPeriod(period: string): Promise<BiographicalFact[]>;

  /**
   * 获取所有活跃的传记事实（v5 新增）
   * @returns 所有活跃事实，按时期分组
   */
  getAllActiveFacts(): Promise<BiographicalFact[]>;

  /**
   * 更新传记事实的检索计数（用于统计和排序）（v5 新增）
   * @param factIds 事实ID列表
   */
  updateRetrievalCount(factIds: number[]): Promise<void>;

  /**
   * 从 PersonaConfig 初始化锚点事实
   * @param anchors PersonaConfig 中的传记锚点列表
   */
  initializeAnchors(anchors: PersonaConfig['biography']['anchors']): Promise<void>;

  /**
   * 获取传记统计信息
   * @returns 统计结果 { total: 总数, by_period: 按时期统计, active: 活跃事实数, generated: 生成式事实数 }
   */
  getBiographyStats(): Promise<{
    total: number;
    by_period: Record<string, number>;
    active: number;
    generated: number;
  }>;

  // ========== Database Management ==========

  /**
   * 初始化数据库（创建表和索引）
   */
  initialize(): Promise<void>;

  /**
   * 清理过期数据
   * @param retentionDays 数据保留天数
   */
  cleanup(retentionDays: number): Promise<void>;

  /**
   * 关闭数据库连接
   */
  close(): Promise<void>;
}
```

---

### 3.2 DAL 实现要点

**实现建议**:

1. **连接管理**: 使用 sqlite3 或 better-sqlite3 库
2. **事务支持**: 对于关键操作（如添加记忆和更新关系）使用事务
3. **错误处理**: 统一的数据库错误处理和日志记录
4. **性能优化**: 
   - 使用索引加快查询
   - 批量操作使用事务
   - 定期清理过期数据
5. **并发控制**: SQLite 的 WAL 模式支持基本并发

---

## 4. 数据流图

### 4.1 消息处理流

```
用户消息 (Lark)
    ↓
MessagePackage (原始消息)
    ↓
┌─────────────────────────────────────────────┐
│         Pipeline 处理                        │
├─────────────────────────────────────────────┤
│ 1. Context Assembler                        │
│    ├─ 从 MemoryDAO 获取对话历史              │
│    ├─ 从 MemoryDAO 获取关系状态              │
│    ├─ 从 MemoryDAO 检索相关长期记忆          │
│    ├─ 从 MemoryDAO 获取自我状态              │
│    └─ 从 TimeEngine 计算时间状态            │
│    结果: ContextBundle                      │
│                                             │
│ 2. Cognitive Core                          │
│    ├─ 使用 ContextBundle 调用 LLM           │
│    ├─ 分析用户情绪（S3）                    │
│    ├─ 提取讨论话题                         │
│    └─ 生成记忆建议                         │
│    结果: CognitiveOutput                    │
│                                             │
│ 3. Personality Styler                      │
│    ├─ 应用 PersonaConfig                   │
│    ├─ 参数化回应风格                       │
│    └─ 生成最终消息                         │
│    结果: StyledMessages                    │
│                                             │
│ 4. Time Engine                             │
│    ├─ 计算响应延迟                         │
│    ├─ 应用情绪修饰                         │
│    └─ 生成 ArbitrationResult               │
│                                             │
│ 5. Event Bus                               │
│    └─ 为每个阶段发布事件                   │
└─────────────────────────────────────────────┘
    ↓
ScheduledDelivery (回应消息 + 时间)
    ↓
┌─────────────────────────────────────────────┐
│         数据持久化                          │
├─────────────────────────────────────────────┤
│ 1. MemoryDAO.addMessage()                   │
│    └─ 保存用户消息                         │
│                                             │
│ 2. MemoryDAO.addMemory()                    │
│    └─ 保存建议的记忆（如果需要）            │
│                                             │
│ 3. MemoryDAO.updateRelationship()           │
│    └─ 更新亲密度、话题等                   │
│                                             │
│ 4. MemoryDAO.updateSelfState()              │
│    └─ 更新bot的当前情绪和能量               │
│                                             │
│ 5. MemoryDAO.logEvent()                     │
│    └─ 记录对话完成事件                     │
└─────────────────────────────────────────────┘
    ↓
Lark 发送回应消息
    ↓
ScheduledDelivery 后续处理
    ├─ 保存发送的bot消息
    └─ 更新会话的 turn_count
```

---

### 4.2 数据库表关系图

```
┌──────────────────────────┐
│ conversation_sessions    │
│ ├─ id (PK)              │
│ ├─ user_id (FK)         │─────────┐
│ ├─ session_id (UNIQUE)  │         │
│ ├─ started_at           │         │
│ ├─ ended_at             │         │
│ ├─ turn_count           │         │
│ ├─ summary              │         │
│ ├─ emotional_tone       │         │
│ └─ topics (JSON)        │         │
└──────────────────────────┘         │
           ↑                          │
           │ (session_id FK)          │
           │                          │
┌──────────────────────────┐         │
│ conversation_messages    │         │
│ ├─ id (PK)              │         │
│ ├─ session_id (FK)      │         │
│ ├─ role                 │         │
│ ├─ content              │         │
│ ├─ emotion_tag          │         │
│ ├─ timestamp            │         │
│ └─ metadata (JSON)      │         │
└──────────────────────────┘         │
                                     │
                                     ├──── user_id ────┐
                                     │                 │
                                     ↓                 │
                                ┌──────────────────────────┐
                                │ relationships            │
                                │ ├─ user_id (PK)        │
                                │ ├─ stage                │
                                │ ├─ intimacy_score       │
                                │ ├─ interaction_count    │
                                │ ├─ first_interaction_at │
                                │ ├─ last_interaction_at  │
                                │ ├─ topics_shared (JSON) │
                                │ ├─ promises (JSON)      │
                                │ ├─ user_profile (JSON)  │
                                │ └─ notes (JSON)         │
                                └──────────────────────────┘
                                            ↑
                                            │ (user_id FK)
                                            │
                                ┌──────────────────────────┐
                                │ long_term_memories       │
                                │ ├─ id (PK)              │
                                │ ├─ user_id (FK)         │
                                │ ├─ type                 │
                                │ ├─ content              │
                                │ ├─ keywords             │
                                │ ├─ importance           │
                                │ ├─ retrieval_count      │
                                │ ├─ last_retrieved_at    │
                                │ └─ is_forgettable       │
                                └──────────────────────────┘

┌──────────────────────────┐
│ event_log                │
│ ├─ id (PK)              │
│ ├─ event_type           │
│ ├─ source_stage         │
│ ├─ payload (JSON)       │
│ ├─ timestamp            │
│ └─ user_id (optional)   │
└──────────────────────────┘

┌──────────────────────────┐
│ self_state               │
│ ├─ id (PK, always 1)    │
│ ├─ mood_baseline        │
│ ├─ active_emotions      │
│ ├─ recent_experiences   │
│ ├─ energy_level         │
│ ├─ social_battery       │
│ ├─ current_time_state   │
│ └─ updated_at           │
└──────────────────────────┘
```

---

### 4.3 Pipeline 数据流

```
MessagePackage
    ↓
  Context Assembler
    ├─ 查询 conversation_messages (最近消息)
    ├─ 查询 relationships (用户关系)
    ├─ 查询 long_term_memories (相关记忆)
    ├─ 查询 self_state (当前情绪)
    └─ 计算 time_engine_state
    结果: ContextBundle
    ↓
  Cognitive Core
    ├─ 调用 LLM + ContextBundle → 原始回应
    ├─ 情绪分析（S3）
    ├─ 话题提取
    └─ 记忆建议
    结果: CognitiveOutput
    ↓
  Personality Styler
    ├─ 解析 PersonaConfig
    ├─ 应用 prompt_fragments
    └─ 生成风格化消息
    结果: StyledMessages
    ↓
  Time Engine
    ├─ 计算 final_delay_ms
    ├─ 确定 final_tone
    └─ 应用 emotional_modulation
    结果: ArbitrationResult
    ↓
  Event Bus
    └─ 发布 pipeline.stage_complete 事件
    结果: ScheduledDelivery
    ↓
  持久化层
    ├─ INSERT conversation_messages (user 消息)
    ├─ INSERT long_term_memories (新记忆)
    ├─ UPDATE relationships (亲密度、话题)
    ├─ UPDATE self_state (活跃情绪)
    └─ INSERT event_log (事件记录)
    ↓
  消息队列 / 调度器
    └─ 在 delay_ms 后发送消息
    ↓
  Lark API
    └─ 向用户发送消息
    ↓
  持久化层
    └─ INSERT conversation_messages (bot 消息)
```

---

## 5. 数据模型设计原则

### 5.1 设计决策

1. **SQLite 选择**
   - 简单易部署，无需额外服务
   - 足以支持 MVP 阶段的数据量
   - 可轻松迁移到 PostgreSQL

2. **JSON 存储**
   - 用于灵活结构化数据（如 topics, promises, user_profile）
   - SQLite 支持 JSON 查询和操作
   - 便于向后兼容扩展

3. **关键词检索 vs 向量存储**
   - MVP 使用简单的逗号分隔关键词
   - 足以支持基本的记忆检索
   - 未来可升级到向量数据库

4. **单行自我状态**
   - `self_state` 表只有一行（id = 1）
   - 避免频繁的 WHERE 查询
   - 易于缓存在内存中

5. **事件日志设计**
   - 持久化所有重要事件
   - 便于调试和审计
   - 支持事件回放机制

### 5.2 索引策略

| 表 | 索引字段 | 查询场景 |
|:---|:--------|:--------|
| conversation_messages | session_id | 获取会话消息 |
| conversation_messages | timestamp | 时间范围查询 |
| conversation_sessions | user_id | 获取用户历史 |
| long_term_memories | user_id | 用户记忆查询 |
| long_term_memories | keywords | 关键词匹配 |
| long_term_memories | type | 记忆类型过滤 |
| event_log | event_type | 事件类型查询 |
| event_log | timestamp | 时间日志查询 |

### 5.3 性能考虑

- **批量插入**: 添加多条消息时使用事务
- **定期清理**: 定期执行 `cleanup()` 移除过期数据
- **缓存**: 将 `self_state` 缓存在内存，定期同步到 DB
- **连接池**: 生产环境考虑使用连接池（如 sqlite3 的 serialize 模式）

---

## 6. 数据初始化流程

### 6.1 首次启动

```
应用启动
    ↓
MemoryDAO.initialize()
    ├─ 检查 data/persona.db 是否存在
    ├─ 不存在则创建
    ├─ 执行 CREATE TABLE 语句
    ├─ 执行 CREATE INDEX 语句
    ├─ 初始化 self_state（INSERT id=1 行）
    └─ 验证所有表创建成功
    ↓
应用就绪
```

### 6.2 新用户首次对话

```
用户消息到达
    ↓
MessagePackage 创建
    ↓
MemoryDAO.getRelationship(user_id)
    └─ 用户不存在，创建新 relationships 行
    ↓
MemoryDAO.createSession(user_id)
    ├─ 生成 session_id
    ├─ 记录 started_at
    └─ 初始化 turn_count = 0
    ↓
pipeline 处理
    └─ ContextBundle 包含全新的用户状态
    ↓
消息保存
    ├─ INSERT conversation_sessions
    ├─ INSERT conversation_messages
    └─ INSERT relationships (初始状态)
```

---

## 7. 数据使用示例

### 7.1 检索用户的相关记忆

```typescript
// Pseudo-code
const userId = "user_123";
const discussedTopic = "my_trip_to_paris";

const memories = await memoryDAO.searchMemories(
  userId,
  ["paris", "trip", "travel"],
  5  // 最多返回5条
);

// memories 可能包含：
// - type: 'shared_experience', content: '去年去巴黎旅游'
// - type: 'casual_banter', content: '喜欢法国奶酪'
// - type: 'factual_detail', content: '巴黎住过一周'
```

### 7.2 更新亲密度并检查阶段变化

```typescript
// Pseudo-code
const userId = "user_123";
const oldRelationship = await memoryDAO.getRelationship(userId);

// 增加亲密度
await memoryDAO.updateIntimacyScore(userId, 0.1);

// 检查是否触发阶段变化
const newRelationship = await memoryDAO.getRelationship(userId);

if (oldRelationship.stage !== newRelationship.stage) {
  // 发送阶段变化事件
  await memoryDAO.logEvent({
    type: 'relationship.stage_changed',
    source: 'memory_dao',
    payload: {
      user_id: userId,
      old_stage: oldRelationship.stage,
      new_stage: newRelationship.stage
    },
    timestamp: Date.now()
  });
}
```

### 7.3 定期清理旧记忆

```typescript
// Pseudo-code - 在定时任务中运行
const retentionDays = 90;

const forgettenCount = await memoryDAO.forgetOldMemories(
  userId,
  retentionDays
);

console.log(`遗忘了 ${forgettenCount} 条超过 ${retentionDays} 天的记忆`);
```

---

## 8. 安全与隐私

### 8.1 数据安全

- **本地存储**: SQLite 文件本地存储，不与外部服务共享（除非明确配置）
- **访问控制**: 在生产环境中应限制 `data/` 目录的文件系统访问权限
- **敏感数据**: 避免在日志中记录用户的完整对话内容

### 8.2 数据清理

- **用户删除**: 实现 `deleteUserData(userId)` 方法删除所有用户相关数据
- **过期数据**: 定期执行 `cleanup()` 移除超过保留期的数据
- **隐私合规**: 确保遵守 GDPR、隐私法规等

---

## 9. 后续升级路径

### 9.1 向量存储集成

```typescript
// 未来版本
interface LongTermMemory {
  // ... 现有字段
  embedding?: number[];    // OpenAI Embeddings
  embedding_model?: string;
}

// 支持向量相似度搜索
async semanticSearch(
  userId: string,
  queryEmbedding: number[],
  limit: number
): Promise<LongTermMemory[]>;
```

### 9.2 多用户支持

- 添加 `user.is_active` 字段控制用户状态
- 实现用户分组和角色管理
- 支持多个 bot 实例

### 9.3 数据库迁移

- 编写迁移脚本支持从 SQLite 迁移到 PostgreSQL
- 支持数据备份和恢复
- 版本化 schema 变更

---

## 10. 验收标准

| 项目 | 标准 |
|:---|:---|
| **数据库** | 所有表和索引创建成功，初始数据正确插入 |
| **DAL 接口** | 所有方法都有清晰的文档和类型签名 |
| **类型安全** | TypeScript 编译通过，无 any 类型 |
| **数据一致性** | 外键约束生效，引用完整性维护 |
| **查询性能** | 常用查询在 100ms 内完成 |
| **文档完整性** | 所有表、字段、接口都有中文说明 |

---

**文档版本**: MVP-04-1.0  
**最后更新**: 2026-04-04  
**维护者**: 本体聊天机器人项目组
